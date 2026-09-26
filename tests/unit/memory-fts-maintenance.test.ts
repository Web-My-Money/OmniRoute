import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.ts";
import { maintainMemoryFts } from "../../src/lib/db/memoryFtsMaintenance.ts";
import type { LooseDeep } from "../helpers/looseTypes.ts";

function createDb(withFts = true) {
  const raw = new Database(":memory:");
  raw.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      memory_id INTEGER UNIQUE,
      content TEXT NOT NULL,
      key TEXT
    );
  `);
  if (withFts) {
    raw.exec(`
      CREATE VIRTUAL TABLE memory_fts USING fts5(content, key, content='memories');
      CREATE TRIGGER memory_fts_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memory_fts(rowid, content, key) VALUES (new.memory_id, new.content, new.key);
      END;
    `);
  }
  return { raw, db: createBetterSqliteAdapter(raw) };
}

test("returns missing when memory_fts does not exist", () => {
  const { raw, db } = createDb(false);
  assert.equal(maintainMemoryFts(db).action, "missing");
  raw.close();
});

test("skips a compact index", () => {
  const { raw, db } = createDb();
  raw.prepare("INSERT INTO memories VALUES (?, ?, ?, ?)").run("one", 1, "small memory", "k");
  assert.equal(maintainMemoryFts(db).action, "skipped");
  raw.close();
});

test("rebuilds an index above the configured threshold", () => {
  const { raw, db } = createDb();
  raw.prepare("INSERT INTO memories VALUES (?, ?, ?, ?)").run("one", 1, "small memory", "k");

  const result = maintainMemoryFts(db, { minFtsBytes: 1, rebuildRatio: 0 });

  assert.equal(result.action, "rebuilt");
  assert.equal(
    (raw.prepare("SELECT COUNT(*) AS count FROM memory_fts").get() as LooseDeep).count,
    1
  );
  raw.close();
});
