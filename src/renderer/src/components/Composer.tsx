import { useEffect, useRef, useState } from "react";
import { ArrowUp, ImagePlus, Square, X } from "lucide-react";
import { useStore } from "../store";
import { cn } from "../lib/utils";
import { ChatStats } from "./ChatStats";
import { ModelPicker } from "./ModelPicker";
import { getSlashSuggestions } from "../slash-commands";
import type { ChatImageAttachment, ChatImageMimeType } from "@shared/ipc";

const IMAGE_LIMIT_BYTES = 8 * 1024 * 1024;
const IMAGE_SET_LIMIT_BYTES = 16 * 1024 * 1024;
const IMAGE_COUNT_LIMIT = 4;

function toImageAttachment(file: File): Promise<ChatImageAttachment> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    return Promise.reject(new Error("Use imagens PNG, JPEG ou WebP."));
  }
  if (file.size > IMAGE_LIMIT_BYTES) {
    return Promise.reject(new Error("Cada imagem deve ter no máximo 8 MB."));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem da área de transferência."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("O conteúdo da imagem está inválido."));
        return;
      }
      const [, base64 = ""] = reader.result.split(",", 2);
      resolve({
        id: crypto.randomUUID(),
        name: file.name || `imagem-colada.${file.type === "image/jpeg" ? "jpg" : file.type.slice(6)}`,
        mimeType: file.type as ChatImageMimeType,
        base64,
      });
    };
    reader.readAsDataURL(file);
  });
}

/** Prompt composer with model selection and session telemetry kept in the chat. */
export function Composer(): React.JSX.Element {
  const send = useStore((s) => s.send);
  const abort = useStore((s) => s.abort);
  const busy = useStore((s) => s.busy);
  const compacting = useStore((s) => s.compacting);
  const queueCommandPending = useStore((s) => s.queueCommandPending);
  const queuedCount = useStore((s) => s.queuedMessages.length);
  const status = useStore((s) => s.status);
  const skills = useStore((s) => s.skills);
  const models = useStore((s) => s.models);
  const selectedModel = useStore((s) => s.model);
  const [text, setText] = useState("");
  const [images, setImages] = useState<ChatImageAttachment[]>([]);
  const [imageError, setImageError] = useState("");
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [suggestionsHidden, setSuggestionsHidden] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const canSeeImages = models.find((model) => model.id === selectedModel)?.supportsVision === true;
  const disabled = status !== "ready" && status !== "busy";
  const suggestions = getSlashSuggestions(text, skills);
  const showSuggestions = !disabled && !suggestionsHidden && suggestions.length > 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => {
    setActiveSuggestion(0);
    setSuggestionsHidden(false);
  }, [text]);

  function addImages(incoming: ChatImageAttachment[]): void {
    setImageError("");
    const next = [...images, ...incoming];
    if (next.length > IMAGE_COUNT_LIMIT) {
      setImageError(`É possível anexar até ${IMAGE_COUNT_LIMIT} imagens por mensagem.`);
      return;
    }
    const totalBytes = next.reduce(
      (sum, image) => sum + Math.floor((image.base64.length * 3) / 4),
      0,
    );
    if (totalBytes > IMAGE_SET_LIMIT_BYTES) {
      setImageError("O total de imagens por mensagem deve ser de até 16 MB.");
      return;
    }
    setImages(next);
  }

  async function chooseImages(): Promise<void> {
    setImageError("");
    try {
      addImages(await window.ruby.pickChatImages());
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "Não foi possível anexar as imagens.");
    }
  }

  async function pasteImages(files: File[]): Promise<void> {
    try {
      const pasted = await Promise.all(files.map(toImageAttachment));
      addImages(pasted);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "Não foi possível colar a imagem.");
    }
  }

  function submit(): void {
    if (disabled || (!text.trim() && images.length === 0) || (images.length > 0 && !canSeeImages)) return;
    send(text.trim() || "Analise as imagens anexadas.", images);
    setText("");
    setImages([]);
    setImageError("");
  }

  function completeSuggestion(index = activeSuggestion): void {
    const suggestion = suggestions[index];
    if (!suggestion) return;
    setText(`${suggestion.value} `);
    setSuggestionsHidden(false);
    ref.current?.focus();
  }

  return (
    <div className="shrink-0 border-t border-line bg-page px-6 pt-3 pb-2">
      <div className="relative mx-auto max-w-3xl">
        {showSuggestions && (
          <div
            id="slash-suggestions"
            role="listbox"
            aria-label="Comandos e Skills"
            className="absolute right-0 bottom-full left-0 z-30 mb-2 max-h-64 overflow-y-auto rounded-xl border border-line bg-card p-1.5 shadow-xl shadow-black/30"
          >
            <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Comandos e Skills
            </div>
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.value}
                type="button"
                id={`slash-option-${index}`}
                role="option"
                aria-selected={index === activeSuggestion}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => completeSuggestion(index)}
                className={cn(
                  "flex w-full items-center justify-between gap-4 rounded-lg px-2.5 py-2 text-left transition-colors",
                  index === activeSuggestion
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-background hover:text-foreground",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-xs text-foreground">
                    {suggestion.value}
                  </span>
                  <span className="block truncate text-[11px]">{suggestion.description}</span>
                </span>
                <span className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                  {suggestion.kind === "skill" ? "Skill" : "Comando"}
                </span>
              </button>
            ))}
            <div className="px-2.5 pt-1.5 pb-1 text-[10px] text-muted-foreground">
              ↑↓ navegar <span className="px-1 text-border">·</span> Tab completar
              <span className="px-1 text-border">·</span> Enter selecionar ou enviar
            </div>
          </div>
        )}
        <div
          className={cn(
            "rounded-2xl border bg-card shadow-lg shadow-black/10 transition-colors",
            disabled ? "border-border opacity-60" : "border-border focus-within:border-ring/60",
          )}
        >
          {images.length > 0 ? (
            <div className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Imagens anexadas">
              {images.map((image) => (
                <div key={image.id} className="group relative h-16 w-16 overflow-hidden rounded-lg border border-line bg-background">
                  <img
                    src={`data:${image.mimeType};base64,${image.base64}`}
                    alt={image.name}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))}
                    aria-label={`Remover imagem ${image.name}`}
                    title="Remover imagem"
                    className="absolute top-0.5 right-0.5 rounded-full bg-black/75 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <textarea
            ref={ref}
            rows={1}
            value={text}
            disabled={disabled}
            aria-label="Mensagem para o agente"
            aria-autocomplete="list"
            aria-controls={showSuggestions ? "slash-suggestions" : undefined}
            aria-activedescendant={showSuggestions ? `slash-option-${activeSuggestion}` : undefined}
            aria-expanded={showSuggestions}
            onChange={(event) => setText(event.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.items)
                .filter((item) => item.type.startsWith("image/"))
                .map((item) => item.getAsFile())
                .filter((file): file is File => file !== null);
              if (files.length > 0) {
                event.preventDefault();
                void pasteImages(files);
              }
            }}
            onKeyDown={(event) => {
              if (showSuggestions && event.key === "ArrowDown") {
                event.preventDefault();
                setActiveSuggestion((index) => (index + 1) % suggestions.length);
                return;
              }
              if (showSuggestions && event.key === "ArrowUp") {
                event.preventDefault();
                setActiveSuggestion((index) => (index - 1 + suggestions.length) % suggestions.length);
                return;
              }
              if (showSuggestions && event.key === "Tab") {
                event.preventDefault();
                completeSuggestion();
                return;
              }
              if (showSuggestions && event.key === "Escape") {
                event.preventDefault();
                setSuggestionsHidden(true);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                const exact = suggestions.some((suggestion) => suggestion.value === text.trim());
                if (showSuggestions && !exact) {
                  event.preventDefault();
                  completeSuggestion();
                  return;
                }
                event.preventDefault();
                submit();
              }
            }}
            placeholder={disabled ? "Aguardando o agente…" : "Descreva uma tarefa ou faça uma pergunta…"}
            className="block max-h-[200px] min-h-12 w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />

          <div className="flex items-center gap-2 px-3 pb-2.5">
            <button
              type="button"
              onClick={() => void chooseImages()}
              disabled={disabled || images.length >= IMAGE_COUNT_LIMIT}
              title="Adicionar imagens (ou cole com Ctrl+V)"
              aria-label="Adicionar imagens"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <ImagePlus className="h-4 w-4" />
            </button>
            <span className="flex-1 pl-1 text-[10px] text-muted-foreground">
              {busy || compacting || queueCommandPending
                ? `Enter adiciona à fila${queuedCount ? ` · ${queuedCount} pendente(s)` : ""}`
                : "Enter envia"}{" "}
              <span className="px-1 text-border">·</span> Shift+Enter quebra a linha
            </span>
            <ModelPicker />
            {busy ? (
              <button
                type="button"
                onClick={abort}
                title="Parar o turno"
                aria-label="Parar o turno"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-background text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={submit}
              disabled={disabled || (!text.trim() && images.length === 0) || (images.length > 0 && !canSeeImages)}
              title={busy || compacting || queueCommandPending ? "Adicionar mensagem à fila" : "Enviar mensagem"}
              aria-label={busy || compacting || queueCommandPending ? "Adicionar mensagem à fila" : "Enviar mensagem"}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/20 transition-all hover:-translate-y-0.5 hover:opacity-90 disabled:translate-y-0 disabled:opacity-30 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
          {images.length > 0 && !canSeeImages ? (
            <p className="px-4 pb-2 text-[10px] text-amber-400" role="status">
              O modelo selecionado não confirma suporte a imagens. Escolha um modelo com o ícone de visão para enviar.
            </p>
          ) : null}
          {imageError ? (
            <p className="px-4 pb-2 text-[10px] text-destructive" role="alert">{imageError}</p>
          ) : null}
        </div>

        <ChatStats />
      </div>
    </div>
  );
}
