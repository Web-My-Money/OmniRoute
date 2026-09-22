# Balanced Operations Improvement Design

Date: 2026-09-22
Status: Approved for planning
Scope: OmniRoute plus the WMM Cloud Guard and Verify Runner operator surfaces

## Objective

Improve production reliability, cloud cost stability, operator visibility, dashboard usability, and accessibility without a broad visual rebrand or an unsafe multi-system rewrite.

The work ships as small, independently verified waves. Each wave must preserve production behavior, use focused tests, pass the owning repository's verification floor, deploy through its normal Git workflow, and receive post-deployment health and resource checks.

## Current Evidence

- OmniRoute's real Next.js startup path is `src/instrumentation-node.ts`; `src/server-init.ts` is unused.
- `src/lib/db/cleanup.ts` runs retention cleanup at startup and every six hours after the scheduler is initialized.
- The production cleanup scheduler now starts from the real boot path.
- Production SQLite was reduced from 865 MB to approximately 319 MB after rebuilding the memory FTS index, pruning telemetry, and vacuuming.
- The production database passes SQLite `quick_check`.
- Usage-history retention is set to 30 days.
- Recent cleanup logs report failures for the MCP audit and A2A event cleanup targets because their timestamp-column assumptions do not match the live schema.
- Railway's memory metric includes cgroup file cache as well as anonymous application memory. The dashboard currently does not explain that distinction.
- Verify Runner and Cloud Guard are the largest remaining egress sources.
- `src/app/(dashboard)/dashboard/settings/components/SystemStorageTab.tsx` owns the operator-facing database retention and storage controls.
- `src/shared/components/Sidebar.tsx` owns primary dashboard navigation.

## Design Principles

1. Correctness before polish within each wave.
2. One owner per concern: OmniRoute owns its database lifecycle and dashboard; `wmm-agents` owns guard and verification diagnostics.
3. Visibility must be actionable: every warning needs a cause, impact, and next action.
4. Destructive or expensive operations need clear confirmation and progress states.
5. No invented health: stale data must render as stale, unknown data as unknown, and partial failures as degraded.
6. Preserve existing visual identity. Improve hierarchy, language, accessibility, and interaction rather than redesigning for novelty.
7. Do not overwrite unrelated local work, including the existing Verify Runner log-tail change.

## Wave 1: Reliability and Cost Correctness

### Cleanup schema correctness

Correct the cleanup queries for the live MCP audit and A2A event schemas. Tests must create representative tables, insert old and recent records, run the cleanup functions, and verify that only expired records are removed.

Cleanup results should use table-accurate names in logs. A single target failure must remain isolated so other retention jobs continue.

### FTS maintenance

Add bounded maintenance for the external-content memory FTS index. Maintenance must not run on every request and must avoid blocking normal traffic for an unbounded period. The preferred trigger is the existing cleanup cycle after meaningful memory deletions or measurable FTS bloat.

Expose the last successful FTS maintenance time and any failure without exposing memory contents.

### Retention and vacuum behavior

Retain the six-hour cleanup cadence. Avoid running `VACUUM` when no rows were removed. Prevent duplicate proxy-log cleanup in the same cycle. Preserve usage rollups before raw usage deletion.

Large database maintenance must expose duration and reclaimed bytes so operators can distinguish useful maintenance from recurring churn.

### Verify Runner diagnostics

Preserve the newest portion of bounded failure output so the final failure is visible. Keep comments bounded and sanitized. Add a focused regression test proving that oversized logs retain the end rather than the beginning.

Review clone and dependency-download paths for measurable egress reductions without weakening verification fidelity.

## Wave 2: Operator Visibility

### System health summary

Add an operator-focused health summary using existing health and storage data. It should show:

- application memory versus file cache when available;
- database size and recent growth direction;
- last cleanup time, deleted-row count, duration, and errors;
- last vacuum and FTS maintenance status;
- provider-health totals split into active, degraded, expired, and unsupported;
- freshness timestamps for every value.

Do not label the system healthy when required signals are stale or unavailable. Use explicit states: healthy, degraded, critical, stale, and unknown.

### Storage settings clarity

Improve `SystemStorageTab.tsx` so each retention field explains what is retained, whether older data is rolled up, and the cost implication of long retention. Highlight values that materially exceed defaults without silently changing them.

Separate routine retention from destructive reset actions. Destructive actions require a confirmation that names the affected data and cannot share styling with ordinary save actions.

### Provider health visibility

Provider-health status should distinguish unsupported validation from invalid credentials. Unsupported probes must not look like broken credentials. Expired OAuth connections should show the recovery action and last successful use or test when available.

### Cloud Guard and Verify Runner visibility

Expose job freshness, last outcome, processed/skipped counts, and bounded failure reason. Differentiate a successful no-op sweep from a sweep that did no work because access, quota, or configuration blocked it.

## Wave 3: UX and Accessibility

### Navigation hierarchy

Audit `Sidebar.tsx` against actual operator frequency. Keep primary operational surfaces prominent and group advanced protocol, development, and configuration screens separately. Preserve routes and deep links.

Navigation must support keyboard use, visible focus, current-page indication independent of color, collapsed-state labels, and responsive overflow.

### Loading, empty, error, and stale states

Every audited dashboard data surface must have distinct states for:

- initial loading;
- empty but valid data;
- partial/degraded data;
- request failure with retry;
- stale cached data.

Avoid blank panels, indefinite spinners, and generic `Something went wrong` messages when a safe actionable explanation exists.

### Tables and dense operational data

Operational tables need usable narrow-screen behavior, stable headers where appropriate, readable truncation with access to full values, sortable-column semantics, and preserved context during refresh.

### Forms and feedback

Settings changes need field-level validation, disabled and pending states, success confirmation tied to the changed section, and error recovery that preserves unsaved input.

All icon-only controls need accessible names and adequate target size. Modal focus must be trapped and restored. Motion must respect reduced-motion preferences.

## Wave 4: Code and Performance Quality

### Component boundaries

Split oversized client components only where profiling or review shows mixed responsibilities. Keep data loading, state transitions, and presentation independently testable. Avoid speculative abstraction.

### Polling and rendering

Inventory polling intervals and visibility behavior. Pause nonessential polling when the page is hidden. Deduplicate requests shared across panels. Avoid rebuilding large derived collections during unrelated renders.

### Query and cache bounds

Review dashboard routes and SQLite modules for unbounded reads, high-cardinality indexes, duplicated indexes, and cache entries without eviction. Changes require evidence from query plans, table sizes, or runtime metrics.

### Dead startup paths

Remove or clearly quarantine startup code that cannot execute only after proving it has no supported entry point. Until then, do not add new runtime initialization to `src/server-init.ts`.

## Error Handling and Safety

- Never print or persist secrets in diagnostics.
- Health endpoints return bounded, non-sensitive summaries.
- Maintenance jobs are idempotent and isolate per-target failures.
- Production database changes require a safety backup and integrity check.
- No retention reduction may discard data that is not either intentionally ephemeral or preserved through an existing aggregate.
- Railway environment changes require deployment and health verification.

## Verification Strategy

For each code wave:

1. Add focused regression tests before the fix where practical.
2. Run the focused tests during iteration.
3. Run formatting on changed files.
4. Run `npm run typecheck:core`, `npm run lint`, relevant tests, and a production build for OmniRoute.
5. Run the owning `wmm-agents` verification command for guard or runner changes.
6. Review the complete diff and confirm unrelated local work is excluded.
7. Ship one focused PR per independently deployable concern.
8. Verify deployment status, health endpoints, relevant logs, database integrity where applicable, and post-deployment memory/egress behavior.

Pre-existing verification failures must be measured against an unchanged baseline. A change may not add failures, but baseline failures remain explicitly unresolved rather than being called clean.

## Success Criteria

- Cleanup completes with zero schema errors for supported tables.
- Expired MCP and A2A records are removed without deleting recent records.
- Database size remains bounded under normal traffic and FTS bloat is observable and maintainable.
- Operators can identify whether elevated Railway memory is application memory or file cache.
- Storage and retention settings clearly communicate impact and destructive scope.
- Provider-health UI distinguishes unsupported checks, invalid credentials, and expired sessions.
- Guard and runner surfaces show freshness and actionable failure causes.
- Audited dashboard paths meet keyboard, focus, state-feedback, and responsive-overflow requirements.
- Verify Runner failure comments retain the actual final error while staying bounded.
- No unrelated PRs, secret exposure, or production regressions are introduced.
