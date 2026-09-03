import { defineTool } from "eve/tools";
import {
  repositoryToolDescriptions,
  resolveRepoInputSchema,
  resolveRepository,
} from "../lib/repository-tools";

export default defineTool({
  description: repositoryToolDescriptions.resolve,
  inputSchema: resolveRepoInputSchema,
  execute: (input, ctx) => resolveRepository(input, ctx.abortSignal),
});
