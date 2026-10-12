import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="my-3 overflow-x-auto rounded-lg border border-line bg-background p-3 font-mono text-xs leading-relaxed [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-xs [&>code]:text-foreground/90">
      {children}
    </pre>
  ),
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
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