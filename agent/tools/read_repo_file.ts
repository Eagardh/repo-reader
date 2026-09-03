import { defineTool } from "eve/tools";
import {
  readRepoFileInputSchema,
  readRepositoryFile,
  repositoryToolDescriptions,
} from "../lib/repository-tools";

export default defineTool({
  description: repositoryToolDescriptions.readFile,
  inputSchema: readRepoFileInputSchema,
  execute: (input, ctx) => readRepositoryFile(input, ctx.abortSignal),
});
