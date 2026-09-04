import "server-only";
import { resolve } from "node:path";
import {
  createPostgresChatStore,
  createSqliteChatStore,
  type ChatStore,
} from "./chat-store";

/**
 * Lazily selects Postgres when DATABASE_URL is present, otherwise SQLite.
 * Delaying initialization keeps builds independent from runtime credentials.
 */
let storePromise: Promise<ChatStore> | null = null;

export function getChatStore(): Promise<ChatStore> {
  if (!storePromise) storePromise = createDefaultChatStore();
  return storePromise;
}

async function createDefaultChatStore(): Promise<ChatStore> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) return createPostgresChatStore(databaseUrl);

  const configuredPath = process.env.REPO_READER_DB_PATH?.trim();
  if (process.env.VERCEL) {
    throw new Error(
      "DATABASE_URL is required on Vercel because SQLite cannot persist on its ephemeral filesystem.",
    );
  }

  const databasePath = configuredPath
    ? configuredPath === ":memory:"
      ? configuredPath
      : resolve(configuredPath)
    : resolve(".data/repo-reader.db");

  return createSqliteChatStore(databasePath);
}
