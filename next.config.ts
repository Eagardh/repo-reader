import { withEve } from "eve/next";
import { withMcpUse } from "mcp-use/next";
import type { NextConfig } from "next";

const nextConfig = {
  serverExternalPackages: ["mcp-use"],
} satisfies NextConfig;

// Mounts the eve agent in `agent/` at /eve/v1/* on this app's own origin, so the
// browser talks to one server in dev and the two ship as one Vercel deployment.
export default withEve(() =>
  withMcpUse(nextConfig, {
    mcpDir: "mcp",
    basePath: "/api/mcp",
  }),
);
