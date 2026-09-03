import { defineTool } from "eve/tools";
import {
  listRepoFilesInputSchema,
  listRepositoryFiles,
  repositoryToolDescriptions,
} from "../lib/repository-tools";

export default defineTool({
  description: repositoryToolDescriptions.listFiles,
  inputSchema: listRepoFilesInputSchema,
  execute: (input, ctx) => listRepositoryFiles(input, ctx.abortSignal),
});
