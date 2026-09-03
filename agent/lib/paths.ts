/**
 * Heuristics for deciding which files in a repository are worth a model's
 * attention. Repos are mostly noise by byte count — lockfiles, vendored
 * dependencies, build output, minified bundles — and the context window is
 * the scarce resource.
 */

const NOISE_DIRECTORIES = [
  "node_modules",
  "vendor",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "target",
  "coverage",
  "__pycache__",
  ".venv",
  "site-packages",
  ".git",
  ".yarn",
  "Pods",
  "DerivedData",
];

const NOISE_FILES = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "composer.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "go.sum",
];

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "tiff",
  "mp3", "mp4", "wav", "ogg", "webm", "mov", "avi", "flac",
  "woff", "woff2", "ttf", "otf", "eot",
  "zip", "gz", "tar", "bz2", "xz", "7z", "rar",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "so", "dylib", "dll", "exe", "bin", "wasm", "class", "jar", "pyc",
  "db", "sqlite", "parquet",
]);

export const extensionOf = (path: string) => {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
};

export const isBinaryPath = (path: string) =>
  BINARY_EXTENSIONS.has(extensionOf(path));

/** Generated, vendored, or otherwise not worth reading as source. */
export function isNoisePath(path: string): boolean {
  const segments = path.split("/");
  if (segments.some((segment) => NOISE_DIRECTORIES.includes(segment))) {
    return true;
  }
  const base = segments[segments.length - 1];
  if (NOISE_FILES.includes(base)) return true;
  if (/\.min\.(js|css)$/.test(base)) return true;
  if (/\.map$/.test(base)) return true;
  return isBinaryPath(path);
}

/**
 * Minimal glob matcher covering `*`, `?`, `**`, and `{a,b}` alternation —
 * enough for the patterns a model actually writes (`src/**\/*.ts`, `*.py`).
 */
export function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` may match zero directories, so the slash is part of the group.
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (char === "?") {
      out += "[^/]";
    } else if (char === "{") {
      out += "(?:";
    } else if (char === "}") {
      out += ")";
    } else if (char === "," ) {
      out += "|";
    } else {
      out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`, "i");
}

/** Matches a bare `*.ts` against any depth, the way people expect it to. */
export function matchesGlob(path: string, pattern: string): boolean {
  if (globToRegExp(pattern).test(path)) return true;
  if (!pattern.includes("/")) {
    return globToRegExp(`**/${pattern}`).test(path);
  }
  return false;
}

/**
 * Files that describe a project's shape. Surfaced first so the agent can
 * orient itself in one call rather than crawling.
 */
const ENTRYPOINT_PATTERNS = [
  /^readme(\.md|\.rst|\.txt)?$/i,
  /^(package|deno|composer)\.json$/i,
  /^(pyproject|cargo)\.toml$/i,
  /^go\.mod$/i,
  /^(gemfile|makefile|dockerfile|justfile)$/i,
  /^requirements.*\.txt$/i,
  /^(pom|build)\.(xml|gradle|gradle\.kts|sbt)$/i,
  /^(tsconfig|next\.config|vite\.config|nuxt\.config|svelte\.config|astro\.config)\..*$/i,
  /^docker-compose\.ya?ml$/i,
  /^(contributing|architecture|agents|claude)\.md$/i,
  /^\.env\.example$/i,
];

export function isEntrypointFile(path: string): boolean {
  const depth = path.split("/").length;
  if (depth > 2) return false;
  const base = path.slice(path.lastIndexOf("/") + 1);
  return ENTRYPOINT_PATTERNS.some((pattern) => pattern.test(base));
}
