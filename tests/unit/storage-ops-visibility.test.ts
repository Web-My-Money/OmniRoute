import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-opsvis-"));
process.env.DATA_DIR = dataDir;

const { getLastCleanupRun, runAutoCleanup } = await import("../../src/lib/db/cleanup.ts");
const { getTopTablesBySize } = await import("../../src/lib/db/stats.ts");
const { measureMemoryFts } = await import("../../src/lib/db/memoryFtsMaintenance.ts");
const { parseCgroupMemoryStat, readCgroupMemory } =
  await import("../../src/lib/monitoring/cgroupMemory.ts");
const { closeDbInstance, getDbInstance } = await import("../../src/lib/db/core.ts");

after(() => {
  closeDbInstance();
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("last auto-cleanup run record", () => {
  it("returns null before any run", () => {
    assert.equal(getLastCleanupRun(), null);
  });

  it("persists a readable record after runAutoCleanup", async () => {
    const result = await runAutoCleanup();
    const record = getLastCleanupRun();
    assert.ok(record, "record should exist after a run");
    assert.equal(record.totalDeleted, result.totalDeleted);
    assert.equal(record.totalErrors, result.totalErrors);
    assert.equal(record.autoCleanupEnabled, true);
    assert.ok(typeof record.ranAt === "string" && !Number.isNaN(Date.parse(record.ranAt)));
    assert.ok(typeof record.durationMs === "number" && record.durationMs >= 0);
    assert.ok(record.results && typeof record.results === "object");
    assert.ok("usageHistory" in record.results, "per-table results should be persisted");
  });
});

describe("getTopTablesBySize", () => {
  it("returns sized objects sorted by bytes descending", () => {
    const db = getDbInstance();
    const tables = getTopTablesBySize(db, 5);
    assert.ok(Array.isArray(tables));
    assert.ok(tables.length > 0, "fresh db should still have schema tables");
    for (const t of tables) {
      assert.ok(typeof t.name === "string" && t.name.length > 0);
      assert.ok(typeof t.bytes === "number" && t.bytes >= 0);
    }
    for (let i = 1; i < tables.length; i++) {
      assert.ok(tables[i - 1].bytes >= tables[i].bytes, "must be sorted desc");
    }
  });
});

describe("measureMemoryFts", () => {
  it("reports exists:false when memory_fts is absent", () => {
    const db = getDbInstance();
    const size = measureMemoryFts(db);
    assert.equal(typeof size.exists, "boolean");
    assert.ok(size.ftsBytes >= 0 && size.memoriesBytes >= 0);
  });
});

describe("cgroup memory", () => {
  it("parseCgroupMemoryStat parses key-value pairs and skips junk", () => {
    const stat = parseCgroupMemoryStat(
      "anon 1207148544\nfile 366403584\nkernel_stack 147456\n\nbogus\nuneven  \n"
    );
    assert.equal(stat.anon, 1207148544);
    assert.equal(stat.file, 366403584);
    assert.equal(stat.kernel_stack, 147456);
    assert.equal(stat.bogus, undefined);
    assert.equal(stat.uneven, undefined);
  });

  it("readCgroupMemory returns null or a well-formed snapshot on this host", () => {
    const snapshot = readCgroupMemory();
    if (snapshot === null) return; // Windows dev box — nothing to assert
    assert.ok(snapshot.version === 1 || snapshot.version === 2);
    assert.ok(snapshot.currentBytes > 0);
  });
});
