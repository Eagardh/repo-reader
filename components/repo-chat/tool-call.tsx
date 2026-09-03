"use client";

import { CodeBlock } from "@/components/ai-elements/code-block";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { EveMessagePart } from "eve/react";
import {
  ChevronDownIcon,
  CircleAlertIcon,
  CircleXIcon,
  FileTextIcon,
  FolderGit2Icon,
  GitCommitHorizontalIcon,
  GlobeIcon,
  ListTodoIcon,
  ListTreeIcon,
  LoaderCircleIcon,
  SearchIcon,
  WrenchIcon,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { languageForPath, summarizeToolCall } from "./tool-summaries";

type DynamicToolPart = Extract<EveMessagePart, { type: "dynamic-tool" }>;

const IN_FLIGHT_STATES = new Set([
  "input-streaming",
  "input-available",
  "approval-requested",
]);

const TOOL_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  resolve_repo: FolderGit2Icon,
  list_repo_files: ListTreeIcon,
  read_repo_file: FileTextIcon,
  search_repo_code: SearchIcon,
  list_repo_commits: GitCommitHorizontalIcon,
  web_fetch: GlobeIcon,
  web_search: SearchIcon,
  todo: ListTodoIcon,
};

/**
 * One line of agent activity.
 *
 * These rows sit between the reader and the answer, so they stay quiet: no
 * card, no border, no status badge. The past-tense label already says the call
 * finished ("Read src/index.ts (lines 1-64)"), which is what the badge was
 * repeating. Only the states that need attention — running, failed, denied —
 * get their own colour or motion.
 */
export function ToolCall({ part }: { part: DynamicToolPart }) {
  const input = "input" in part ? part.input : undefined;
  const output = "output" in part ? part.output : undefined;
  const errorText = "errorText" in part ? part.errorText : undefined;

  const summary = summarizeToolCall(part.toolName, input, output);
  const isRunning = IN_FLIGHT_STATES.has(part.state);
  const isError = part.state === "output-error";
  const isDenied = part.state === "output-denied";

  const Icon = isRunning
    ? LoaderCircleIcon
    : isError
      ? CircleAlertIcon
      : isDenied
        ? CircleXIcon
        : (TOOL_ICONS[part.toolName] ?? WrenchIcon);

  const hasDetail = Boolean(input) || Boolean(output) || Boolean(errorText);

  return (
    <Collapsible className="group -mx-2">
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
          "hover:bg-muted/60",
          isError || isDenied
            ? "text-destructive"
            : "text-muted-foreground hover:text-foreground",
        )}
        disabled={!hasDetail}
      >
        <Icon
          className={cn("size-3.5 shrink-0", isRunning && "animate-spin")}
        />
        <span className={cn("truncate", isRunning && "animate-pulse")}>
          {isRunning ? summary.running : summary.done}
        </span>
        {hasDetail && (
          <ChevronDownIcon
            className={cn(
              "ml-auto size-3.5 shrink-0 opacity-0 transition-all",
              "group-hover:opacity-50 group-data-[panel-open]:opacity-50",
              "group-data-[panel-open]:rotate-180",
            )}
          />
        )}
      </CollapsibleTrigger>

      {hasDetail && (
        <CollapsibleContent className="overflow-hidden">
          <div className="mt-1 mb-2 ml-[0.9rem] space-y-2 border-l pl-3">
            {errorText && (
              <p className="text-destructive text-xs">{errorText}</p>
            )}
            {renderOutput(part.toolName, input, output) ?? (
              output !== undefined && output !== null ? (
                <CodeBlock
                  code={JSON.stringify(output, null, 2)}
                  language={"json" as never}
                />
              ) : null
            )}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

/**
 * Returns `undefined` for tools whose output does not warrant a custom view;
 * the caller then falls back to a JSON dump.
 */
function renderOutput(
  toolName: string,
  input: unknown,
  output: unknown,
): ReactNode | undefined {
  if (output === undefined || output === null) return undefined;
  const result = output as Record<string, unknown>;

  if (toolName === "read_repo_file" && typeof result.content === "string") {
    const path = (input as Record<string, unknown> | undefined)?.path;
    return (
      <CodeBlock
        code={result.content}
        language={languageForPath(typeof path === "string" ? path : undefined)}
      />
    );
  }

  if (toolName === "list_repo_files" && Array.isArray(result.files)) {
    const files = result.files as { path: string; bytes: number }[];
    return (
      <ul className="max-h-80 divide-y divide-border overflow-y-auto font-mono text-xs">
        {files.map((file) => (
          <li
            className="flex items-baseline justify-between gap-4 px-3 py-1.5"
            key={file.path}
          >
            <span className="truncate">{file.path}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {formatBytes(file.bytes)}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  if (toolName === "search_repo_code" && Array.isArray(result.files)) {
    const files = result.files as {
      path: string;
      lines: { line: number; text: string }[];
    }[];
    return (
      <div className="max-h-96 overflow-y-auto">
        {files.map((file) => (
          <div className="border-b last:border-b-0" key={file.path}>
            <div className="bg-muted/60 px-3 py-1.5 font-mono text-[11px]">
              {file.path}
            </div>
            {file.lines.map((match, index) => (
              <div
                className="flex gap-3 px-3 py-1 font-mono text-[11px] leading-relaxed"
                key={`${file.path}-${match.line}-${index}`}
              >
                {match.line > 0 && (
                  <span className="shrink-0 select-none text-muted-foreground tabular-nums">
                    {match.line}
                  </span>
                )}
                <span className="min-w-0 truncate">{match.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (toolName === "list_repo_commits" && Array.isArray(result.commits)) {
    const commits = result.commits as {
      sha: string;
      url: string;
      author: string;
      date: string | null;
      message: string;
    }[];
    return (
      <ul className="max-h-96 divide-y divide-border overflow-y-auto">
        {commits.map((commit) => (
          <li className="px-3 py-2" key={commit.sha}>
            <div className="text-xs">{commit.message}</div>
            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              <a
                className="underline underline-offset-2 hover:no-underline"
                href={commit.url}
                rel="noreferrer"
                target="_blank"
              >
                {commit.sha}
              </a>
              {" · "}
              {commit.author}
              {commit.date ? ` · ${new Date(commit.date).toLocaleDateString()}` : ""}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return undefined;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
