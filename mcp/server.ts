import {
  assertPublicRepository,
  listRepoCommitsInputSchema,
  listRepoFilesInputSchema,
  listRepositoryCommits,
  listRepositoryFiles,
  readRepoFileInputSchema,
  readRepositoryFile,
  repositoryToolDescriptions,
  resolveRepoInputSchema,
  resolveRepository,
  searchRepoCodeInputSchema,
  searchRepositoryCode,
} from "@/agent/lib/repository-tools";
import { MCPServer, type CallToolResult } from "mcp-use";

const server = new MCPServer({
  name: "repo-reader",
  title: "Repository Reader",
  version: "1.0.0",
  description: "Read and inspect public GitHub repositories.",
  instructions:
    "This server only reads public GitHub repositories. Call resolve_repo first, then use list_repo_files, search_repo_code, read_repo_file, and list_repo_commits as needed. Base answers on source returned by the tools.",
  basePath: "/api/mcp",
  skills: false,
});

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const resolveRepo = server.tool(
  {
    name: "resolve_repo",
    title: "Resolve repository",
    description: `${repositoryToolDescriptions.resolve} Public repositories only.`,
    inputSchema: resolveRepoInputSchema,
    annotations: readOnlyAnnotations,
  },
  async (input, ctx) =>
    publicRepositoryResult(input.repo, ctx.signal, () =>
      resolveRepository(input, ctx.signal),
    ),
);

export const listRepoFiles = server.tool(
  {
    name: "list_repo_files",
    title: "List repository files",
    description: `${repositoryToolDescriptions.listFiles} Public repositories only.`,
    inputSchema: listRepoFilesInputSchema,
    annotations: readOnlyAnnotations,
  },
  async (input, ctx) =>
    publicRepositoryResult(input.repo, ctx.signal, () =>
      listRepositoryFiles(input, ctx.signal),
    ),
);

export const readRepoFile = server.tool(
  {
    name: "read_repo_file",
    title: "Read repository file",
    description: `${repositoryToolDescriptions.readFile} Public repositories only.`,
    inputSchema: readRepoFileInputSchema,
    annotations: readOnlyAnnotations,
  },
  async (input, ctx) =>
    publicRepositoryResult(input.repo, ctx.signal, () =>
      readRepositoryFile(input, ctx.signal),
    ),
);

export const searchRepoCode = server.tool(
  {
    name: "search_repo_code",
    title: "Search repository code",
    description:
      "Search an indexed term across a public GitHub repository. MCP requests use GitHub code search, which covers the default branch and requires the server's GITHUB_TOKEN.",
    inputSchema: searchRepoCodeInputSchema,
    annotations: readOnlyAnnotations,
  },
  async (input, ctx) =>
    publicRepositoryResult(input.repo, ctx.signal, () =>
      searchRepositoryCode(input, { abortSignal: ctx.signal }),
    ),
);

export const listRepoCommits = server.tool(
  {
    name: "list_repo_commits",
    title: "List repository commits",
    description: `${repositoryToolDescriptions.commits} Public repositories only.`,
    inputSchema: listRepoCommitsInputSchema,
    annotations: readOnlyAnnotations,
  },
  async (input, ctx) =>
    publicRepositoryResult(input.repo, ctx.signal, () =>
      listRepositoryCommits(input, ctx.signal),
    ),
);

async function publicRepositoryResult(
  repo: string,
  signal: AbortSignal,
  operation: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  try {
    await assertPublicRepository(repo, signal);
    const result = await operation();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Repository operation failed.";
    return {
      isError: true,
      content: [{ type: "text", text: message }],
    };
  }
}

export default server;
