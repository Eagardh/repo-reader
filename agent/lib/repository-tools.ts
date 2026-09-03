import { z } from "zod";
import {
  getLanguages,
  getRawFile,
  getRepo,
  getTree,
  GitHubError,
  hasToken,
  listCommits,
  parseRepoUrl,
  searchCode,
} from "./github";
import { isBinaryPath, isEntrypointFile, isNoisePath, matchesGlob } from "./paths";
import { REF_ARG_DESCRIPTION, REPO_ARG_DESCRIPTION, resolveRef } from "./repo-context";
import {
  ensureRepoCloned,
  ripgrep,
  SandboxUnavailableError,
} from "./workspace";

const MAX_TOP_LEVEL_ENTRIES = 60;
const DEFAULT_FILE_LIMIT = 200;
const MAX_FILE_LIMIT = 800;
const DEFAULT_MAX_LINES = 500;
const HARD_MAX_LINES = 2000;
const MAX_CHARS = 120_000;
const DEFAULT_SEARCH_LIMIT = 40;
const DEFAULT_COMMIT_LIMIT = 20;

export const repositoryToolDescriptions = {
  resolve:
    "Open a GitHub repository and get your bearings: metadata, language breakdown, the top-level layout, and the config/doc files that describe how the project is built. Call this first whenever the user names a repository you have not opened yet in this conversation.",
  listFiles:
    "List files in a GitHub repository. Filter by directory prefix and/or a glob pattern (for example 'src/**/*.ts' or '*.py'). Use this to find the files worth reading before calling read_repo_file.",
  readFile:
    "Read the actual contents of a file in a GitHub repository, returned with line numbers so you can cite exact lines. Read a specific line range for large files.",
  search:
    "Search the contents of a repository and get matching lines with their file paths and line numbers. Prefer it over listing and reading files whenever you know roughly what you are looking for.",
  commits:
    "List recent commits for a repository, optionally scoped to a single file or directory. Use this for questions about history, recent activity, or who changed what.",
} as const;

export const resolveRepoInputSchema = z.object({
  repo: z.string().min(1).describe(REPO_ARG_DESCRIPTION),
  ref: z.string().optional().describe(REF_ARG_DESCRIPTION),
});

export const listRepoFilesInputSchema = z.object({
  repo: z.string().min(1).describe(REPO_ARG_DESCRIPTION),
  ref: z.string().optional().describe(REF_ARG_DESCRIPTION),
  path: z
    .string()
    .optional()
    .describe(
      "Only list files under this directory, e.g. 'src/components'. Omit to list from the repository root.",
    ),
  pattern: z
    .string()
    .optional()
    .describe(
      "Glob filter applied to the full path, e.g. '**/*.test.ts' or '*.md'. Supports *, **, ? and {a,b}.",
    ),
  includeGenerated: z
    .boolean()
    .optional()
    .describe(
      "Include lockfiles, build output, vendored dependencies, and binaries. Off by default because they are rarely worth reading.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_FILE_LIMIT)
    .optional()
    .describe(`Maximum number of files to return. Defaults to ${DEFAULT_FILE_LIMIT}.`),
});

export const readRepoFileInputSchema = z.object({
  repo: z.string().min(1).describe(REPO_ARG_DESCRIPTION),
  path: z
    .string()
    .min(1)
    .describe("Path to the file within the repository, e.g. 'src/index.ts'."),
  ref: z.string().optional().describe(REF_ARG_DESCRIPTION),
  startLine: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("First line to return (1-indexed). Defaults to the start of the file."),
  endLine: z.number().int().min(1).optional().describe("Last line to return, inclusive."),
  maxLines: z
    .number()
    .int()
    .min(1)
    .max(HARD_MAX_LINES)
    .optional()
    .describe(`Cap on how many lines to return. Defaults to ${DEFAULT_MAX_LINES}.`),
});

export const searchRepoCodeInputSchema = z.object({
  repo: z.string().min(1).describe(REPO_ARG_DESCRIPTION),
  pattern: z
    .string()
    .min(1)
    .describe(
      "Text or regular expression to search for, e.g. 'createClient' or 'export function (get|set)[A-Z]'.",
    ),
  ref: z.string().optional().describe(REF_ARG_DESCRIPTION),
  glob: z
    .array(z.string())
    .optional()
    .describe(
      "Restrict the search to matching paths, e.g. ['src/**/*.ts', '!**/*.test.ts']. A leading ! excludes.",
    ),
  caseInsensitive: z.boolean().optional().describe("Ignore case. Off by default."),
  literal: z
    .boolean()
    .optional()
    .describe("Treat the pattern as literal text instead of a regex."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe(`Maximum number of matching lines to return. Defaults to ${DEFAULT_SEARCH_LIMIT}.`),
});

export const listRepoCommitsInputSchema = z.object({
  repo: z.string().min(1).describe(REPO_ARG_DESCRIPTION),
  ref: z.string().optional().describe(REF_ARG_DESCRIPTION),
  path: z.string().optional().describe("Only return commits touching this file or directory."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(`Maximum number of commits. Defaults to ${DEFAULT_COMMIT_LIMIT}.`),
});

export type ResolveRepoInput = z.infer<typeof resolveRepoInputSchema>;
export type ListRepoFilesInput = z.infer<typeof listRepoFilesInputSchema>;
export type ReadRepoFileInput = z.infer<typeof readRepoFileInputSchema>;
export type SearchRepoCodeInput = z.infer<typeof searchRepoCodeInputSchema>;
export type ListRepoCommitsInput = z.infer<typeof listRepoCommitsInputSchema>;

type SearchContext = {
  abortSignal?: AbortSignal;
  getSandbox?: () => Promise<Parameters<typeof ensureRepoCloned>[0]>;
};

/** Reject private repositories before an MCP operation can use the server token. */
export async function assertPublicRepository(repo: string, signal?: AbortSignal) {
  const target = parseRepoUrl(repo);
  const metadata = await getRepo(target, signal);
  if (metadata.private) {
    throw new GitHubError(
      `The MCP server only supports public repositories; ${metadata.full_name} is private.`,
      403,
    );
  }
}

export async function resolveRepository(
  { repo, ref }: ResolveRepoInput,
  signal?: AbortSignal,
) {
  const target = parseRepoUrl(repo);
  const metadata = await getRepo(target, signal);
  const gitRef = ref ?? target.ref ?? metadata.default_branch;

  const [languages, tree] = await Promise.all([
    getLanguages(target, signal).catch(() => ({}) as Record<string, number>),
    getTree(target, gitRef, signal),
  ]);

  const files = tree.tree.filter((entry) => entry.type === "blob");
  const meaningful = files.filter((entry) => !isNoisePath(entry.path));
  const topLevelDirectories = new Set<string>();
  const topLevelFiles: string[] = [];

  for (const entry of tree.tree) {
    const slash = entry.path.indexOf("/");
    if (slash === -1) {
      if (entry.type === "tree") topLevelDirectories.add(entry.path);
      else topLevelFiles.push(entry.path);
    } else {
      topLevelDirectories.add(entry.path.slice(0, slash));
    }
  }

  const fileCountByDirectory = new Map<string, number>();
  for (const entry of meaningful) {
    const slash = entry.path.indexOf("/");
    const bucket = slash === -1 ? "." : entry.path.slice(0, slash);
    fileCountByDirectory.set(bucket, (fileCountByDirectory.get(bucket) ?? 0) + 1);
  }

  const directories = [...topLevelDirectories]
    .filter((name) => !isNoisePath(name))
    .map((name) => ({ path: name, files: fileCountByDirectory.get(name) ?? 0 }))
    .sort((a, b) => b.files - a.files)
    .slice(0, MAX_TOP_LEVEL_ENTRIES);

  const totalLanguageBytes = Object.values(languages).reduce((sum, n) => sum + n, 0);

  return {
    repository: {
      fullName: metadata.full_name,
      url: metadata.html_url,
      description: metadata.description,
      homepage: metadata.homepage || null,
      defaultBranch: metadata.default_branch,
      readingRef: gitRef,
      primaryLanguage: metadata.language,
      license: metadata.license?.spdx_id ?? null,
      topics: metadata.topics ?? [],
      stars: metadata.stargazers_count,
      forks: metadata.forks_count,
      openIssues: metadata.open_issues_count,
      archived: metadata.archived,
      createdAt: metadata.created_at,
      lastPushedAt: metadata.pushed_at,
      sizeKb: metadata.size,
    },
    languages: Object.entries(languages)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, bytes]) => ({
        name,
        percent:
          totalLanguageBytes > 0
            ? Number(((bytes / totalLanguageBytes) * 100).toFixed(1))
            : 0,
      })),
    layout: {
      totalFiles: files.length,
      sourceFiles: meaningful.length,
      directories,
      rootFiles: topLevelFiles
        .filter((path) => !isNoisePath(path))
        .slice(0, MAX_TOP_LEVEL_ENTRIES),
      treeTruncated: tree.truncated,
    },
    keyFiles: meaningful
      .filter((entry) => isEntrypointFile(entry.path))
      .map((entry) => entry.path)
      .sort()
      .slice(0, 30),
    notes: [
      tree.truncated
        ? "The repository is large enough that GitHub truncated its file tree. Use list_repo_files with a path filter to explore specific directories."
        : null,
      hasToken()
        ? null
        : "No GITHUB_TOKEN is configured, so GitHub API calls are limited to 60/hour. File reads do not count against that, but repeated listings do.",
    ].filter((note): note is string => note !== null),
  };
}

export async function listRepositoryFiles(
  {
    repo,
    ref,
    path,
    pattern,
    includeGenerated = false,
    limit = DEFAULT_FILE_LIMIT,
  }: ListRepoFilesInput,
  signal?: AbortSignal,
) {
  const { target, gitRef } = await resolveRef(repo, ref, signal);
  const tree = await getTree(target, gitRef, signal);
  const prefix = path ? `${path.replace(/^\/+|\/+$/g, "")}/` : "";
  let files = tree.tree.filter((entry) => entry.type === "blob");

  if (prefix) {
    files = files.filter(
      (entry) => entry.path.startsWith(prefix) || entry.path === path,
    );
  }
  if (!includeGenerated) files = files.filter((entry) => !isNoisePath(entry.path));
  if (pattern) files = files.filter((entry) => matchesGlob(entry.path, pattern));

  const matched = files.length;
  const page = files
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((entry) => ({ path: entry.path, bytes: entry.size ?? 0 }));

  return {
    ref: gitRef,
    matched,
    returned: page.length,
    truncated: matched > page.length || tree.truncated,
    files: page,
    ...(matched > page.length
      ? {
          hint: `${matched - page.length} more files matched. Narrow the search with 'path' or 'pattern' rather than raising 'limit'.`,
        }
      : {}),
  };
}

export async function readRepositoryFile(
  {
    repo,
    path,
    ref,
    startLine,
    endLine,
    maxLines = DEFAULT_MAX_LINES,
  }: ReadRepoFileInput,
  signal?: AbortSignal,
) {
  if (isBinaryPath(path)) {
    throw new GitHubError(
      `"${path}" looks like a binary file. Its contents cannot be read as text.`,
      415,
    );
  }

  const { target, gitRef } = await resolveRef(repo, ref, signal);
  const raw = await getRawFile(target, path, gitRef, signal);

  if (raw.length > MAX_CHARS && !startLine && !endLine) {
    const lines = raw.split("\n");
    return {
      path,
      ref: gitRef,
      totalLines: lines.length,
      startLine: 1,
      endLine: Math.min(maxLines, lines.length),
      truncated: true,
      note: `This file is ${raw.length.toLocaleString()} characters. Showing the first ${maxLines} lines; request a line range to read further.`,
      content: withLineNumbers(lines.slice(0, maxLines), 1),
    };
  }

  const lines = raw.split("\n");
  const from = Math.max(1, startLine ?? 1);
  const requestedTo = endLine ?? lines.length;
  const to = Math.min(lines.length, requestedTo, from + maxLines - 1);

  if (from > lines.length) {
    return {
      path,
      ref: gitRef,
      totalLines: lines.length,
      startLine: from,
      endLine: lines.length,
      truncated: false,
      note: `Requested start line ${from} is past the end of the file (${lines.length} lines).`,
      content: "",
    };
  }

  return {
    path,
    ref: gitRef,
    totalLines: lines.length,
    startLine: from,
    endLine: to,
    truncated: to < Math.min(lines.length, requestedTo),
    content: withLineNumbers(lines.slice(from - 1, to), from),
  };
}

export async function searchRepositoryCode(
  {
    repo,
    pattern,
    ref,
    glob,
    caseInsensitive,
    literal,
    limit = DEFAULT_SEARCH_LIMIT,
  }: SearchRepoCodeInput,
  context: SearchContext = {},
) {
  const { abortSignal: signal, getSandbox } = context;
  const { target, gitRef } = await resolveRef(repo, ref, signal);

  if (getSandbox) {
    try {
      const sandbox = await getSandbox();
      const dir = await ensureRepoCloned(sandbox, target, gitRef, signal);
      const matches = await ripgrep(
        sandbox,
        dir,
        {
          pattern,
          globs: glob,
          caseInsensitive,
          fixedString: literal,
          maxCount: 5,
        },
        signal,
      );

      const page = matches.slice(0, limit);
      const byFile = new Map<string, { line: number; text: string }[]>();
      for (const match of page) {
        const list = byFile.get(match.path) ?? [];
        list.push({ line: match.line, text: match.text });
        byFile.set(match.path, list);
      }

      return {
        engine: "ripgrep" as const,
        ref: gitRef,
        pattern,
        totalMatches: matches.length,
        returned: page.length,
        truncated: matches.length > page.length,
        files: [...byFile.entries()].map(([path, lines]) => ({ path, lines })),
        ...(matches.length === 0
          ? {
              hint: "No matches. The search covered every file in the working tree, so the term genuinely is not there — try a different identifier or a looser pattern.",
            }
          : {}),
      };
    } catch (error) {
      if (!(error instanceof SandboxUnavailableError)) throw error;
    }
  }

  if (!hasToken()) {
    throw new Error(
      "Repository code search needs a GITHUB_TOKEN because no sandbox is available. Use list_repo_files and read_repo_file instead, or configure a read-only token.",
    );
  }

  const result = await searchCode(target, pattern, Math.min(limit, 50), signal);
  return {
    engine: "github-code-search" as const,
    ref: "default branch",
    pattern,
    totalMatches: result.total_count,
    returned: result.items.length,
    truncated: result.incomplete_results,
    files: result.items.map((item) => ({
      path: item.path,
      lines: (item.text_matches ?? [])
        .map((match) => ({ line: 0, text: match.fragment.trim() }))
        .filter((entry) => entry.text)
        .slice(0, 3),
    })),
    note: "Searched GitHub's code index because this caller has no sandbox. It matches indexed terms rather than regular expressions, has no exact line numbers, and covers the default branch only.",
  };
}

export async function listRepositoryCommits(
  { repo, ref, path, limit = DEFAULT_COMMIT_LIMIT }: ListRepoCommitsInput,
  signal?: AbortSignal,
) {
  const { target, gitRef } = await resolveRef(repo, ref, signal);
  const commits = await listCommits(target, gitRef, { path, perPage: limit }, signal);

  return {
    ref: gitRef,
    path: path ?? null,
    commits: commits.map((commit) => ({
      sha: commit.sha.slice(0, 8),
      url: commit.html_url,
      author: commit.commit.author?.name ?? "unknown",
      date: commit.commit.author?.date ?? null,
      message: commit.commit.message.split("\n")[0],
    })),
  };
}

function withLineNumbers(lines: string[], firstLineNumber: number): string {
  const width = String(firstLineNumber + lines.length - 1).length;
  return lines
    .map((line, index) => `${String(firstLineNumber + index).padStart(width)}\t${line}`)
    .join("\n");
}
