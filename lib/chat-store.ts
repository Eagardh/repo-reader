import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type ChatRow = {
  session_id: string;
  title: string;
  repo: string | null;
  created_at: string;
  updated_at: string;
};

export type UpsertChatInput = {
  sessionId: string;
  title?: string;
  repo?: string | null;
};

export type ChatStore = {
  list(limit: number): Promise<ChatRow[]>;
  get(sessionId: string): Promise<ChatRow | null>;
  upsert(input: UpsertChatInput): Promise<void>;
  rename(sessionId: string, title: string): Promise<void>;
  delete(sessionId: string): Promise<void>;
  close?(): void | Promise<void>;
};

export async function createPostgresChatStore(
  databaseUrl: string,
): Promise<ChatStore> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(databaseUrl);

  return {
    async list(limit) {
      return (await sql`
        select session_id, title, repo, created_at, updated_at
        from chats
        order by updated_at desc
        limit ${limit}
      `) as ChatRow[];
    },
    async get(sessionId) {
      const rows = (await sql`
        select session_id, title, repo, created_at, updated_at
        from chats
        where session_id = ${sessionId}
      `) as ChatRow[];
      return rows[0] ?? null;
    },
    async upsert(input) {
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
    },
    async rename(sessionId, title) {
      await sql`
        update chats set title = ${title}, updated_at = now()
        where session_id = ${sessionId}
      `;
    },
    async delete(sessionId) {
      await sql`delete from chats where session_id = ${sessionId}`;
    },
  };
}

export async function createSqliteChatStore(
  databasePath: string,
): Promise<ChatStore> {
  const { DatabaseSync } = await import("node:sqlite");

  if (databasePath !== ":memory:") {
    await mkdir(dirname(databasePath), { recursive: true, mode: 0o700 });
  }

  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  database.exec("pragma foreign_keys = on; pragma busy_timeout = 5000;");
  if (databasePath !== ":memory:") {
    database.exec("pragma journal_mode = wal; pragma synchronous = normal;");
  }
  database.exec(`
    create table if not exists chats (
      session_id text primary key,
      title text not null default 'New chat',
      repo text,
      created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) strict;

    create index if not exists chats_updated_at_idx
      on chats (updated_at desc);
  `);

  const list = database.prepare(`
    select session_id, title, repo, created_at, updated_at
    from chats
    order by updated_at desc
    limit ?
  `);
  const get = database.prepare(`
    select session_id, title, repo, created_at, updated_at
    from chats
    where session_id = ?
  `);
  const upsert = database.prepare(`
    insert into chats (session_id, title, repo)
    values (?, ?, ?)
    on conflict (session_id) do update set
      title = coalesce(nullif(excluded.title, 'New chat'), chats.title),
      repo = coalesce(excluded.repo, chats.repo),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `);
  const rename = database.prepare(`
    update chats
    set title = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    where session_id = ?
  `);
  const remove = database.prepare("delete from chats where session_id = ?");

  return {
    async list(limit) {
      return list.all(limit) as ChatRow[];
    },
    async get(sessionId) {
      return (get.get(sessionId) as ChatRow | undefined) ?? null;
    },
    async upsert(input) {
      upsert.run(input.sessionId, input.title ?? "New chat", input.repo ?? null);
    },
    async rename(sessionId, title) {
      rename.run(title, sessionId);
    },
    async delete(sessionId) {
      remove.run(sessionId);
    },
    close() {
      database.close();
    },
  };
}
