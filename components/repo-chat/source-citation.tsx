"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
} from "@/components/ui/resizable";
import type { EveMessage, EveMessagePart } from "eve/react";
import { ArrowUpIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import type { ComponentProps, FormEvent, MouseEvent, ReactNode } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Components } from "streamdown";
import {
  SourceCode,
  type SelectedSourceLines,
} from "./source-code";
import { shortRepoName } from "./tool-summaries";

type SourceLine = {
  number: number;
  text: string;
};

export type SourceRead = {
  repo: string;
  ref: string;
  path: string;
  startLine: number;
  endLine: number;
  lines: SourceLine[];
};

type SourceSelection = {
  source: SourceRead;
  startLine: number;
  endLine?: number;
  hasLine: boolean;
  href: string;
};

type SourceCitationState = {
  sources: readonly SourceRead[];
  selection: SourceSelection | null;
  openSource: (selection: SourceSelection) => void;
  closeSource: () => void;
};

const SourceCitationContext = createContext<SourceCitationState | null>(null);

export function SourceCitationProvider({
  children,
  sources,
}: {
  children: ReactNode;
  sources: readonly SourceRead[];
}) {
  const [selection, setSelection] = useState<SourceSelection | null>(null);
  const value = useMemo(
    () => ({
      sources,
      selection,
      openSource: setSelection,
      closeSource: () => setSelection(null),
    }),
    [selection, sources],
  );

  return (
    <SourceCitationContext.Provider value={value}>
      {children}
    </SourceCitationContext.Provider>
  );
}

/** Collects exact source chunks already returned by read_repo_file calls. */
export function collectSourceReads(messages: readonly EveMessage[]): SourceRead[] {
  const reads = new Map<string, SourceRead>();

  for (const message of messages) {
    for (const part of message.parts) {
      const read = sourceReadFromPart(part);
      if (!read) continue;
      reads.set(
        `${read.repo}\0${read.ref}\0${read.path}\0${read.startLine}\0${read.endLine}`,
        read,
      );
    }
  }

  return [...reads.values()];
}

/**
 * Rewrites citations for files the agent actually read into Markdown links.
 * Fenced code is deliberately skipped so source-looking examples stay intact.
 */
export function linkifySourceCitations(
  markdown: string,
  sources: readonly SourceRead[],
): string {
  const sourcesByPath = new Map<string, SourceRead[]>();
  for (const source of sources) {
    const matches = sourcesByPath.get(source.path) ?? [];
    matches.push(source);
    sourcesByPath.set(source.path, matches);
  }
  if (sourcesByPath.size === 0) return markdown;

  const paths = [...sourcesByPath.keys()].sort((a, b) => b.length - a.length);
  const pathPattern = paths.map(escapeRegExp).join("|");
  const citationPattern = new RegExp(
    `(^|[\\s(,;])(\\x60?)(${pathPattern}):(\\d+)(?:[-–](\\d+))?\\2(?=$|[\\s.,;!?)}\\]])`,
    "g",
  );
  const filePattern = new RegExp(
    `(^|[\\s(,;])\\x60(${pathPattern})\\x60(?=$|[\\s.,;!?)}\\]])`,
    "g",
  );

  let fence: "```" | "~~~" | null = null;
  return markdown
    .split("\n")
    .map((line) => {
      const marker = /^\s*(```|~~~)/.exec(line)?.[1] as
        | "```"
        | "~~~"
        | undefined;
      if (marker) {
        fence = fence === marker ? null : fence ?? marker;
        return line;
      }
      if (fence) return line;

      const withLineCitations = line.replace(
        citationPattern,
        (
          match,
          prefix: string,
          _ticks: string,
          path: string,
          from: string,
          to?: string,
        ) => {
          const startLine = Number(from);
          const source = findSourceChunk(sourcesByPath.get(path), startLine);
          if (!source) return match;
          const endLine = to ? Number(to) : undefined;
          const label = `${path}:${from}${to ? `–${to}` : ""}`.replace(
            /([\\[\\]])/g,
            "\\$1",
          );
          return `${prefix}[${label}](${githubSourceUrl(source, startLine, endLine)})`;
        },
      );
      return withLineCitations.replace(
        filePattern,
        (match, prefix: string, path: string) => {
          const source = sourcesByPath.get(path)?.at(-1);
          if (!source) return match;
          const label = path.replace(/([\\[\\]])/g, "\\$1");
          return `${prefix}[${label}](${githubFileUrl(source)})`;
        },
      );
    })
    .join("\n");
}

function SourceLink({
  children,
  href,
  node,
  ...props
}: ComponentProps<"a"> & { node?: unknown }) {
  void node;
  const context = useContext(SourceCitationContext);
  const citation = href ? findCitation(context?.sources ?? [], href) : undefined;

  if (!href || !citation) {
    const isExternal = href?.startsWith("http://") || href?.startsWith("https://");
    return (
      <a
        {...props}
        className="font-medium underline underline-offset-4"
        href={href}
        rel={isExternal ? "noreferrer" : undefined}
        target={isExternal ? "_blank" : undefined}
      >
        {children}
      </a>
    );
  }

  const openCitation = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    context?.openSource(citation);
  };

  return (
    <a
      {...props}
      className="rounded bg-blue-50 px-1 py-0.5 font-mono text-[0.85em] font-medium text-blue-700 no-underline transition-colors hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/60"
      href={href}
      onClick={openCitation}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}

export const sourceCitationComponents: Components = { a: SourceLink };

export function SourcePreviewPanel({
  disabled,
  onAsk,
}: {
  disabled: boolean;
  onAsk: (question: string) => void;
}) {
  const context = useContext(SourceCitationContext);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [lineSelection, setLineSelection] = useState<{
    sourceKey: string;
    lines: SelectedSourceLines;
  } | null>(null);
  const selection = context?.selection;

  useEffect(() => {
    if (!selection?.hasLine) return;
    const line = viewportRef.current?.querySelector(
      `[data-source-line="${selection.startLine}"]`,
    );
    line?.scrollIntoView({ block: "center" });
  }, [selection]);

  if (!context || !selection) return null;

  const { source, startLine, endLine, hasLine, href } = selection;
  const sourceKey = href;
  const selectedLines =
    lineSelection?.sourceKey === sourceKey ? lineSelection.lines : null;
  const closeSource = () => {
    setLineSelection(null);
    context.closeSource();
  };
  const askAboutSelection = (question: string) => {
    if (!selectedLines) return;
    const range = formatLineRange(selectedLines, "-");
    onAsk(`Question about \`${source.path}:${range}\`:\n\n${question}`);
    setLineSelection(null);
    if (window.matchMedia("(max-width: 767px)").matches) {
      context.closeSource();
    }
  };

  return (
    <>
      <ResizableHandle
        className="hidden cursor-col-resize md:flex"
        withHandle
      />
      <ResizablePanel defaultSize="44%" minSize="25%" maxSize="70%">
        <aside className="fixed inset-0 z-30 flex min-w-0 flex-col bg-background md:static md:z-auto md:size-full">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-xs font-medium">
                {source.path}
              </div>
              <div className="truncate font-mono text-[10px] text-muted-foreground">
                {source.repo}@{source.ref}
                {hasLine
                  ? ` · L${startLine}${endLine && endLine !== startLine ? `–L${endLine}` : ""}`
                  : ` · lines ${source.startLine}–${source.endLine}`}
              </div>
            </div>
            <Button
              aria-label="Open source on GitHub"
              nativeButton={false}
              render={<a href={href} rel="noreferrer" target="_blank" />}
              size="icon-sm"
              variant="ghost"
            >
              <ExternalLinkIcon />
            </Button>
            <Button
              aria-label="Close source preview"
              onClick={closeSource}
              size="icon-sm"
              variant="ghost"
            >
              <XIcon />
            </Button>
          </div>
          <div className="relative min-h-0 flex-1">
            <div className="size-full overflow-auto" ref={viewportRef}>
              {source.lines.length > 0 ? (
                <SourceCode
                  endLine={endLine}
                  hasLine={hasLine}
                  key={sourceKey}
                  lines={source.lines}
                  onSelectLines={(lines) =>
                    setLineSelection(lines ? { sourceKey, lines } : null)
                  }
                  path={source.path}
                  selectedLines={selectedLines}
                  startLine={startLine}
                />
              ) : (
                <p className="p-4 text-sm text-muted-foreground">
                  The source text is not available in this conversation.
                </p>
              )}
            </div>
            {selectedLines && (
              <SourceQuestion
                disabled={disabled}
                key={`${sourceKey}:${formatLineRange(selectedLines, "-")}`}
                lines={selectedLines}
                onAsk={askAboutSelection}
                onDismiss={() => setLineSelection(null)}
              />
            )}
          </div>
          <div className="flex h-10 shrink-0 items-center border-t px-3 text-[10px] text-muted-foreground">
            Select code to ask · lines {source.startLine}–{source.endLine}
          </div>
        </aside>
      </ResizablePanel>
    </>
  );
}

function SourceQuestion({
  disabled,
  lines,
  onAsk,
  onDismiss,
}: {
  disabled: boolean;
  lines: SelectedSourceLines;
  onAsk: (question: string) => void;
  onDismiss: () => void;
}) {
  const [question, setQuestion] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submitQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = question.trim();
    if (!value || disabled) return;
    onAsk(value);
  };

  return (
    <form
      className="absolute right-3 bottom-3 z-20 w-[min(21rem,calc(100%-1.5rem))] rounded-lg border bg-popover p-2 shadow-lg"
      onSubmit={submitQuestion}
    >
      <div className="mb-1.5 flex items-center gap-2 pl-1">
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
          Ask about lines {formatLineRange(lines)}
        </span>
        <Button
          aria-label="Dismiss question"
          className="size-5"
          onClick={onDismiss}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <XIcon className="size-3" />
        </Button>
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          aria-label={`Question about lines ${formatLineRange(lines)}`}
          className="h-8 bg-background text-xs shadow-none"
          disabled={disabled}
          onChange={(event) => setQuestion(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onDismiss();
          }}
          placeholder="Ask about this code…"
          ref={inputRef}
          value={question}
        />
        <Button
          aria-label="Send question to chat"
          disabled={disabled || question.trim().length === 0}
          size="icon-sm"
          type="submit"
        >
          <ArrowUpIcon />
        </Button>
      </div>
    </form>
  );
}

function sourceReadFromPart(part: EveMessagePart): SourceRead | undefined {
  if (
    part.type !== "dynamic-tool" ||
    part.toolName !== "read_repo_file" ||
    part.state !== "output-available"
  ) {
    return undefined;
  }

  const input = asRecord(part.input);
  const output = asRecord(part.output);
  const repo = shortRepoName(asString(input.repo));
  const ref = asString(output.ref);
  const path = asString(output.path) ?? asString(input.path);
  const content = asString(output.content);
  const startLine = asNumber(output.startLine);
  const endLine = asNumber(output.endLine);

  if (!repo || !ref || !path || !content || !startLine || !endLine) {
    return undefined;
  }

  return {
    repo,
    ref,
    path,
    startLine,
    endLine,
    lines: parseNumberedLines(content),
  };
}

function parseNumberedLines(content: string): SourceLine[] {
  return content.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\t(.*)$/.exec(line);
    return match ? [{ number: Number(match[1]), text: match[2] }] : [];
  });
}

function githubFileUrl(source: SourceRead) {
  const ref = encodeURIComponent(source.ref);
  const path = source.path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${source.repo}/blob/${ref}/${path}`;
}

function githubSourceUrl(source: SourceRead, startLine: number, endLine?: number) {
  const range = endLine && endLine !== startLine ? `-L${endLine}` : "";
  return `${githubFileUrl(source)}#L${startLine}${range}`;
}

function findCitation(sources: readonly SourceRead[], href: string) {
  const [fileUrl, fragment = ""] = href.split("#");
  const lines = /^L(\d+)(?:-L(\d+))?$/.exec(fragment);
  if (!lines && fragment) return undefined;
  const startLine = lines ? Number(lines[1]) : undefined;
  const candidates = sources.filter(
    (candidate) => githubFileUrl(candidate) === fileUrl,
  );
  const source = findSourceChunk(candidates, startLine);
  if (!source) return undefined;

  return {
    source,
    startLine: startLine ?? source.startLine,
    endLine: lines?.[2] ? Number(lines[2]) : undefined,
    hasLine: Boolean(lines),
    href,
  };
}

function findSourceChunk(
  sources: readonly SourceRead[] | undefined,
  line?: number,
): SourceRead | undefined {
  if (!sources?.length) return undefined;
  if (line !== undefined) {
    const matching = sources.findLast(
      (source) => line >= source.startLine && line <= source.endLine,
    );
    if (matching) return matching;
  }
  return sources.at(-1);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatLineRange(
  lines: SelectedSourceLines,
  separator = "–",
): string {
  return lines.startLine === lines.endLine
    ? String(lines.startLine)
    : `${lines.startLine}${separator}${lines.endLine}`;
}
