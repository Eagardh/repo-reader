# Repo Reader

[![Release](https://img.shields.io/github/v/release/Eagardh/repo-reader)](https://github.com/Eagardh/repo-reader/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A chat app for asking questions about GitHub repositories, where the agent
actually opens the repo and reads the files.

Paste a repository link, ask a question, and the agent walks the real file tree,
reads the source that bears on your question, and answers with citations to
specific files and lines. It is not summarizing the README.

Repo Reader is a self-hosted project. It does not connect to an
author-operated application, database, or Vercel project. Your installation
uses only the infrastructure and credentials that you configure.

## How it works

| Piece | What it does |
| --- | --- |
| [eve](https://eve.dev) | Runs the agent. The agent is the `agent/` directory: instructions, tools, and route auth as files. |
| [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) | Routes the model call. Change the model by editing one string in `agent/agent.ts`. |
| [AI Elements](https://ai-sdk.dev/elements) | The chat UI components in `components/ai-elements/`. |
| Next.js 16 | Hosts both. `withEve()` mounts the agent at `/eve/v1/*` on this app's origin. |
| [Postgres](https://www.postgresql.org) | Stores the chat index behind the sidebar. Neon is one convenient option, but any compatible database you own works. |

The agent has five read-only tools over the GitHub REST API:

- `resolve_repo` — metadata, language mix, top-level layout, and the config and
  doc files that explain the project. Called first, to get oriented.
- `list_repo_files` — the file tree, filtered by directory or glob.
- `read_repo_file` — file contents, with line numbers, and line-range reads for
  large files.
- `search_repo_code` — real regex search (alternation, path globs, any branch)
  over a shallow clone in the agent's sandbox, returning file paths and line
  numbers.
- `list_repo_commits` — recent history, for the repo or a single path.

Lockfiles, build output, vendored dependencies, and binaries are filtered out of
listings by default (`agent/lib/paths.ts`), because the context window is the
scarce resource and none of that is worth reading.

### Reading strategy

Orientation and file reads go over HTTP; search goes through a clone.

`resolve_repo` and `list_repo_files` use the REST API, so the first answer costs
about a second and questions that never need search never clone anything. File
reads go to `raw.githubusercontent.com`, which is a CDN rather than part of the
REST API and so consumes no rate limit at all — reads are the most frequent call
an agent makes, and keeping them off the hourly budget is what makes long
sessions work without a token.

`search_repo_code` shallow-clones into the agent's sandbox on first use and runs
ripgrep. GitHub's code search index is exact-match only, needs a token, and
covers just the default branch; `rg` has none of those limits. The clone happens
lazily, so only questions that earn the few seconds pay for them.

When no sandbox backend is available — eve falls back to `just-bash`, which has
no real binaries and no network — search degrades to GitHub's code search index
and says so in its result, rather than failing.

The model-facing `bash`, `read_file`, and `write_file` tools are disabled, so the
model cannot run arbitrary shell. The clone command is built by
`agent/lib/workspace.ts` from a validated owner, repo, and ref, and any token is
passed through the environment rather than the command line.

## Quick start: MCP server

With Node.js 22.22.2 or newer and Git installed, the MCP server can run without
a database or model API key:

```bash
git clone https://github.com/YOUR_USERNAME/repo-reader.git
cd repo-reader
npm install
npm run mcp:dev
```

Connect an MCP client to `http://localhost:3001/api/mcp`. Four tools work
without credentials. To enable higher API limits and `search_repo_code`, copy
`.env.example` to `.env.local`, add a read-only `GITHUB_TOKEN`, and load it when
starting the standalone server:

```bash
npx dotenv -e .env.local -- npm run mcp:dev
```

## Run the full web app

### Prerequisites

- Node.js 22.22.2 or newer
- Git
- A Postgres database, such as a Neon project you own
- A Vercel AI Gateway API key for the chat agent
- Optionally, a read-only GitHub token for higher API limits and MCP code search

If you have not already cloned your fork:

```bash
git clone https://github.com/YOUR_USERNAME/repo-reader.git
cd repo-reader
npm install
cp .env.example .env.local
```

Fill in `.env.local` with credentials from services you control:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | For the web app | Postgres connection used by the chat-history sidebar. |
| `AI_GATEWAY_API_KEY` | For the web app | Authenticates model calls through your Vercel AI Gateway account. |
| `GITHUB_TOKEN` | Optional | Raises GitHub API limits and enables indexed code search for MCP callers. |

Use a least-privilege, read-only GitHub token. Public repository metadata,
listings, file reads, and commits work without one.

Initialize the database:

```bash
npx dotenv -e .env.local -- npx tsx scripts/db-setup.mts
```

The setup script is idempotent, so it is safe to run again. Start the local app:

```bash
npm run dev
```

Open `http://localhost:3000`. One development server runs both the Next.js app
and the eve agent.

## MCP server

The same five read-only repository tools are available to MCP clients at
`/api/mcp`. The endpoint only accepts public GitHub repositories, even when the
deployment has a token that can see private repositories.

Run the Next.js app and connect an MCP client to:

```text
http://localhost:3000/api/mcp
```

Or run the MCP server and its inspector independently:

```bash
npm run mcp:dev
```

That serves the MCP endpoint on `http://localhost:3001/api/mcp` and the local
inspector alongside it. In production, use the deployed app URL followed by
`/api/mcp` when configuring Claude, ChatGPT, Codex, or an API client.

`search_repo_code` uses GitHub's indexed code search for MCP callers and needs
`GITHUB_TOKEN`. The other four MCP tools work for public repositories without a
token, subject to GitHub's anonymous rate limit.

The MCP endpoint itself has no user authentication. Its tools enforce public
repositories, but callers can still consume your GitHub API quota. Add edge
authentication or rate limiting before operating it as a shared public service.

## Self-hosting

### Any Node.js host

Provide the same environment variables through your hosting platform, then run:

```bash
npm ci
npm run build
npm start
```

The server listens on the platform-provided `PORT`. Point your MCP client to
`https://YOUR_DOMAIN/api/mcp`.

An MCP-only deployment does not need `DATABASE_URL` or `AI_GATEWAY_API_KEY`.
Those variables are only needed for the web chat and its history sidebar.

The default eve channel policy in `agent/channels/eve.ts` permits local
development and callers authenticated by Vercel OIDC. Before deploying the web
chat somewhere else, replace or extend that policy with authentication for your
users. Do not expose the model-backed chat endpoint anonymously unless you
intend to pay for every request.

### Your own Vercel project

`withEve()` writes the agent into the build output, so the app and the agent
deploy together. From your fork, create a project in your own Vercel account:

```bash
npx vercel link
npx vercel integration add neon
npx vercel env add AI_GATEWAY_API_KEY
# Optional:
npx vercel env add GITHUB_TOKEN
npx vercel deploy --prod
```

The Neon integration supplies `DATABASE_URL`; you can instead add the connection
string from any Postgres database you own. `GITHUB_TOKEN` is optional and can be
omitted.

**Before making the deployment public, read `agent/channels/eve.ts`.** eve fails
closed: the current policy admits local development and Vercel OIDC callers, and
returns 401 to anonymous production traffic. Add an authenticator for your own
users, or append `none()` if you genuinely want the agent open to everyone —
each request spends model tokens and GitHub rate limit.

## Chat history

The sidebar lists past conversations, newest first, with rename and delete.

Only an *index* lives in Postgres — session id, title, repo, timestamps. eve
already persists every transcript durably and replays it through `resume`, so
storing messages here too would be a second source of truth free to drift from
the one the agent actually reads. `db/schema.sql` is the whole schema.

A conversation lives at `/s/[sessionId]`, where the id is eve's own durable
session id. Putting it in the URL rather than `localStorage` is what makes
resumption work on reload — and it keeps the server and the first client render
in agreement, which reading storage during render did not.

There is no per-user scoping: every chat in the database shows in the sidebar.
That is fine for a single-user or OIDC-gated deployment, and it is the thing to
change first if you open the app to more than one person — add a user column and
filter on it, alongside the route auth below.

## Layout

```
agent/
  agent.ts              model and reasoning effort
  instructions.md       how the agent researches and answers
  channels/eve.ts       route auth for the HTTP endpoints
  lib/
    github.ts           GitHub REST + raw CDN client, URL parsing, caching
    workspace.ts        sandbox clone and ripgrep, with graceful degradation
    paths.ts            which files are worth reading
    repo-context.ts     repo + ref resolution shared by the tools
  tools/                one file per tool; the filename is the tool name
app/
  layout.tsx            sidebar shell
  page.tsx              a new conversation
  s/[sessionId]/        an existing conversation, resumed from eve
  actions.ts            server actions for the chat index
db/schema.sql           the chats table
lib/
  db.ts                 lazy Neon client
  chats.ts              chat index queries
scripts/db-setup.mts    applies the schema (idempotent)
components/repo-chat/   chat UI: transcript, tool rendering, sidebar
components/ai-elements/ AI Elements
```

## Notes

Seven unused AI Elements components (`agent`, `attachments`, `context`,
`inline-citation`, `plan`, `schema-display`, `voice-selector`) were generated
against older `@base-ui/react` and `ai` APIs than the versions installed here
and no longer typecheck. They are listed in `tsconfig.json`'s `exclude` so the
build passes. If you start using one, fix it and drop it from that list —
`prompt-input.tsx` has the same drift already repaired, as a reference.

## Security

Never commit `.env.local`, Vercel metadata, tokens, database URLs, or private
keys. The included `.gitignore` excludes those files, and `.env.example`
contains variable names only. See [SECURITY.md](SECURITY.md) for reporting
security issues.

## License

Repo Reader is available under the [MIT License](LICENSE).
