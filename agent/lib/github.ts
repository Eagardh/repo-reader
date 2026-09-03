/**
 * Thin GitHub REST client used by the repo-reading tools.
 *
 * Everything here is read-only. A token is optional for public repos but
 * strongly recommended: unauthenticated calls are capped at 60 requests/hour,
 * and the code search endpoint rejects anonymous callers outright.
 */

const API = "https://api.github.com";

export const hasToken = () =>
  Boolean(process.env.GITHUB_TOKEN ?? process.env.GITHUB_PAT);

const token = () => process.env.GITHUB_TOKEN ?? process.env.GITHUB_PAT;

export class GitHubError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

/** A parsed `owner/repo` pointer, plus anything extra the URL carried. */
export type RepoRef = {
  owner: string;
  repo: string;
  /** Branch, tag, or commit SHA if the URL pinned one. */
  ref?: string;
  /** Sub-path if the URL pointed at a directory or file. */
  path?: string;
};

/**
 * Accepts the shapes people actually paste: full URLs, `.git` clone URLs,
 * deep links into a branch or file, and bare `owner/repo`.
 */
export function parseRepoUrl(input: string): RepoRef {
  const trimmed = input.trim().replace(/^git\+/, "");

  const sshMatch = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(trimmed);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  const shorthand = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(trimmed);
  if (shorthand) {
    return { owner: shorthand[1], repo: shorthand[2] };
  }

  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new GitHubError(
      `Could not read "${input}" as a GitHub repository. Use a URL like https://github.com/owner/repo or the shorthand owner/repo.`,
      400,
    );
  }

  if (!/(^|\.)github\.com$/.test(url.hostname)) {
    throw new GitHubError(
      `"${url.hostname}" is not github.com. This agent only reads repositories hosted on github.com.`,
      400,
    );
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new GitHubError(
      `The URL "${input}" does not name a repository. Expected https://github.com/owner/repo.`,
      400,
    );
  }

  const [owner, rawRepo, kind, ...rest] = segments;
  const repo = rawRepo.replace(/\.git$/, "");

  // /tree/<ref>/<path> and /blob/<ref>/<path> both pin a ref plus a sub-path.
  if ((kind === "tree" || kind === "blob") && rest.length > 0) {
    const [ref, ...pathParts] = rest;
    return {
      owner,
      repo,
      ref,
      path: pathParts.length > 0 ? pathParts.join("/") : undefined,
    };
  }

  return { owner, repo };
}

/** Cache keyed by request URL. Warm function instances reuse tree/blob reads. */
const cache = new Map<string, { at: number; value: unknown }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

function readCache<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function writeCache(key: string, value: unknown) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { at: Date.now(), value });
}

type RequestOptions = {
  /** `raw` returns file bytes as text instead of the JSON metadata envelope. */
  accept?: string;
  signal?: AbortSignal;
};

async function request<T>(
  path: string,
  { accept = "application/vnd.github+json", signal }: RequestOptions = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API}${path}`;
  const cacheKey = `${accept} ${url}`;

  const cached = readCache<T>(cacheKey);
  if (cached !== undefined) return cached;

  const headers: Record<string, string> = {
    accept,
    "user-agent": "git-agent",
    "x-github-api-version": "2022-11-28",
  };
  const auth = token();
  if (auth) headers.authorization = `Bearer ${auth}`;

  const response = await fetch(url, { headers, signal });

  if (!response.ok) {
    throw new GitHubError(await describeFailure(response), response.status);
  }

  const value = (
    accept.includes("json") ? await response.json() : await response.text()
  ) as T;

  writeCache(cacheKey, value);
  return value;
}

/** Turns a GitHub error response into something the model can act on. */
async function describeFailure(response: Response): Promise<string> {
  const remaining = response.headers.get("x-ratelimit-remaining");
  const body = await response.text().catch(() => "");
  const detail = (() => {
    try {
      return (JSON.parse(body) as { message?: string }).message ?? "";
    } catch {
      return body.slice(0, 200);
    }
  })();

  if (response.status === 404) {
    return `Not found (404). ${detail} The repository, ref, or path may not exist, or the repository is private and the configured token cannot see it.`;
  }

  if (response.status === 403 && remaining === "0") {
    const reset = response.headers.get("x-ratelimit-reset");
    const resetAt = reset
      ? new Date(Number(reset) * 1000).toISOString()
      : "shortly";
    return hasToken()
      ? `GitHub rate limit exhausted. It resets at ${resetAt}. Tell the user to wait, and stop making further GitHub calls this turn.`
      : `GitHub rate limit exhausted (anonymous requests are capped at 60/hour, resets at ${resetAt}). Tell the user to set a GITHUB_TOKEN environment variable to raise the limit to 5,000/hour.`;
  }

  if (response.status === 401) {
    return "GitHub rejected the credentials (401). The GITHUB_TOKEN is invalid or expired.";
  }

  return `GitHub request failed with ${response.status}. ${detail}`;
}

export type RepoMetadata = {
  full_name: string;
  private: boolean;
  description: string | null;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  size: number;
  topics?: string[];
  license?: { spdx_id?: string | null } | null;
  pushed_at: string;
  created_at: string;
  archived: boolean;
  homepage: string | null;
  html_url: string;
};

export const getRepo = (ref: RepoRef, signal?: AbortSignal) =>
  request<RepoMetadata>(`/repos/${ref.owner}/${ref.repo}`, { signal });

export const getLanguages = (ref: RepoRef, signal?: AbortSignal) =>
  request<Record<string, number>>(
    `/repos/${ref.owner}/${ref.repo}/languages`,
    { signal },
  );

export type TreeEntry = {
  path: string;
  /** `blob` is a file, `tree` is a directory. */
  type: "blob" | "tree" | "commit";
  size?: number;
  sha: string;
};

export type RepoTree = { tree: TreeEntry[]; truncated: boolean };

export async function getTree(
  ref: RepoRef,
  gitRef: string,
  signal?: AbortSignal,
): Promise<RepoTree> {
  const result = await request<{ tree: TreeEntry[]; truncated?: boolean }>(
    `/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(gitRef)}?recursive=1`,
    { signal },
  );
  return { tree: result.tree ?? [], truncated: Boolean(result.truncated) };
}

const RAW_HOST = "https://raw.githubusercontent.com";

const encodePath = (path: string) =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

/**
 * Fetches file bytes as text. Binary files are rejected by the caller.
 *
 * Reads go to raw.githubusercontent.com first. It is a CDN rather than part of
 * the REST API, so it carries no `x-ratelimit-*` budget at all — and since file
 * reads are the most frequent call an agent makes, keeping them off the hourly
 * limit is what makes long research sessions possible without a token.
 *
 * The API contents endpoint is the fallback. It costs a request but resolves
 * cases the CDN will not, and reports permission errors properly.
 */
export async function getRawFile(
  ref: RepoRef,
  path: string,
  gitRef: string,
  signal?: AbortSignal,
): Promise<string> {
  const encodedPath = encodePath(path);
  try {
    return await request<string>(
      `${RAW_HOST}/${ref.owner}/${ref.repo}/${encodeURIComponent(gitRef)}/${encodedPath}`,
      { accept: "text/plain", signal },
    );
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 404) throw error;
    return request<string>(
      `/repos/${ref.owner}/${ref.repo}/contents/${encodedPath}?ref=${encodeURIComponent(gitRef)}`,
      { accept: "application/vnd.github.raw", signal },
    );
  }
}

export type TextMatch = {
  fragment: string;
  matches: { text: string; indices: [number, number] }[];
};

export type CodeSearchResult = {
  total_count: number;
  incomplete_results: boolean;
  items: {
    path: string;
    html_url: string;
    repository: { full_name: string };
    text_matches?: TextMatch[];
  }[];
};

/**
 * GitHub's code search index. Requires authentication — anonymous callers get
 * a 403 — so the tool checks `hasToken()` before reaching this far.
 * The `text-match` media type is what makes results useful: it returns the
 * matching fragments, not just paths.
 */
export function searchCode(
  ref: RepoRef,
  query: string,
  perPage: number,
  signal?: AbortSignal,
): Promise<CodeSearchResult> {
  const q = `${query} repo:${ref.owner}/${ref.repo}`;
  return request<CodeSearchResult>(
    `/search/code?q=${encodeURIComponent(q)}&per_page=${perPage}`,
    { accept: "application/vnd.github.text-match+json", signal },
  );
}

export type Commit = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
};

export function listCommits(
  ref: RepoRef,
  gitRef: string,
  options: { path?: string; perPage: number },
  signal?: AbortSignal,
): Promise<Commit[]> {
  const params = new URLSearchParams({
    sha: gitRef,
    per_page: String(options.perPage),
  });
  if (options.path) params.set("path", options.path);
  return request<Commit[]>(
    `/repos/${ref.owner}/${ref.repo}/commits?${params}`,
    { signal },
  );
}
