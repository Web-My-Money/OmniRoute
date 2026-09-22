---
title: Wave 1 Reliability and Cost Correctness Implementation Plan
description: Task-by-task plan for retention cleanup, FTS maintenance, and Verify Runner diagnostics.
---

# Wave 1 Reliability and Cost Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the remaining retention cleanup errors, prevent memory FTS bloat from recurring, remove duplicate cleanup work, and ensure Verify Runner comments retain the actionable final failure.

**Architecture:** OmniRoute cleanup remains owned by `src/lib/db/cleanup.ts`, with FTS maintenance isolated in a focused database module and covered by real in-memory SQLite tests. Verify Runner comment formatting remains in `wmm-agents`, but the log-tail selection becomes a separately testable helper so the user's current fix is preserved and regression-protected. Each repository ships through its own focused PR and deployment path.

**Tech Stack:** Node.js, TypeScript, better-sqlite3, FTS5, Node test runner, Next.js instrumentation startup, Railway, GitHub CLI.

---

## File Map

### OmniRoute

- Modify `src/lib/db/cleanup.ts`: correct live timestamp columns, remove duplicate proxy cleanup, call bounded FTS maintenance after cleanup.
- Create `OmniRoute/src/lib/db/memoryFtsMaintenance.ts`: inspect FTS size, decide whether maintenance is needed, run FTS5 optimize/rebuild safely, and return bounded metadata.
- Modify `tests/unit/db-cleanup.test.ts`: add real SQLite expiry tests for MCP audit and A2A events.
- Create `OmniRoute/tests/unit/memory-fts-maintenance.test.ts`: exercise skip, optimize, and rebuild decisions against an in-memory FTS5 database.
- Modify `tests/unit/cleanup-column-fix.test.mjs`: update startup-path and column invariants so they match production reality.

### wmm-agents

- Create `wmm-agents/scripts/lib/verify-comment-log-tail.mjs`: bounded selection of the newest verification output.
- Create `wmm-agents/scripts/lib/verify-comment-log-tail.test.mjs`: prove short logs remain intact and oversized logs retain the final failure.
- Modify `wmm-agents/scripts/wmm_verify_worker.mjs`: use the helper while preserving the user's current `slice(-MAX_COMMENT_CHARS)` behavior.

## Task 1: Reproduce Cleanup Column Failures with Real SQLite Tests

**Files:**

- Modify: `tests/unit/db-cleanup.test.ts`
- Reference: `src/lib/db/migrations/002_mcp_a2a_tables.sql`

- [ ] **Step 1: Add representative tables and records**

Extend the existing cleanup test setup with the production column names:

```ts
db.exec(`
  CREATE TABLE mcp_tool_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE a2a_task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

db.prepare("INSERT INTO mcp_tool_audit (tool_name, created_at) VALUES (?, ?)").run(
  "old-tool",
  "2026-01-01T00:00:00.000Z"
);
db.prepare("INSERT INTO mcp_tool_audit (tool_name, created_at) VALUES (?, ?)").run(
  "recent-tool",
  new Date().toISOString()
);
```

Add equivalent old and recent rows for `a2a_task_events`.

- [ ] **Step 2: Add failing behavior tests**

```ts
test("cleanupMcpAudit deletes only expired mcp_tool_audit rows", async () => {
  const result = await cleanupMcpAudit();
  assert.equal(result.errors, 0);
  assert.equal(result.deleted, 1);
  assert.deepEqual(db.prepare("SELECT tool_name FROM mcp_tool_audit ORDER BY id").all(), [
    { tool_name: "recent-tool" },
  ]);
});

test("cleanupA2aEvents deletes only expired a2a_task_events rows", async () => {
  const result = await cleanupA2aEvents();
  assert.equal(result.errors, 0);
  assert.equal(result.deleted, 1);
  assert.deepEqual(db.prepare("SELECT event_type FROM a2a_task_events ORDER BY id").all(), [
    { event_type: "recent-event" },
  ]);
});
```

- [ ] **Step 3: Run the focused test and confirm failure**

Run:

```bash
node --import tsx/esm --test tests/unit/db-cleanup.test.ts
```

Expected: the two new tests fail with `no such column: timestamp`.

- [ ] **Step 4: Commit the failing tests**

```bash
git add tests/unit/db-cleanup.test.ts
git commit -m "test(db): reproduce cleanup timestamp mismatches"
```

## Task 2: Correct Cleanup Queries and Remove Duplicate Work

**Files:**

- Modify: `src/lib/db/cleanup.ts:169-219`
- Modify: `src/lib/db/cleanup.ts:677-717`
- Modify: `tests/unit/cleanup-column-fix.test.mjs`

- [ ] **Step 1: Use the production `created_at` columns**

Change the two statements to:

```ts
const stmt = db.prepare("DELETE FROM mcp_tool_audit WHERE created_at < ?");
```

```ts
const stmt = db.prepare("DELETE FROM a2a_task_events WHERE created_at < ?");
```

Update log labels to the actual table names:

```ts
console.log(
  `[Cleanup] Deleted ${result.deleted} mcp_tool_audit rows older than ${retentionDays} days`
);
```

```ts
console.log(
  `[Cleanup] Deleted ${result.deleted} a2a_task_events rows older than ${retentionDays} days`
);
```

- [ ] **Step 2: Remove the duplicate proxy cleanup call**

`runAutoCleanup()` already includes `proxyLogs`. In both scheduler callbacks, replace:

```ts
const result = await runAutoCleanup();
const proxyResult = await cleanupProxyLogs();
const totalDeleted = result.totalDeleted + proxyResult.deleted;
```

with:

```ts
const result = await runAutoCleanup();
const totalDeleted = result.totalDeleted;
```

- [ ] **Step 3: Update source invariants**

In `tests/unit/cleanup-column-fix.test.mjs`, assert:

```js
assert.ok(source.includes("DELETE FROM mcp_tool_audit WHERE created_at < ?"));
assert.ok(source.includes("DELETE FROM a2a_task_events WHERE created_at < ?"));
```

Replace the obsolete `server-init.ts` scheduler test with a check of `src/instrumentation-node.ts`:

```js
const instrumentationPath = path.resolve(import.meta.dirname, "../../src/instrumentation-node.ts");
const instrumentation = fs.readFileSync(instrumentationPath, "utf-8");
assert.ok(instrumentation.includes('import("@/lib/db/cleanup")'));
assert.ok(instrumentation.includes("startCleanupScheduler()"));
```

Add an invariant that the scheduler callback does not call `cleanupProxyLogs()` separately from `runAutoCleanup()`.

- [ ] **Step 4: Run focused tests**

```bash
node --import tsx/esm --test tests/unit/db-cleanup.test.ts
node --test tests/unit/cleanup-column-fix.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit the implementation**

```bash
git add src/lib/db/cleanup.ts tests/unit/cleanup-column-fix.test.mjs
git commit -m "fix(db): clean MCP and A2A retention rows correctly"
```

## Task 3: Add Bounded Memory FTS Maintenance

**Files:**

- Create: `OmniRoute/src/lib/db/memoryFtsMaintenance.ts`
- Create: `OmniRoute/tests/unit/memory-fts-maintenance.test.ts`

- [ ] **Step 1: Write failing decision tests**

Define the public result type and expected behavior in the test:

```ts
export interface MemoryFtsMaintenanceResult {
  action: "missing" | "skipped" | "optimized" | "rebuilt";
  ftsBytes: number;
  memoriesBytes: number;
  durationMs: number;
  error?: string;
}
```

Add tests for:

```ts
test("returns missing when memory_fts does not exist", () => {
  assert.equal(maintainMemoryFts(db).action, "missing");
});

test("skips a compact index", () => {
  seedMemoriesAndFts(db, 10);
  assert.equal(maintainMemoryFts(db).action, "skipped");
});

test("rebuilds when FTS bytes greatly exceed source bytes", () => {
  seedMemoriesAndFts(db, 10);
  createFtsBloat(db);
  const result = maintainMemoryFts(db, { minFtsBytes: 1, rebuildRatio: 4 });
  assert.equal(result.action, "rebuilt");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM memory_fts").get().count, 10);
});
```

- [ ] **Step 2: Run the test and confirm failure**

```bash
node --import tsx/esm --test tests/unit/memory-fts-maintenance.test.ts
```

Expected: failure because `memoryFtsMaintenance.ts` does not exist.

- [ ] **Step 3: Implement size inspection and bounded decisions**

Create `OmniRoute/src/lib/db/memoryFtsMaintenance.ts` with:

```ts
import type Database from "better-sqlite3";

export interface MemoryFtsMaintenanceOptions {
  minFtsBytes?: number;
  rebuildRatio?: number;
}

export interface MemoryFtsMaintenanceResult {
  action: "missing" | "skipped" | "optimized" | "rebuilt";
  ftsBytes: number;
  memoriesBytes: number;
  durationMs: number;
  error?: string;
}

const DEFAULT_MIN_FTS_BYTES = 64 * 1024 * 1024;
const DEFAULT_REBUILD_RATIO = 8;

function objectBytes(db: Database.Database, name: string): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(pgsize), 0) AS bytes FROM dbstat WHERE name = ?")
    .get(name) as { bytes: number };
  return Number(row.bytes) || 0;
}

export function maintainMemoryFts(
  db: Database.Database,
  options: MemoryFtsMaintenanceOptions = {}
): MemoryFtsMaintenanceResult {
  const startedAt = Date.now();
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'memory_fts'").get();
  if (!exists) {
    return { action: "missing", ftsBytes: 0, memoriesBytes: 0, durationMs: Date.now() - startedAt };
  }

  const ftsBytes = objectBytes(db, "memory_fts_data") + objectBytes(db, "memory_fts_docsize");
  const memoriesBytes = Math.max(1, objectBytes(db, "memories"));
  const minFtsBytes = options.minFtsBytes ?? DEFAULT_MIN_FTS_BYTES;
  const rebuildRatio = options.rebuildRatio ?? DEFAULT_REBUILD_RATIO;
  if (ftsBytes < minFtsBytes || ftsBytes / memoriesBytes < rebuildRatio) {
    return { action: "skipped", ftsBytes, memoriesBytes, durationMs: Date.now() - startedAt };
  }

  db.prepare("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')").run();
  return { action: "rebuilt", ftsBytes, memoriesBytes, durationMs: Date.now() - startedAt };
}
```

If `dbstat` is unavailable, catch that specific inspection failure and return `skipped` with a bounded error string instead of failing cleanup.

- [ ] **Step 4: Run the focused tests**

```bash
node --import tsx/esm --test tests/unit/memory-fts-maintenance.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit the isolated module**

```bash
git add src/lib/db/memoryFtsMaintenance.ts tests/unit/memory-fts-maintenance.test.ts
git commit -m "feat(db): maintain bloated memory FTS indexes"
```

## Task 4: Integrate FTS Maintenance with Cleanup

**Files:**

- Modify: `src/lib/db/cleanup.ts`
- Modify: `tests/unit/db-cleanup.test.ts`

- [ ] **Step 1: Add a failing integration assertion**

Mock or inject the FTS maintenance function and assert it runs once after a cleanup cycle that deletes rows, but not after a zero-delete cycle.

Expected calls:

```ts
assert.equal(maintainCalls, 1);
```

- [ ] **Step 2: Run the focused test and confirm failure**

```bash
node --import tsx/esm --test tests/unit/db-cleanup.test.ts
```

Expected: failure because cleanup does not invoke FTS maintenance.

- [ ] **Step 3: Integrate non-fatally**

Import the module directly:

```ts
import { maintainMemoryFts } from "./memoryFtsMaintenance";
```

After a cycle with deletions and before `VACUUM`, run:

```ts
const ftsResult = maintainMemoryFts(getDbInstance());
console.log(
  `[Cleanup] Memory FTS maintenance action=${ftsResult.action} ` +
    `ftsBytes=${ftsResult.ftsBytes} memoriesBytes=${ftsResult.memoriesBytes} ` +
    `durationMs=${ftsResult.durationMs}`
);
```

Catch failures locally so FTS maintenance cannot stop retention cleanup or vacuum.

- [ ] **Step 4: Run cleanup and FTS tests**

```bash
node --import tsx/esm --test tests/unit/db-cleanup.test.ts
node --import tsx/esm --test tests/unit/memory-fts-maintenance.test.ts
node --test tests/unit/cleanup-column-fix.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit integration**

```bash
git add src/lib/db/cleanup.ts tests/unit/db-cleanup.test.ts
git commit -m "fix(db): bound FTS growth during retention cleanup"
```

## Task 5: Protect Verify Runner's Final Failure Output

**Files:**

- Create: `wmm-agents/scripts/lib/verify-comment-log-tail.mjs`
- Create: `wmm-agents/scripts/lib/verify-comment-log-tail.test.mjs`
- Modify: `wmm-agents/scripts/wmm_verify_worker.mjs:896-904`

- [ ] **Step 1: Write failing helper tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { selectVerifyCommentLogTail } from "./verify-comment-log-tail.mjs";

test("keeps short logs intact", () => {
  assert.equal(selectVerifyCommentLogTail(["one", "two"], 200, 10), "one\ntwo");
});

test("keeps the final failure from oversized logs", () => {
  const lines = ["old context", "x".repeat(100), "FINAL FAILURE: build exited 1"];
  const tail = selectVerifyCommentLogTail(lines, 40, 10);
  assert.match(tail, /FINAL FAILURE: build exited 1$/);
  assert.doesNotMatch(tail, /old context/);
});
```

- [ ] **Step 2: Run the test and confirm failure**

```bash
node --test scripts/lib/verify-comment-log-tail.test.mjs
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the helper**

```js
export function selectVerifyCommentLogTail(logBuffer, maxChars, maxLines) {
  return logBuffer.slice(-maxLines).join("\n").slice(-maxChars);
}
```

- [ ] **Step 4: Use the helper without overwriting user work**

Import:

```js
import { selectVerifyCommentLogTail } from "./lib/verify-comment-log-tail.mjs";
```

Replace only the expression with:

```js
const logTail = selectVerifyCommentLogTail(logBuffer, MAX_COMMENT_CHARS, MAX_LOG_LINES);
```

Preserve the user's explanatory comment or move its substance to the helper test.

- [ ] **Step 5: Run focused and repository verification**

```bash
node --test scripts/lib/verify-comment-log-tail.test.mjs
npm run validate
```

Expected: focused test and governance validation pass.

- [ ] **Step 6: Commit only the intended files**

```bash
git add scripts/lib/verify-comment-log-tail.mjs \
  scripts/lib/verify-comment-log-tail.test.mjs \
  scripts/wmm_verify_worker.mjs
git commit -m "fix(verify): retain actionable final failure output"
```

## Task 6: Verify, Ship, and Observe OmniRoute

**Files:**

- Verify all OmniRoute files changed in Tasks 1-4.

- [ ] **Step 1: Format changed files**

```bash
npx prettier --write \
  src/lib/db/cleanup.ts \
  src/lib/db/memoryFtsMaintenance.ts \
  tests/unit/db-cleanup.test.ts \
  tests/unit/memory-fts-maintenance.test.ts \
  tests/unit/cleanup-column-fix.test.mjs
```

- [ ] **Step 2: Run focused tests**

```bash
node --import tsx/esm --test tests/unit/db-cleanup.test.ts
node --import tsx/esm --test tests/unit/memory-fts-maintenance.test.ts
node --test tests/unit/cleanup-column-fix.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 3: Run the repository verification floor**

```bash
npm run typecheck:core
npm run lint
npm run test:all
npm run build
```

Expected: zero new failures. Any pre-existing failure must be reproduced unchanged against `origin/wmm-production` and documented.

- [ ] **Step 4: Review and ship the focused OmniRoute PR**

```bash
git status --short
git diff origin/wmm-production...HEAD --check
git diff origin/wmm-production...HEAD --stat
git push origin HEAD
gh pr create --base wmm-production
```

Do not include the design-only commit in the code PR if repository convention requires a separate documentation PR; otherwise explain both commits in the PR summary.

- [ ] **Step 5: Verify deployment and cleanup**

After merge and Railway deployment:

```bash
env -u RAILWAY_TOKEN railway status
curl -fsS https://omniroute-production-aac7.up.railway.app/api/monitoring/health
```

Confirm logs show:

```text
[Cleanup] Deleted ... mcp_tool_audit rows ...
[Cleanup] Deleted ... a2a_task_events rows ...
[Cleanup] Memory FTS maintenance action=...
[Cleanup] Auto-cleanup complete: ... errors=0
```

- [ ] **Step 6: Verify production data safety and resource behavior**

Run SQLite `quick_check`, verify recent MCP/A2A rows remain, confirm database size, and compare cgroup anonymous memory versus file cache. Recheck 24-hour Railway memory and egress after sufficient traffic.

## Task 7: Ship and Observe Verify Runner

**Files:**

- Verify all `wmm-agents` files changed in Task 5.

- [ ] **Step 1: Review unrelated local work**

```bash
git status --short
git diff -- scripts/wmm_verify_worker.mjs
git diff -- dist/multica-skills-manifest.json
```

Exclude generated timestamp-only changes and all unrelated edits.

- [ ] **Step 2: Push a focused branch and create one PR**

```bash
git push origin HEAD
gh pr create --base main
```

- [ ] **Step 3: Merge only after validation passes**

Confirm `npm run validate` and focused tests pass, then merge through the normal protected-branch flow.

- [ ] **Step 4: Verify Railway deployment**

Confirm `wmm-verify-runner` deployment is online and a real failed verification comment contains the final failure line while remaining under the comment-size limit.

- [ ] **Step 5: Measure egress**

Compare Verify Runner's 24-hour Railway transmit-volume metric with the prior 2.3 GB/day baseline. Record whether the change affects only diagnosis quality or also transfer volume; do not claim egress savings without measured evidence.
