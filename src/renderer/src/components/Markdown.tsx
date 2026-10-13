import { Children, isValidElement, memo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { cn } from "../lib/utils";

/**
 * Renders assistant output as markdown.
 *
 * The model writes markdown whether or not we render it — headings, tables, bold,
 * fenced code — so showing it literally means the user reads `**word**` and pipes
 * where a table should be. Rendering it is the difference between output that looks
 * like a chat and output that looks like a log file.
 *
 * GFM is enabled because tables and strikethrough are the two extensions the model
 * actually uses in practice (a summary with a comparison table is a very common
 * shape, as is `~~old~~ → new`).
 *
 * Security: raw HTML is deliberately NOT enabled (no `rehype-raw`). Assistant text
 * is untrusted content — it can quote a web page or a file from the workspace — so
 * it must not be able to inject markup into the app's own document.
 *
 * Memoised on `text`: the store rebuilds its item array on every streamed token, so
 * without this every *finished* message would be re-parsed on each new one.
 */
export const Markdown = memo(function Markdown({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "markdown",
        // Draw the streaming caret with a pseudo-element on the last block, so it
        // sits at the end of the final line of text. A sibling element would be
        // pushed onto its own line by the block-level markdown above it.
        streaming &&
          "[&>*:last-child]:after:ml-0.5 [&>*:last-child]:after:inline-block [&>*:last-child]:after:h-[0.9em] [&>*:last-child]:after:w-[0.5em] [&>*:last-child]:after:translate-y-[0.1em] [&>*:last-child]:after:animate-pulse [&>*:last-child]:after:bg-primary [&>*:last-child]:after:align-baseline [&>*:last-child]:after:content-['']",
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

/**
 * Element overrides, styled with the app's own tokens.
 *
 * Hand-written rather than `@tailwindcss/typography`: the prose defaults are built
 * for a light background and would need overriding on nearly every element, so
 * writing the twelve that matter is less code and keeps the brand exact.
 */
const COMPONENTS = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>
  ),

  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mt-5 mb-2 text-lg font-semibold tracking-tight first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mt-5 mb-2 border-b border-line pb-1 text-base font-semibold tracking-tight first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mt-4 mb-1.5 text-sm font-semibold first:mt-0">{children}</h3>
  ),
  h4: ({ children }: { children?: React.ReactNode }) => (
    <h4 className="mt-3 mb-1 text-sm font-medium first:mt-0">{children}</h4>
  ),

  // GFM tags a list containing task items with `contains-task-list`; the disc
  // marker must go, or every item renders as "• ☑ text".
  ul: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <ul
      className={cn(
        "my-2 ml-5 space-y-1 marker:text-muted-foreground",
        className?.includes("contains-task-list") ? "list-none" : "list-disc",
      )}
    >
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="my-2 ml-5 list-decimal space-y-1 marker:text-muted-foreground">{children}</ol>
  ),
  li: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <li className={cn("leading-relaxed [&>p]:my-0", className)}>{children}</li>
  ),

  // The `pre > code` overrides undo the inline-code pill inside fenced blocks —
  // otherwise every block would render as one long highlighted chip.
  pre: ({ children }: { children?: ReactNode }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <code
      className={
        className
          ? className
          : "rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-chart-4"
      }
    >
      {children}
    </code>
  ),

  // Wide tables must scroll rather than squeeze the transcript column.
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-line bg-muted px-2 py-1 text-left font-medium text-foreground">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-line px-2 py-1 align-top text-foreground/90">{children}</td>
  ),

  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a
      href={href}
      // The main process opens external links in the user's browser; the renderer
      // must never navigate itself away from the app.
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),

  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-3 border-l-2 border-primary/50 pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),

  hr: () => <hr className="my-4 border-line" />,

  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  del: ({ children }: { children?: React.ReactNode }) => (
    <del className="text-muted-foreground line-through">{children}</del>
  ),

  // GFM task lists. The checkbox is inert by design: this is rendered output, not
  // a form, and a clickable box would imply the model's checklist is interactive.
  input: ({ checked }: { checked?: boolean }) => (
    <input
      type="checkbox"
      checked={Boolean(checked)}
      readOnly
      className="mr-1.5 h-3 w-3 translate-y-px accent-[var(--primary)]"
    />
  ),
};

function CodeBlock({ children }: { children?: ReactNode }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const child = Children.toArray(children).find(isValidElement) as
    | ReactElement<{ className?: string; children?: ReactNode }>
    | undefined;
  const code = child?.props.children;
  const source = typeof code === "string" ? code.replace(/\n$/, "") : "";
  const language = child?.props.className?.match(/language-([\w-]+)/)?.[1]?.toLowerCase() ?? "";

  const copyCode = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="group/code relative my-3 overflow-hidden rounded-lg border border-line bg-background">
      <div className="flex h-8 items-center justify-between border-b border-line px-3">
        <span className="font-mono text-[10px] text-muted-foreground">{language || "código"}</span>
        <button
          type="button"
          onClick={() => void copyCode()}
          aria-label={copied ? "Código copiado" : "Copiar código"}
          title={copied ? "Copiado" : "Copiar código"}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3 text-chart-5" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
        <code>{highlightCode(source, language)}</code>
      </pre>
    </div>
  );
}

const KEYWORDS: Record<string, Set<string>> = {
  javascript: new Set("async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return super switch this throw try typeof var void while with yield".split(" ")),
  typescript: new Set("abstract any as asserts async await boolean break case catch class const constructor continue declare default delete do else enum export extends finally for from function if implements import in infer instanceof interface is keyof let module namespace never new number object of package private protected public readonly require return set static string super switch symbol this throw type typeof undefined unique unknown var void while yield".split(" ")),
  python: new Set("and as assert async await break class continue def del elif else except exec finally for from global if import in is lambda nonlocal not or pass print raise return try while with yield".split(" ")),
  java: new Set("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while".split(" ")),
  bash: new Set("case do done elif else esac fi for function if in select then time until while".split(" ")),
  rust: new Set("as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type union unsafe use where while".split(" ")),
  go: new Set("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var".split(" ")),
};

/** Lightweight lexical highlighting for common languages, with plain-text fallback. */
function highlightCode(source: string, language: string): ReactNode[] | string {
  const normalized = ({
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    sh: "bash",
    shell: "bash",
  } as Record<string, string>)[language] ?? language;
  const keywords = KEYWORDS[normalized] ?? KEYWORDS[language];
  const supported = Boolean(keywords) || ["json", "css", "html", "xml", "sql", "yaml", "yml", "sh", "shell", "py"].includes(language);
  if (!supported) return source;

  const hasHashComments = ["python", "py", "bash", "sh", "shell", "yaml", "yml"].includes(language);
  const tokenPattern = hasHashComments
    ? /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$-]*|\s+|.)/g
    : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$-]*|\s+|.)/g;
  const tokens = source.match(tokenPattern) ?? [];
  const rendered: ReactNode[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const next = tokens.slice(index + 1).find((part) => part.trim());
    let color = "";
    if (/^(\/\/|\/\*|<!--)/.test(token) || (hasHashComments && token.startsWith("#"))) {
      color = "text-muted-foreground";
    }
    else if (/^(?:\"|'|`)/.test(token)) color = "text-chart-5";
    else if (/^\d/.test(token)) color = "text-chart-3";
    else if (/^(?:true|false|null|undefined|None|True|False|nil|NaN)$/.test(token)) color = "text-chart-2";
    else if (keywords?.has(token) || (["json", "css"].includes(language) && next === ":")) color = "text-primary";
    else if (/^[A-Za-z_$][\w$-]*$/.test(token) && next === "(") color = "text-chart-4";
    if (color) rendered.push(<span key={index} className={color}>{token}</span>);
    else rendered.push(token);
  }
  return rendered;
}
