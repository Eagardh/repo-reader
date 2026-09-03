import type { BundledLanguage } from "shiki";

/**
 * Turns a raw tool call into the one-line summary shown in the transcript.
 *
 * The agent's tools all speak in terms of repositories, paths, and refs, so the
 * UI can say "Read src/index.ts (lines 1-120)" instead of dumping JSON at the
 * reader. Everything here is defensive: input arrives mid-stream and may be
 * partial or absent.
 */

type Unknown = Record<string, unknown>;

const asRecord = (value: unknown): Unknown =>
  typeof value === "object" && value !== null ? (value as Unknown) : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** `https://github.com/facebook/react` -> `facebook/react` */
export function shortRepoName(repo: string | undefined): string | undefined {
  if (!repo) return undefined;
  const cleaned = repo
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/, "");
  const [owner, name] = cleaned.split("/");
  return owner && name ? `${owner}/${name}` : cleaned || undefined;
}

export type ToolSummary = {
  /** Present-tense label, shown while the call is in flight. */
  running: string;
  /** Past-tense label, shown once the result is in. */
  done: string;
};

export function summarizeToolCall(
  toolName: string,
  input: unknown,
  output: unknown,
): ToolSummary {
  const args = asRecord(input);
  const result = asRecord(output);
  const repo = shortRepoName(asString(args.repo));

  switch (toolName) {
    case "resolve_repo": {
      const target = repo ?? "repository";
      const layout = asRecord(result.layout);
      const files = asNumber(layout.sourceFiles);
      return {
        running: `Opening ${target}`,
        done: files
          ? `Opened ${target} — ${files.toLocaleString()} source files`
          : `Opened ${target}`,
      };
    }

    case "list_repo_files": {
      const where = asString(args.path) ?? asString(args.pattern) ?? "the repository";
      const matched = asNumber(result.matched);
      return {
        running: `Listing files in ${where}`,
        done:
          matched === undefined
            ? `Listed files in ${where}`
            : `Found ${matched.toLocaleString()} ${matched === 1 ? "file" : "files"} in ${where}`,
      };
    }

    case "read_repo_file": {
      const path = asString(args.path) ?? "file";
      const from = asNumber(result.startLine);
      const to = asNumber(result.endLine);
      const range = from && to ? ` (lines ${from}–${to})` : "";
      return { running: `Reading ${path}`, done: `Read ${path}${range}` };
    }

    case "search_repo_code": {
      const pattern = asString(args.pattern) ?? "code";
      const total = asNumber(result.totalMatches);
      const files = Array.isArray(result.files) ? result.files.length : undefined;
      const where = files ? ` in ${files} ${files === 1 ? "file" : "files"}` : "";
      return {
        running: `Searching for /${pattern}/`,
        done:
          total === undefined
            ? `Searched for /${pattern}/`
            : `/${pattern}/ — ${total.toLocaleString()} ${total === 1 ? "match" : "matches"}${where}`,
      };
    }

    case "list_repo_commits": {
      const path = asString(args.path);
      const scope = path ? ` for ${path}` : repo ? ` in ${repo}` : "";
      const commits = Array.isArray(result.commits) ? result.commits.length : undefined;
      return {
        running: `Reading commit history${scope}`,
        done: commits
          ? `Read ${commits} recent ${commits === 1 ? "commit" : "commits"}${scope}`
          : `Read commit history${scope}`,
      };
    }

    case "web_fetch":
      return {
        running: `Fetching ${asString(args.url) ?? "page"}`,
        done: `Fetched ${asString(args.url) ?? "page"}`,
      };

    case "web_search": {
      const query = asString(args.query) ?? "the web";
      return { running: `Searching the web for "${query}"`, done: `Searched the web for "${query}"` };
    }

    case "todo":
      return { running: "Planning", done: "Updated plan" };

    default:
      return { running: toolName, done: toolName };
  }
}

/**
 * Shiki has no bundled grammar named "text", but `CodeBlock` falls back to it
 * for any language it cannot load, so it is the right value for "no
 * highlighting" even though the prop type does not admit it.
 */
const PLAIN = "text" as BundledLanguage;

/** Best-effort language tag for syntax highlighting a file we read. */
export function languageForPath(path: string | undefined): BundledLanguage {
  if (!path) return PLAIN;
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const byExtension: Record<string, BundledLanguage> = {
    ts: "typescript", tsx: "tsx", mts: "typescript", cts: "typescript",
    js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
    py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
    kt: "kotlin", swift: "swift", c: "c", h: "c", cpp: "cpp", cc: "cpp",
    hpp: "cpp", cs: "csharp", php: "php", ex: "elixir", exs: "elixir",
    erl: "erlang", hs: "haskell", scala: "scala", clj: "clojure",
    sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
    sql: "sql", graphql: "graphql", gql: "graphql", proto: "protobuf",
    json: "json", jsonc: "json", yaml: "yaml", yml: "yaml", toml: "toml",
    xml: "xml", html: "html", css: "css", scss: "scss", less: "less",
    md: "markdown", mdx: "mdx", rst: "rst",
    dockerfile: "dockerfile", tf: "hcl", hcl: "hcl", vue: "vue", svelte: "svelte",
  };
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (base === "dockerfile") return "dockerfile";
  if (base === "makefile") return "makefile";
  return byExtension[extension] ?? PLAIN;
}
