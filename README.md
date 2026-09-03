# Repo Reader

[![Release](https://img.shields.io/github/v/release/Eagardh/repo-reader)](https://github.com/Eagardh/repo-reader/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A chat app for asking questions about GitHub repositories, where the agent
actually opens the repo and reads the files.

Paste a repository link, ask a question, and the agent walks the real file tree,
reads the source that bears on your question, and answers with citations to
specific files and lines. It is not summarizing the README.

## How it works

| Piece | What it does |
| --- | --- |
| [eve](https://eve.dev) | Runs the agent. The agent is the `agent/` directory: instructions, tools, and route auth as files. |
| [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) | Routes the model call. Change the model by editing one string in `agent/agent.ts`. |
| [AI Elements](https://ai-sdk.dev/elements) | The chat UI components in `components/ai-elements/`. |
| Next.js 16 | Hosts both. `withEve()` mounts the agent at `/eve/v1/*` on this app's origin. |
| [Postgres](https://www.postgresql.org) | Stores the chat index behind the sidebar. Neon is one convenient option, but any compatible database you own works. |

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

## License

Repo Reader is available under the [MIT License](LICENSE).
