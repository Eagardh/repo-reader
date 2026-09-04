-- Postgres index of chat sessions shown in the sidebar.
-- Local SQLite installs create the equivalent schema automatically.
--
-- Deliberately does NOT store the transcript. eve already persists every
-- session durably and replays it through `resume`, so a messages table here
-- would be a second source of truth that can drift out of sync with the one
-- the agent actually reads from. This table holds only what the sidebar needs
-- and eve does not expose: a human title, and recency for ordering.
create table if not exists chats (
  -- eve's durable session id. Also the URL segment at /s/[sessionId].
  session_id  text primary key,
  title       text        not null default 'New chat',
  -- Last repository the agent opened in this chat, for the sidebar subtitle.
  repo        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists chats_updated_at_idx on chats (updated_at desc);
