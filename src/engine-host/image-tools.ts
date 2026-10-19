/**
 * Ruby image API integration for the Desktop engine host.
 *
 * Image bytes stay out of model-visible tool results. Reference files and saved
 * assets are confined to the active workspace before any read or write.
 */
import { realpath, stat, mkdir as mkdirAsync, readFile as readFileAsync, writeFile as writeFileAsync } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Tool, ToolImageArtifact, ToolRegistry } from "@rubyclii/cli";
const IMAGE_MIME_EXTENSIONS: Record<ToolImageArtifact["mimeType"], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const IMAGE_MIME_TYPES = new Set(Object.keys(IMAGE_MIME_EXTENSIONS));
const IMAGE_MAX_REFERENCE_BYTES = 12 * 1024 * 1024;
const IMAGE_MAX_RESULT_BYTES = 48 * 1024 * 1024;
const IMAGE_QUOTE_TTL_MS = 5 * 60_000;
const IMAGE_QUOTE_TIMEOUT_MS = 20_000;
const IMAGE_EDIT_TIMEOUT_MS = 180_000;

interface ImageQuoteRequest {
  model: string;
  size: string;
  quality: string;
  n: number;
  referenceCount: 0 | 1;
}

interface ImageQuoteRecord {
  expiresAt: number;
  output: string;
}

async function readBoundedImageResponse(response: Response, maxBytes: number): Promise<string> {
  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    await response.body?.cancel();
    throw new Error("A resposta da API excedeu o tamanho permitido.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error("A resposta da API excedeu o tamanho permitido.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function imageQuoteKey(request: ImageQuoteRequest): string {
  return JSON.stringify([
    request.model,
    request.size,
    request.quality,
    request.n,
    request.referenceCount,
  ]);
}

function normalizeImageQuoteRequest(
  params: Record<string, unknown>,
): ImageQuoteRequest | string {
  const model = typeof params.model === "string" ? params.model.trim() : "";
  if (!model || model.length > 200) return "Informe um id válido de modelo de imagem.";
  const size = typeof params.size === "string" ? params.size.trim() : "1024x1024";
  const dimensions = /^(\d{2,4})x(\d{2,4})$/.exec(size);
  if (
    !dimensions ||
    Number(dimensions[1]) < 1 || Number(dimensions[2]) < 1 ||
    Number(dimensions[1]) > 4096 || Number(dimensions[2]) > 4096
  ) return "Tamanho inválido. Use largura x altura, até 4096 px.";
  const quality = typeof params.quality === "string" ? params.quality.trim() : "standard";
  if (!quality || quality.length > 50) return "Qualidade inválida.";
  const n = params.n === undefined ? 1 : Number(params.n);
  if (!Number.isInteger(n) || n < 1 || n > 4) return "A quantidade deve ser de 1 a 4 imagens.";
  const referenceCount = params.referenceCount === undefined ? 0 : Number(params.referenceCount);
  if (referenceCount !== 0 && referenceCount !== 1) {
    return "referenceCount deve ser 0 para geração ou 1 para edição.";
  }
  return { model, size, quality, n, referenceCount };
}

function quoteNumbers(payload: Record<string, unknown>): {
  estimated: number;
  minimum?: number;
  maximum?: number;
} | undefined {
  const read = (key: string): number | undefined => {
    const direct = payload[key];
    const nested = isRecord(payload.data) ? payload.data[key] : undefined;
    const value = direct ?? nested;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
    return undefined;
  };
  const estimated = read("estimatedCredits");
  if (estimated === undefined) return undefined;
  return {
    estimated,
    ...(read("minEstimatedCredits") !== undefined ? { minimum: read("minEstimatedCredits") } : {}),
    ...(read("maxEstimatedCredits") !== undefined ? { maximum: read("maxEstimatedCredits") } : {}),
  };
}

async function imageApiRequest(
  apiKey: string,
  baseUrl: string,
  route: "quote" | "edits",
  body: Record<string, unknown> | FormData,
): Promise<{ ok: boolean; payload?: Record<string, unknown>; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    route === "quote" ? IMAGE_QUOTE_TIMEOUT_MS : IMAGE_EDIT_TIMEOUT_MS,
  );
  try {
    const multipart = body instanceof FormData;
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/images/${route}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(!multipart ? { "Content-Type": "application/json" } : {}),
      },
      body: multipart ? body : JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await readBoundedImageResponse(
      response,
      route === "quote" ? 256_000 : IMAGE_MAX_RESULT_BYTES,
    );
    let payload: Record<string, unknown> | undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed)) payload = parsed;
    } catch {
      // Provider responses can include plain-text errors; keep them bounded below.
    }
    if (!response.ok) {
      const rawError = payload?.error;
      const message = isRecord(rawError) ? rawError.message : rawError;
      const safeMessage = typeof message === "string"
        ? message.replaceAll(apiKey, "[redacted]").slice(0, 400)
        : raw.slice(0, 300);
      return { ok: false, error: `HTTP ${response.status}${safeMessage ? `: ${safeMessage}` : ""}` };
    }
    if (!payload) return { ok: false, error: "A API retornou JSON inválido." };
    return { ok: true, payload };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "A API excedeu o tempo limite."
      : error instanceof Error
        ? error.message.replaceAll(apiKey, "[redacted]").slice(0, 400)
        : String(error);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

function imageMimeFromBytes(bytes: Uint8Array): ToolImageArtifact["mimeType"] | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) return "image/webp";
  return undefined;
}

function isWithinPath(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === "" || (
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

/** Resolve project paths through their nearest real ancestor to block symlink escapes. */
async function resolveWorkspacePath(workspaceRoot: string, rawPath: string): Promise<string> {
  const raw = rawPath.trim();
  if (!raw || raw.includes("\0") || isAbsolute(raw)) {
    throw new Error("Use um caminho relativo dentro do projeto.");
  }
  const root = await realpath(workspaceRoot);
  const candidate = resolve(root, raw);
  if (!isWithinPath(root, candidate)) throw new Error("O caminho precisa permanecer dentro do projeto.");

  let ancestor = candidate;
  const remainder: string[] = [];
  for (let depth = 0; depth < 64; depth++) {
    try {
      const realAncestor = await realpath(ancestor);
      const resolved = resolve(realAncestor, ...remainder.reverse());
      if (!isWithinPath(root, resolved)) throw new Error("O caminho aponta para fora do projeto por meio de um link simbólico.");
      return resolved;
    } catch (error) {
      if (error instanceof Error && error.message.includes("fora do projeto")) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) break;
      remainder.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
  throw new Error("Não foi possível validar o destino dentro do projeto.");
}

function imageOutputPath(rawPath: string, mimeType: ToolImageArtifact["mimeType"], index: number, count: number): string {
  const extension = extname(rawPath);
  const stem = extension ? rawPath.slice(0, -extension.length) : rawPath;
  return `${stem}${count > 1 ? `-${index + 1}` : ""}.${IMAGE_MIME_EXTENSIONS[mimeType]}`;
}

async function preflightImageSavePath(workspaceRoot: string, rawPath: string, count = 1): Promise<void> {
  const output = await resolveWorkspacePath(workspaceRoot, rawPath);
  const root = await realpath(workspaceRoot);
  if (output === root) throw new Error("Informe o nome do arquivo de imagem.");
  const extension = extname(output);
  const stem = extension ? output.slice(0, -extension.length) : output;
  for (let index = 0; index < count; index++) {
    const variantStem = `${stem}${count > 1 ? `-${index + 1}` : ""}`;
    const candidates = extension
      ? [`${variantStem}${extension}`, `${variantStem}.png`, `${variantStem}.jpg`, `${variantStem}.webp`]
      : [`${variantStem}.png`, `${variantStem}.jpg`, `${variantStem}.webp`];
    for (const candidate of new Set(candidates)) {
      await resolveWorkspacePath(workspaceRoot, relative(root, candidate));
      const existing = await stat(candidate).then(() => true, () => false);
      if (existing) throw new Error("O arquivo de destino já existe; escolha outro caminho para evitar sobrescrevê-lo.");
    }
  }
  await resolveWorkspacePath(workspaceRoot, join(relative(root, dirname(output)), ".image-check"));
}

function imageEditTool(
  workspaceRoot: string,
  apiKey: string,
  baseUrl: string,
  quotes: Map<string, ImageQuoteRecord>,
  autoImageGeneration: boolean,
  isDenied: (toolName: string, args: Record<string, unknown>) => boolean,
): Tool {
  return {
    name: "image_edit",
    description:
      "Edit an existing PNG, JPEG, or WebP image inside the current project through POST /v1/images/edits. Quote first with image_quote and referenceCount=1. The response image is shown in chat and must also be saved under the workspace with save_path. Existing files are never overwritten.",
    parameters: {
      type: "object",
      properties: {
        model: { type: "string", description: "Exact image model id from image_models." },
        prompt: { type: "string", description: "How to transform the reference image." },
        image_path: { type: "string", description: "Relative path of a PNG, JPEG, or WebP reference file in the workspace (maximum 12 MB)." },
        size: { type: "string", description: "Image variant such as 1024x1024; default 1024x1024." },
        quality: { type: "string", description: "Image quality; default standard." },
        n: { type: "integer", description: "Number of edited variants from 1 to 4." },
        resolution: { type: "string", description: "Optional provider resolution such as 1K or 2K." },
        aspect_ratio: { type: "string", description: "Optional aspect ratio such as 16:9." },
        save_path: { type: "string", description: "Required relative destination in the project; an extension is added or corrected to match the returned image." },
      },
      required: ["model", "prompt", "image_path", "save_path"],
    },
    requiresConfirmation: (args) => !autoImageGeneration || isDenied("image_edit", args),
    async execute(params) {
      const model = typeof params.model === "string" ? params.model.trim() : "";
      const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
      const imagePath = typeof params.image_path === "string" ? params.image_path : "";
      const size = typeof params.size === "string" ? params.size.trim() : "1024x1024";
      const quality = typeof params.quality === "string" ? params.quality.trim() : "standard";
      const n = params.n === undefined ? 1 : Number(params.n);
      if (!model || model.length > 200) return { success: false, output: "", error: "Informe um id válido de modelo de imagem." };
      if (!prompt || prompt.length > 10_000) return { success: false, output: "", error: "O prompt deve conter de 1 a 10.000 caracteres." };
      if (!Number.isInteger(n) || n < 1 || n > 4) return { success: false, output: "", error: "A quantidade deve ser de 1 a 4 imagens." };
      const savePath = typeof params.save_path === "string" ? params.save_path.trim() : "";
      if (!savePath || savePath.length > 1024) return { success: false, output: "", error: "Informe save_path como caminho relativo dentro do projeto, com até 1024 caracteres." };
      try {
        await preflightImageSavePath(workspaceRoot, savePath, n);
      } catch (error) {
        return { success: false, output: "", error: error instanceof Error ? error.message : "Destino de imagem inválido." };
      }
      const quoteRequest = normalizeImageQuoteRequest({ model, size, quality, n, referenceCount: 1 });
      if (typeof quoteRequest === "string") return { success: false, output: "", error: quoteRequest };
      const quote = quotes.get(imageQuoteKey(quoteRequest));
      if (!quote || quote.expiresAt < Date.now()) {
        quotes.delete(imageQuoteKey(quoteRequest));
        return { success: false, output: "", error: "Antes de editar, chame image_quote com referenceCount=1 e os mesmos modelo, tamanho, qualidade e quantidade." };
      }
      const resolution = typeof params.resolution === "string" ? params.resolution.trim() : "";
      const aspectRatio = typeof params.aspect_ratio === "string" ? params.aspect_ratio.trim() : "";
      if (resolution.length > 40) return { success: false, output: "", error: "A resolução é inválida." };
      if (aspectRatio && !/^\d{1,3}:\d{1,3}$/.test(aspectRatio)) return { success: false, output: "", error: "A proporção deve usar o formato largura:altura, por exemplo 16:9." };

      let referencePath: string;
      let reference: Buffer;
      try {
        referencePath = await resolveWorkspacePath(workspaceRoot, imagePath);
        const file = await stat(referencePath);
        if (!file.isFile()) throw new Error("O caminho de referência não é um arquivo.");
        if (file.size <= 0 || file.size > IMAGE_MAX_REFERENCE_BYTES) throw new Error("A referência deve ter até 12 MB.");
        reference = await readFileAsync(referencePath);
        if (reference.length > IMAGE_MAX_REFERENCE_BYTES) throw new Error("A referência deve ter até 12 MB.");
      } catch (error) {
        return { success: false, output: "", error: error instanceof Error ? error.message : "Não foi possível ler a referência." };
      }
      const mimeType = imageMimeFromBytes(reference);
      if (!mimeType) return { success: false, output: "", error: "A referência precisa ser PNG, JPEG ou WebP válido." };

      const form = new FormData();
      form.append("model", model);
      form.append("prompt", prompt);
      form.append("image", new Blob([reference], { type: mimeType }), basename(referencePath));
      form.append("size", size);
      form.append("quality", quality);
      form.append("n", String(n));
      if (resolution) form.append("resolution", resolution);
      if (aspectRatio) form.append("aspect_ratio", aspectRatio);
      const result = await imageApiRequest(apiKey, baseUrl, "edits", form);
      if (!result.ok || !result.payload) return { success: false, output: "", error: `Falha na edição: ${result.error ?? "resposta inválida da API"}` };
      if (!Array.isArray(result.payload.data)) return { success: false, output: "", error: "A API não retornou a lista de imagens esperada." };
      const responseMime = result.payload.media_type ?? result.payload.mime_type ?? result.payload.mimeType;
      const usage = isRecord(result.payload.usage) ? result.payload.usage : undefined;
      const actualCredits = usage?.credits;
      const images: ToolImageArtifact[] = [];
      let totalBytes = 0;
      for (const [index, value] of result.payload.data.entries()) {
        if (!isRecord(value)) continue;
        const base64 = typeof value.b64_json === "string" ? value.b64_json : typeof value.base64 === "string" ? value.base64 : "";
        const rawMime = value.media_type ?? value.mime_type ?? value.mimeType ?? responseMime;
        const imageMime = typeof rawMime === "string" && IMAGE_MIME_TYPES.has(rawMime)
          ? rawMime as ToolImageArtifact["mimeType"]
          : rawMime === undefined ? "image/png" : undefined;
        if (!imageMime || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
          return { success: false, output: "", error: "A API retornou base64 ou tipo de imagem inválido." };
        }
        const bytes = Buffer.from(base64, "base64");
        if (!bytes.length || bytes.length > IMAGE_MAX_REFERENCE_BYTES || imageMimeFromBytes(bytes) !== imageMime) {
          return { success: false, output: "", error: "A API retornou uma imagem vazia, grande demais ou com assinatura incompatível." };
        }
        totalBytes += bytes.length;
        if (totalBytes > 32 * 1024 * 1024 || images.length >= n) return { success: false, output: "", error: "A resposta excedeu o limite de imagens ou tamanho total." };
        images.push({ mimeType: imageMime, base64, alt: `Imagem editada ${index + 1}` });
      }
      if (!images.length) return { success: false, output: "", error: "A API não retornou imagens em base64." };

      const savedPaths: string[] = [];
      try {
        for (const [index, image] of images.entries()) {
          const outputPath = imageOutputPath(savePath, image.mimeType, index, images.length);
          const target = await resolveWorkspacePath(workspaceRoot, outputPath);
          await mkdirAsync(dirname(target), { recursive: true });
          await writeFileAsync(target, Buffer.from(image.base64, "base64"), { flag: "wx" });
          savedPaths.push(relative(await realpath(workspaceRoot), target));
        }
      } catch (error) {
        return { success: false, output: `A API editou a imagem, mas não foi possível salvar o arquivo: ${error instanceof Error ? error.message : "erro de escrita"}`, images };
      }
      return {
        success: true,
        output: [
          `${images.length} imagem(ns) editada(s) com ${model}.`,
          quote.output,
          ...(typeof actualCredits === "number" || typeof actualCredits === "string" ? [`Consumo informado pela API: ${actualCredits} RU.`] : []),
          `Arquivos salvos no projeto: ${savedPaths.join(", ")}.`,
        ].join("\n"),
        images,
      };
    },
  };
}

/** Add reference editing, required workspace saving, and the user's autonomous-mode policy. */
export function configureImageTools(
  registry: ToolRegistry,
  workspaceRoot: string,
  apiKey: string,
  baseUrl: string,
  autoImageGeneration: boolean,
  isDenied: (toolName: string, args: Record<string, unknown>) => boolean,
): void {
  const quotes = new Map<string, ImageQuoteRecord>();
  const quoteTool = registry.get("image_quote");
  if (quoteTool) {
    registry.unregister("image_quote");
    registry.register({
      ...quoteTool,
      description: "Estimate image credits. Use referenceCount=0 for generation and referenceCount=1 before image_edit. This call does not generate or charge for an image.",
      parameters: {
        ...quoteTool.parameters,
        properties: {
          ...quoteTool.parameters.properties,
          referenceCount: { type: "integer", description: "0 for generation, 1 when editing one reference image; default 0." },
        },
      },
      async execute(params, context) {
        const request = normalizeImageQuoteRequest(params);
        if (typeof request === "string") return { success: false, output: "", error: request };
        if (request.referenceCount === 0) {
          const { referenceCount: _referenceCount, ...generationParams } = params;
          return quoteTool.execute(generationParams, context);
        }
        const result = await imageApiRequest(apiKey, baseUrl, "quote", {
          model: request.model,
          size: request.size,
          quality: request.quality,
          n: request.n,
          referenceCount: 1,
        });
        if (!result.ok || !result.payload) return { success: false, output: "", error: `Falha na estimativa: ${result.error ?? "resposta inválida da API"}` };
        const numbers = quoteNumbers(result.payload);
        if (!numbers) return { success: false, output: "", error: "A API não retornou estimatedCredits para esta edição." };
        const output = [
          `Estimativa para editar com ${request.model} (${request.size}, ${request.quality}, ${request.n} imagem(ns), 1 referência):`,
          `Rota principal: ${numbers.estimated} créditos.`,
          numbers.minimum !== undefined && numbers.maximum !== undefined
            ? `Faixa entre rotas ativas: ${numbers.minimum}–${numbers.maximum} créditos.`
            : "A API não informou a faixa entre rotas ativas.",
          "A cobrança final pode variar conforme a rota utilizada.",
        ].join("\n");
        quotes.set(imageQuoteKey(request), { expiresAt: Date.now() + IMAGE_QUOTE_TTL_MS, output });
        while (quotes.size > 32) {
          const oldest = quotes.keys().next().value;
          if (oldest === undefined) break;
          quotes.delete(oldest);
        }
        return { success: true, output };
      },
    });
  }

  const generationTool = registry.get("image_generate");
  if (generationTool) {
    registry.unregister("image_generate");
    registry.register({
      ...generationTool,
      description: `${generationTool.description} A relative save_path inside the project is required; the returned image is also shown in chat. Existing files are never overwritten.`,
      parameters: {
        ...generationTool.parameters,
        properties: {
          ...generationTool.parameters.properties,
          save_path: { type: "string", description: "Required relative file path under the project, such as assets/generated/heart-icon.png." },
        },
        required: [...new Set([...(generationTool.parameters.required ?? []), "save_path"])],
      },
      requiresConfirmation: autoImageGeneration
        ? (args) => isDenied("image_generate", args)
        : generationTool.requiresConfirmation,
      async execute(params, context) {
        const count = params.n === undefined ? 1 : Number(params.n);
        if (!Number.isInteger(count) || count < 1 || count > 4) {
          return { success: false, output: "", error: "A quantidade deve ser de 1 a 4 imagens." };
        }
        const savePath = typeof params.save_path === "string" ? params.save_path.trim() : "";
        if (!savePath || savePath.length > 1024) {
          return { success: false, output: "", error: "Informe save_path como caminho relativo dentro do projeto, com até 1024 caracteres." };
        }
        try {
          await preflightImageSavePath(
            workspaceRoot,
            savePath,
            count,
          );
        } catch (error) {
          return { success: false, output: "", error: error instanceof Error ? error.message : "Destino de imagem inválido." };
        }
        const { save_path: _savePath, ...generationParams } = params;
        const result = await generationTool.execute(generationParams, context);
        if (!result.success || !result.images?.length) return result;
        try {
          const savedPaths: string[] = [];
          for (const [index, image] of result.images.entries()) {
            const outputPath = imageOutputPath(savePath, image.mimeType, index, result.images.length);
            const target = await resolveWorkspacePath(workspaceRoot, outputPath);
            await mkdirAsync(dirname(target), { recursive: true });
            await writeFileAsync(target, Buffer.from(image.base64, "base64"), { flag: "wx" });
            savedPaths.push(relative(await realpath(workspaceRoot), target));
          }
          return { ...result, output: `${result.output}\nArquivos salvos no projeto: ${savedPaths.join(", ")}.` };
        } catch (error) {
          return { ...result, success: false, error: `Imagem gerada, mas não salva no projeto: ${error instanceof Error ? error.message : "erro de escrita"}` };
        }
      },
    });
  }

  registry.register(
    imageEditTool(
      workspaceRoot,
      apiKey,
      baseUrl,
      quotes,
      autoImageGeneration,
      isDenied,
    ),
  );
}

