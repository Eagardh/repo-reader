import { defineAgent } from "eve";

export default defineAgent({
  // Routed through the Vercel AI Gateway. Swap the id to change models;
  // AI_GATEWAY_API_KEY (or a linked Vercel project's OIDC token) authenticates it.
  model: "anthropic/claude-sonnet-5",
  reasoning: "medium",
});
