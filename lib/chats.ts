import "server-only";
import { getSql } from "./db";

export type Chat = {
  sessionId: string;
  title: string;
  repo: string | null;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  session_id: string;
  title: string;
  repo: string | null;
  created_at: string;
  updated_at: string;
};

const toChat = (row: Row): Chat => ({
  sessionId: row.session_id,
  title: row.title,
  repo: row.repo,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export async function listChats(limit = 100): Promise<Chat[]> {
  const sql = getSql();
  const rows = (await sql`
    select session_id, title, repo, created_at, updated_at
    from chats
    order by updated_at desc
    limit ${limit}
  `) as Row[];
  return rows.map(toChat);
}

export async function getChat(sessionId: string): Promise<Chat | null> {
  const sql = getSql();
  const rows = (await sql`
    select session_id, title, repo, created_at, updated_at
    from chats
    where session_id = ${sessionId}
  `) as Row[];
  return rows[0] ? toChat(rows[0]) : null;
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
  const sql = getSql();
  await sql`
    insert into chats (session_id, title, repo)
    values (
      ${input.sessionId},
      ${input.title ?? "New chat"},
      ${input.repo ?? null}
    )
    on conflict (session_id) do update set
      title      = coalesce(nullif(excluded.title, 'New chat'), chats.title),
      repo       = coalesce(excluded.repo, chats.repo),
      updated_at = now()
  `;
}

export async function renameChat(sessionId: string, title: string): Promise<void> {
  const sql = getSql();
  await sql`
    update chats set title = ${title}, updated_at = now()
    where session_id = ${sessionId}
  `;
}

export async function deleteChat(sessionId: string): Promise<void> {
  const sql = getSql();
  // Removes the sidebar entry only. eve owns the durable session itself.
  await sql`delete from chats where session_id = ${sessionId}`;
}
