"use server";

import { revalidatePath } from "next/cache";
import { deleteChat, renameChat, upsertChat } from "@/lib/chats";

/**
 * Records or refreshes a chat in the sidebar index.
 *
 * Called from the client the moment eve mints a session id, so a chat appears
 * in the sidebar before its first response finishes streaming — and survives a
 * reload mid-answer.
 */
export async function saveChat(input: {
  sessionId: string;
  title?: string;
  repo?: string | null;
}) {
  if (!input.sessionId) return;
  await upsertChat(input);
  revalidatePath("/", "layout");
}

export async function renameChatAction(sessionId: string, title: string) {
  const trimmed = title.trim();
  if (!sessionId || !trimmed) return;
  await renameChat(sessionId, trimmed.slice(0, 200));
  revalidatePath("/", "layout");
}

export async function deleteChatAction(sessionId: string) {
  if (!sessionId) return;
  await deleteChat(sessionId);
  revalidatePath("/", "layout");
}
