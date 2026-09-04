import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSqliteChatStore } from "../lib/chat-store";

test("SQLite chat store supports the complete chat lifecycle", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "repo-reader-sqlite-"));
  const store = await createSqliteChatStore(join(directory, "chats.db"));

  t.after(async () => {
    await store.close?.();
    await rm(directory, { recursive: true, force: true });
  });

  await store.upsert({ sessionId: "session-1" });
  await store.upsert({ sessionId: "session-1", repo: "owner/repository" });

  const created = await store.get("session-1");
  assert.equal(created?.title, "New chat");
  assert.equal(created?.repo, "owner/repository");
  assert.match(created?.created_at ?? "", /^\d{4}-\d{2}-\d{2}T/);

  await store.rename("session-1", "Architecture notes");
  assert.equal((await store.get("session-1"))?.title, "Architecture notes");

  await store.upsert({ sessionId: "session-2", title: "Second chat" });
  assert.equal((await store.list(1)).length, 1);
  assert.equal((await store.list(10)).length, 2);

  await store.delete("session-1");
  assert.equal(await store.get("session-1"), null);
});
