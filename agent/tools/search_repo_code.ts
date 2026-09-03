import { defineTool } from "eve/tools";
import {
  repositoryToolDescriptions,
  searchRepoCodeInputSchema,
  searchRepositoryCode,
} from "../lib/repository-tools";

export default defineTool({
  description: repositoryToolDescriptions.search,
  inputSchema: searchRepoCodeInputSchema,
  execute: (input, ctx) =>
    searchRepositoryCode(input, {
      abortSignal: ctx.abortSignal,
      getSandbox: () => ctx.getSandbox(),
    }),
});
