import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-cleanup-"));
process.env.DATA_DIR = dataDir;

const mod = await import("../../src/lib/db/cleanup.ts");
const { closeDbInstance, getDbInstance } = await import("../../src/lib/db/core.ts");
const db = getDbInstance();

after(() => {
  closeDbInstance();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("cleanup DB module", () => {
  it("cleanupQuotaSnapshots returns result with deleted count", async () => {
    const result = await mod.cleanupQuotaSnapshots();
    assert.ok(typeof result.deleted === "number", "should have deleted count");
    assert.ok(typeof result.errors === "number", "should have errors count");
  });

  it("cleanupUsageHistory returns result", async () => {
    const result = await mod.cleanupUsageHistory();
    assert.ok(typeof result.deleted === "number");
    assert.ok(typeof result.errors === "number");
  });

  it("purgeDetailedLogs returns result", async () => {
    const result = await mod.purgeDetailedLogs();
    assert.ok(typeof result.deleted === "number");
    assert.ok(typeof result.errors === "number");
  });

  it("runAutoCleanup returns summary with totalDeleted and totalErrors", async () => {
    const result = await mod.runAutoCleanup();
    assert.ok(typeof result.totalDeleted === "number", "should have totalDeleted");
    assert.ok(typeof result.totalErrors === "number", "should have totalErrors");
    assert.ok(typeof result.results === "object", "should have results");
  });

  it("cleanupCallLogs returns result (may error if table missing)", async () => {
    const result = await mod.cleanupCallLogs();
    assert.ok(typeof result.deleted === "number");
    assert.ok(typeof result.errors === "number");
  });

  it("cleanupMcpAudit deletes only expired rows", async () => {
    db.prepare("INSERT INTO mcp_tool_audit (tool_name, created_at) VALUES (?, ?)").run(
      "old-tool",
      "2020-01-01T00:00:00.000Z"
    );
    db.prepare("INSERT INTO mcp_tool_audit (tool_name, created_at) VALUES (?, ?)").run(
      "recent-tool",
      new Date().toISOString()
    );

    const result = await mod.cleanupMcpAudit();

    assert.equal(result.errors, 0);
    assert.equal(result.deleted, 1);
    assert.deepEqual(db.prepare("SELECT tool_name FROM mcp_tool_audit ORDER BY id").all(), [
      { tool_name: "recent-tool" },
    ]);
  });

  it("cleanupA2aEvents deletes only expired rows", async () => {
    db.prepare("INSERT INTO a2a_tasks (id, skill_id, state, input_json) VALUES (?, ?, ?, ?)").run(
      "task-1",
      "health-report",
      "submitted",
      "{}"
    );
    db.prepare(
      "INSERT INTO a2a_task_events (task_id, event_type, created_at) VALUES (?, ?, ?)"
    ).run("task-1", "old-event", "2020-01-01T00:00:00.000Z");
    db.prepare(
      "INSERT INTO a2a_task_events (task_id, event_type, created_at) VALUES (?, ?, ?)"
    ).run("task-1", "recent-event", new Date().toISOString());

    const result = await mod.cleanupA2aEvents();

    assert.equal(result.errors, 0);
    assert.equal(result.deleted, 1);
    assert.deepEqual(db.prepare("SELECT event_type FROM a2a_task_events ORDER BY id").all(), [
      { event_type: "recent-event" },
    ]);
  });
});
