---
title: Wave 2 Operator Visibility Implementation Plan
description: Surface cleanup status, DB growth, memory split, and FTS health on one operator surface.
---

# Wave 2 Operator Visibility Implementation Plan

> Parent design: `docs/ops/BALANCED_OPERATIONS_IMPROVEMENT_DESIGN.md`
> Goal: make the invisible operational state visible — last cleanup result,
> DB/table growth, billed-vs-process memory, FTS index health — without a new
> dashboard page. Extend `/api/storage/health` + the existing SystemStorageTab.

## Scope

- [x] Task 1 — `src/lib/db/cleanup.ts`: persist last auto-cleanup run
      (`key_value` namespace `opsState`, key `lastAutoCleanupRun`) with
      `ranAt`, `durationMs`, `totalDeleted`, `totalErrors`, per-table results.
      Export `getLastCleanupRun()`.
- [x] Task 2 — `src/lib/db/stats.ts`: `getTopTablesBySize(db, limit)` —
      lightweight `dbstat` GROUP BY (no per-table COUNT(*)).
- [x] Task 3 — `src/lib/monitoring/cgroupMemory.ts`: `readCgroupMemory()`
      reads `/sys/fs/cgroup/memory.current` + `memory.stat` (v2), v1 fallbacks.
      Returns `null` off-Linux.
- [x] Task 4 — `src/app/api/storage/health/route.ts`: add `memory`
      (process + cgroup), `walBytes`, `topTables`, `cleanup` (last run +
      `autoCleanupEnabled`), `memoryFts` bytes. Each block best-effort.
- [x] Task 5 — `SystemStorageTab.tsx` + `en.json`: "Maintenance" card —
      last cleanup relative time + deleted/errors, WAL size, top tables,
      RSS vs cgroup billed memory, FTS bytes. Loading/error/empty states.
- [x] Task 6 — `tests/unit/storage-ops-visibility.test.ts`: KV roundtrip,
      top-tables query, cgroup stat parser.

## Out of scope

- No auth-posture change on `/api/storage/health` (CLI + dashboard call it as-is).
- No new locale files — EN keys only; other locales fall back to EN via
  `src/i18n/request.ts` deep-merge.
- No `getDatabaseStats()` reuse for the endpoint — it COUNT(*)s every table,
  too heavy for a polled surface.

## Verification

- `node --import tsx/esm --test tests/unit/storage-ops-visibility.test.ts`
- `npm run typecheck:core`, `npm run lint`, `npm run build`
- Live: `/api/storage/health` returns the new blocks; dashboard renders card.
