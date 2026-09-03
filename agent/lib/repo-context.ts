import { getRepo, parseRepoUrl, type RepoRef } from "./github";

/**
 * Every tool takes a repo string and an optional ref. When the ref is omitted
 * we need the repository's default branch, which costs an API call — cached by
 * the client, so repeated tool calls in one turn pay for it once.
 */
export async function resolveRef(
  repo: string,
  ref: string | undefined,
  signal?: AbortSignal,
): Promise<{ target: RepoRef; gitRef: string }> {
  const parsed = parseRepoUrl(repo);
  const explicit = ref ?? parsed.ref;
  if (explicit) {
    return { target: parsed, gitRef: explicit };
  }
  const metadata = await getRepo(parsed, signal);
  return { target: parsed, gitRef: metadata.default_branch };
}

/** Shared description text so every tool documents the argument the same way. */
export const REPO_ARG_DESCRIPTION =
  "The GitHub repository, as a URL (https://github.com/owner/repo) or the shorthand owner/repo.";

export const REF_ARG_DESCRIPTION =
  "Branch, tag, or commit SHA to read. Defaults to the repository's default branch.";
