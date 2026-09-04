import "server-only";
import type { ChatRow } from "./chat-store";
import { getChatStore } from "./db";

export type Chat = {
  sessionId: string;
  title: string;
  repo: string | null;
  createdAt: string;
  updatedAt: string;
};

const toChat = (row: ChatRow): Chat => ({
  sessionId: row.session_id,
  title: row.title,
  repo: row.repo,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export async function listChats(limit = 100): Promise<Chat[]> {
  const store = await getChatStore();
  const rows = await store.list(Math.max(1, Math.min(limit, 500)));
  return rows.map(toChat);
}

export async function getChat(sessionId: string): Promise<Chat | null> {
  const store = await getChatStore();
  const row = await store.get(sessionId);
  return row ? toChat(row) : null;
}

/**
 * Records a chat the first time it is seen and refreshes it afterwards.
 *
 * The client calls this as soon as eve mints a session id, then again when the
 * repo becomes known. `coalesce` keeps an existing title and repo rather than
 * letting a later call with fewer details erase them.
 */
export async function upsertChat(input: {
  sessionId: string;
  title?: string;
  repo?: string | null;
}): Promise<void> {
  const store = await getChatStore();
  await store.upsert(input);
}

export async function renameChat(sessionId: string, title: string): Promise<void> {
  const store = await getChatStore();
  await store.rename(sessionId, title);
}

export async function deleteChat(sessionId: string): Promise<void> {
  const store = await getChatStore();
  // Removes the sidebar entry only. eve owns the durable session itself.
  await store.delete(sessionId);
}
