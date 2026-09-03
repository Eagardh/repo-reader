import { defineTool } from "eve/tools";
import {
  listRepoCommitsInputSchema,
  listRepositoryCommits,
  repositoryToolDescriptions,
} from "../lib/repository-tools";

export default defineTool({
  description: repositoryToolDescriptions.commits,
  inputSchema: listRepoCommitsInputSchema,
  execute: (input, ctx) => listRepositoryCommits(input, ctx.abortSignal),
});
