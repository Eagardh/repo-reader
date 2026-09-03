/**
 * Clones repositories into the agent's sandbox so search runs against real
 * files with ripgrep instead of GitHub's code search index.
 *
 * GitHub's index is exact-match only, needs a token, and covers just the
 * default branch. `rg` has none of those limits. The cost is a shallow clone
 * on first use, so cloning is lazy: questions that never need search never
 * pay for it.
 *
 * The sandbox is not always usable — eve falls back to `just-bash`, which has
 * no real binaries and no network, when Docker/microsandbox/Vercel Sandbox are
 * all unavailable. Every function here reports that as a typed outcome rather
 * than throwing, so callers can fall back to the HTTP path.
 */

import type { SandboxSession } from "eve/sandbox";
import type { RepoRef } from "./github";

const CLONE_ROOT = "/workspace/repos";

/** Rejects anything that could break out of the single-quoted shell strings. */
const SAFE_SEGMENT = /^[\w.-]+$/;
const SAFE_REF = /^[\w.\-/]+$/;
const SHA = /^[0-9a-f]{7,40}$/i;

/** Wraps a value for safe interpolation into a single-quoted shell string. */
export const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

export class SandboxUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxUnavailableError";
  }
}

function assertSafe(ref: RepoRef, gitRef: string) {
  if (!SAFE_SEGMENT.test(ref.owner) || !SAFE_SEGMENT.test(ref.repo)) {
    throw new Error(`Invalid repository name: ${ref.owner}/${ref.repo}`);
  }
  if (!SAFE_REF.test(gitRef)) {
    throw new Error(`Invalid git ref: ${gitRef}`);
  }
}

const cloneDirFor = (ref: RepoRef, gitRef: string) =>
  `${CLONE_ROOT}/${ref.owner}__${ref.repo}__${gitRef.replaceAll("/", "-")}`;

/**
 * Remembers which repos are already on disk, keyed by sandbox id (stable for
 * the life of a session). Only an optimization — the clone script is
 * idempotent, so a cold instance just re-runs a cheap no-op.
 */
const clonedBySandbox = new Map<string, Set<string>>();

/**
 * Shallow-clones the repo into the sandbox if it is not already there.
 * Returns the directory the working tree lives in.
 */
export async function ensureRepoCloned(
  sandbox: SandboxSession,
  ref: RepoRef,
  gitRef: string,
  signal?: AbortSignal,
): Promise<string> {
  assertSafe(ref, gitRef);
  const dir = cloneDirFor(ref, gitRef);

  const known = clonedBySandbox.get(sandbox.id);
  if (known?.has(dir)) return dir;

  const url = `https://github.com/${ref.owner}/${ref.repo}.git`;
  const token = process.env.GITHUB_TOKEN ?? process.env.GITHUB_PAT;

  // Reads the token from the environment rather than the command line, so it
  // never lands in argv or shell history inside the sandbox.
  const auth = token
    ? `-c ${shellQuote(
        "credential.helper=!f() { echo username=x-access-token; echo password=$GH_TOKEN; }; f",
      )}`
    : "";

  // A SHA cannot be cloned with --branch; it has to be fetched explicitly.
  const fetchCommands = SHA.test(gitRef)
    ? `git init -q ${shellQuote(dir)}
git -C ${shellQuote(dir)} remote add origin ${shellQuote(url)}
git ${auth} -C ${shellQuote(dir)} fetch --depth 1 origin ${shellQuote(gitRef)}
git -C ${shellQuote(dir)} checkout -q FETCH_HEAD`
    : `git ${auth} clone --depth 1 --single-branch --branch ${shellQuote(gitRef)} ${shellQuote(url)} ${shellQuote(dir)}`;

  const script = `set -eu
command -v git >/dev/null 2>&1 || { echo "__NO_GIT__"; exit 90; }
if [ -e ${shellQuote(`${dir}/.git`)} ]; then echo "__PRESENT__"; exit 0; fi
rm -rf ${shellQuote(dir)}
mkdir -p ${shellQuote(CLONE_ROOT)}
${fetchCommands}
echo "__CLONED__"`;

  let result: { exitCode: number; stdout: string; stderr: string };
  try {
    result = await sandbox.run({
      command: script,
      ...(token ? { env: { GH_TOKEN: token } } : {}),
      ...(signal ? { abortSignal: signal } : {}),
    });
  } catch (error) {
    throw new SandboxUnavailableError(
      `The sandbox could not run a command: ${(error as Error).message}`,
    );
  }

  if (result.exitCode === 90 || result.stdout.includes("__NO_GIT__")) {
    throw new SandboxUnavailableError(
      "The sandbox has no `git` binary, so the repository cannot be cloned.",
    );
  }

  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(0, 400);
    // A bad ref or a private repo is the caller's problem to report, not a
    // reason to fall back to a path that will fail the same way.
    throw new Error(`git clone failed for ${ref.owner}/${ref.repo}@${gitRef}: ${detail}`);
  }

  const set = clonedBySandbox.get(sandbox.id) ?? new Set<string>();
  set.add(dir);
  clonedBySandbox.set(sandbox.id, set);
  return dir;
}

export type GrepMatch = { path: string; line: number; text: string };

/** Runs ripgrep over a cloned working tree. */
export async function ripgrep(
  sandbox: SandboxSession,
  dir: string,
  options: {
    pattern: string;
    globs?: string[];
    caseInsensitive?: boolean;
    maxCount: number;
    fixedString?: boolean;
  },
  signal?: AbortSignal,
): Promise<GrepMatch[]> {
  const flags = [
    "--line-number",
    "--no-heading",
    "--color=never",
    "--max-columns=300",
    "--max-columns-preview",
    `--max-count=${Math.max(1, Math.min(20, options.maxCount))}`,
    "--glob=!.git/*",
    options.caseInsensitive ? "--ignore-case" : "",
    options.fixedString ? "--fixed-strings" : "",
    ...(options.globs ?? []).map((glob) => `--glob=${shellQuote(glob)}`),
  ].filter(Boolean);

  // Search "." from inside the clone so ripgrep emits repo-relative paths.
  // Stripping an absolute prefix afterwards works right up until the path is
  // normalized differently than expected, and then it silently leaks
  // /workspace/... into the model's answer.
  const command = [
    "command -v rg >/dev/null 2>&1 || { echo __NO_RG__; exit 90; };",
    "rg",
    ...flags,
    "-e",
    shellQuote(options.pattern),
    "--",
    ".",
  ].join(" ");

  let result: { exitCode: number; stdout: string; stderr: string };
  try {
    result = await sandbox.run({
      command,
      workingDirectory: dir,
      ...(signal ? { abortSignal: signal } : {}),
    });
  } catch (error) {
    throw new SandboxUnavailableError(
      `The sandbox could not run ripgrep: ${(error as Error).message}`,
    );
  }

  if (result.exitCode === 90 || result.stdout.includes("__NO_RG__")) {
    throw new SandboxUnavailableError("The sandbox has no `rg` binary.");
  }

  // ripgrep exits 1 when there are simply no matches; that is a result, not a
  // failure, and the model needs to see it as "nothing found".
  if (result.exitCode === 1) return [];

  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(0, 300);
    throw new Error(`Search failed: ${detail}`);
  }

  return parseRipgrepOutput(result.stdout, dir);
}

/** Parses ripgrep's `path:line:text` lines into repo-relative matches. */
export function parseRipgrepOutput(stdout: string, dir: string): GrepMatch[] {
  const prefix = `${dir}/`;
  const matches: GrepMatch[] = [];

  for (const raw of stdout.split("\n")) {
    if (!raw) continue;
    // Paths arrive as "./src/x.ts" from the cwd search. The absolute-prefix
    // strip stays as a fallback for backends that resolve "." eagerly.
    const withoutDir = raw.startsWith(prefix)
      ? raw.slice(prefix.length)
      : raw.startsWith("./")
        ? raw.slice(2)
        : raw;
    const firstColon = withoutDir.indexOf(":");
    if (firstColon === -1) continue;
    const secondColon = withoutDir.indexOf(":", firstColon + 1);
    if (secondColon === -1) continue;

    const line = Number(withoutDir.slice(firstColon + 1, secondColon));
    if (!Number.isInteger(line)) continue;

    matches.push({
      path: withoutDir.slice(0, firstColon),
      line,
      text: withoutDir.slice(secondColon + 1).trim().slice(0, 300),
    });
  }

  return matches;
}
