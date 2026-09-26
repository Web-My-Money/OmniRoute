/**
 * syncToCloud machineId guard — regression: a caller once invoked syncToCloud()
 * with no argument and the route pushed to `${CLOUD_URL}/sync/undefined`.
 * The guard must reject missing/empty machineId before any network call.
 * Run: node --import tsx/esm --test tests/unit/lib/cloud-sync-machineid.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-cloudsync-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const { syncToCloud } = await import("../../../src/lib/cloudSync.ts");

test.after(() => {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("syncToCloud rejects a missing machineId instead of fetching /sync/undefined", async () => {
  // reason: deliberate runtime-JS-shape call to verify the runtime guard
  const result = await syncToCloud(undefined as unknown as string);
  assert.equal(result?.error, "machineId is required for cloud sync");
});

test("syncToCloud rejects an empty-string machineId", async () => {
  const result = await syncToCloud("");
  assert.equal(result?.error, "machineId is required for cloud sync");
});
