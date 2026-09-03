import server from "@/mcp/server";
import { createNextHandler } from "mcp-use/next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const { GET, POST, DELETE, OPTIONS } = createNextHandler(server);
