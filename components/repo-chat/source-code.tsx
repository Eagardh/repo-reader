"use client";

import { highlightCode } from "@/components/ai-elements/code-block";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import type { BundledLanguage, ThemedToken } from "shiki";

type SourceLine = {
  number: number;
  text: string;
};

type TokenizedCode = NonNullable<ReturnType<typeof highlightCode>>;

export type SelectedSourceLines = {
  startLine: number;
  endLine: number;
};

const LANGUAGE_BY_EXTENSION: Record<string, BundledLanguage> = {
  astro: "astro",
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  go: "go",
  gql: "graphql",
  graphql: "graphql",
  h: "c",
  hpp: "cpp",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  kt: "kotlin",
  kts: "kotlin",
  lua: "lua",
  md: "markdown",
  mdx: "mdx",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "shellscript",
  sql: "sql",
  svelte: "svelte",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shellscript",
};

const LANGUAGE_BY_FILENAME: Record<string, BundledLanguage> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
};

export function SourceCode({
  endLine,
  hasLine,
  lines,
  onSelectLines,
  path,
  selectedLines,
  startLine,
}: {
  endLine?: number;
  hasLine: boolean;
  lines: readonly SourceLine[];
  onSelectLines: (selection: SelectedSourceLines | null) => void;
  path: string;
  selectedLines: SelectedSourceLines | null;
  startLine: number;
}) {
  const code = useMemo(() => lines.map((line) => line.text).join("\n"), [lines]);
  const language = languageFromPath(path);
  const [tokenized, setTokenized] = useState<TokenizedCode | null>(() =>
    language ? highlightCode(code, language) : null,
  );

  useEffect(() => {
    if (!language || tokenized) return;
    let cancelled = false;

    highlightCode(code, language, (result) => {
      if (!cancelled) setTokenized(result);
    });

    return () => {
      cancelled = true;
    };
  }, [code, language, tokenized]);

  const selectedEnd = endLine ?? startLine;

  return (
    <pre
      className="min-w-max py-3 font-mono text-xs leading-5"
      onPointerUp={(event) =>
        onSelectLines(readSelectedLines(event.currentTarget))
      }
    >
      {lines.map((line, index) => {
        const isCited =
          hasLine && line.number >= startLine && line.number <= selectedEnd;
        const isSelected =
          selectedLines &&
          line.number >= selectedLines.startLine &&
          line.number <= selectedLines.endLine;
        const tokens = tokenized?.tokens[index];

        return (
          <span
            className={
              isCited || isSelected
                ? "block bg-blue-50 px-3 dark:bg-blue-950/40"
                : "block px-3 hover:bg-muted/50"
            }
            data-source-line={line.number}
            key={line.number}
          >
            <span className="mr-4 inline-block w-10 select-none text-right text-muted-foreground">
              {line.number}
            </span>
            {tokens?.length
              ? tokens.map((token) => (
                  <SyntaxToken
                    key={`${line.number}-${token.offset}`}
                    token={token}
                  />
                ))
              : line.text || " "}
          </span>
        );
      })}
    </pre>
  );
}

function SyntaxToken({ token }: { token: ThemedToken }) {
  return (
    <span
      className="dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)]"
      style={
        {
          backgroundColor: token.bgColor,
          color: token.color,
          ...token.htmlStyle,
        } as CSSProperties
      }
    >
      {token.content}
    </span>
  );
}

function languageFromPath(path: string): BundledLanguage | undefined {
  const filename = path.split("/").at(-1)?.toLowerCase() ?? "";
  const namedLanguage = LANGUAGE_BY_FILENAME[filename];
  if (namedLanguage) return namedLanguage;

  const extension = filename.split(".").at(-1) ?? "";
  return LANGUAGE_BY_EXTENSION[extension];
}

function readSelectedLines(root: HTMLPreElement): SelectedSourceLines | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.toString().length === 0) {
    return null;
  }

  const anchorLine = lineNumberFromNode(selection.anchorNode, root);
  const focusLine = lineNumberFromNode(selection.focusNode, root);
  if (anchorLine === undefined || focusLine === undefined) return null;

  selection.removeAllRanges();
  return {
    startLine: Math.min(anchorLine, focusLine),
    endLine: Math.max(anchorLine, focusLine),
  };
}

function lineNumberFromNode(
  node: Node | null,
  root: HTMLPreElement,
): number | undefined {
  const element = node instanceof Element ? node : node?.parentElement;
  const line = element?.closest<HTMLElement>("[data-source-line]");
  if (!line || !root.contains(line)) return undefined;

  const lineNumber = Number(line.dataset.sourceLine);
  return Number.isFinite(lineNumber) ? lineNumber : undefined;
}
