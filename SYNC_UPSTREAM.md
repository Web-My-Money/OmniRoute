# Syncing upstream OmniRoute changes into WMM's fork

This fork tracks upstream `cheaper-inference/OmniRoute` (formerly `diegosouzapw/OmniRoute`; the old
URL still redirects). The WMM production branch is `wmm-production`. Last synced: **v3.8.53**
(2026-11-06, `sync/v3.8.53`).

It carries these load-bearing WMM changes. After every merge, confirm each one still exists
(the drift guard below checks the sentinel lines; the tests listed prove the behaviour):

| Patch | Where | Proof |
| --- | --- | --- |
| `Dockerfile.railway` (truncated at `runner-base`, Railway cache-mount ids, pre-baked Playwright Chromium with a build-time resolved `playwright-core` dir) | `Dockerfile.railway` | Railway build of the branch |
| Chat admission false-positive fix: structure caps depth 40 / 50,000 nodes, non-ASCII weight 0.5 (messages) / 0.25 (tool schemas + keys), heavy lease default 4 | `src/shared/middleware/chatBodyAdmission.ts`, `src/shared/middleware/chatAdmissionStructureEstimate.ts` | `tests/unit/chat-admission-structure-false-positives.test.ts` |
| `auto/*` virtual combos cannot bypass `allowedCombos` | upstream fixed it in v3.8.53 (`isVirtualComboModel` in `src/shared/utils/apiKeyPolicy.ts`); the fork copy of the fix was dropped | `tests/unit/` api-key policy tests |
| Claude Sonnet 5.5 `thinking:disabled` -> `between_tools`, Opus 5.5 -> `adaptive` (`thinkingDisabledAs`) | `src/shared/constants/modelSpecs.ts` | `tests/unit/claude-sonnet-5-5-thinking-between-tools.test.ts`, `tests/unit/claude-opus-5-5-thinking-adaptive.test.ts` |
| Bounded raw provider-connection cache fill (10,000 rows) | `src/lib/db/readCache.ts` | — |
| Codex per-conversation session fallback: a client that presents no session (Hermes) gets a server-derived, HMAC-keyed `x-session-id` so the request keeps its cached prefix (upstream #18274, v3.8.53, dropped the old always-on `session_id` header: Hermes cache-read 84.5% -> 14.9%). Kill switch: env `WMM_CODEX_DERIVED_SESSION=0` | `open-sse/config/codexDerivedSession.ts`, call in `CodexExecutor.execute` (`open-sse/executors/codex.ts`) | `tests/unit/codex-derived-session.test.ts` |
| Codex scope cooldowns survive connection recovery: clearing the parent `rateLimitedUntil` drops only EXPIRED nested entries (`stripExpiredCodexChildCooldownFields`), and `getCodexChildCooldown` returns only an ACTIVE cooldown | `src/lib/db/providers/codexAccountState.ts`, `open-sse/services/codexAccount/index.ts` | `tests/unit/codex-scope-cooldown-survives-recovery.test.ts`, `tests/unit/codex-scope-cooldown-clear-12817.test.ts` |
| CI runs on `wmm-production`; upstream-drift guard step | `.github/workflows/ci.yml`, `quality.yml` | `npm run check:upstream-drift` |

## Merge procedure

```bash
git remote add upstream https://github.com/cheaper-inference/OmniRoute.git   # once
git fetch upstream --tags
git checkout -b sync/<version> origin/wmm-production   # work in a fresh worktree, not the main checkout
git merge <tag>            # a REAL merge of the release tag
# resolve conflicts (see "Conflict policy"), then:
npm ci --legacy-peer-deps --ignore-scripts   # use the npm the Dockerfile installs (npm@latest)
npm run typecheck:core && npm run check:upstream-drift
```

**Never** `git rebase` onto an upstream tag and **never** `git merge -s ours`. A past `-s ours`
rebase onto v3.8.50 silently reverted PR #28's fixes with no conflict at all; the drift guard
(`config/quality/upstream-patch-manifest.json`, `scripts/check/check-upstream-drift.mjs`) exists
because of it.

## Conflict policy that worked for v3.8.53

The fork carried ~2,700 changed files against v3.8.50, almost all of them strict-typing sweeps
and build-tracer hygiene (`opaqueJoin`, `/* turbopackIgnore: true */`). 656 files conflicted. The
rule: for a conflicted file with no functional WMM patch, take upstream's version
(`git checkout --theirs`); for the files in the table above, merge by hand and re-apply the patch
on top of upstream's current code. Typing sweeps are cheap to redo; a reverted functional patch is
not.

## After every merge, verify

1. The table above: each patch present, each test green.
2. `Dockerfile.railway` re-synced from upstream's `Dockerfile` (not hand-edited): cut at
   `runner-base`, Railway cache-mount ids `s/c1a15bab-c913-4ee7-b676-1a2a1d46967c-<path>` (the
   id of the live production `omniroute` service; a throwaway staging service must swap them for
   its own), Playwright pre-bake block. Check the header comment for the delta list.
3. `package-lock.json` regenerated with the npm that the Dockerfile installs (`npm@latest`),
   `--legacy-peer-deps`, otherwise `npm ci` in the image can fail.
4. Schema: OmniRoute state lives in `storage.sqlite` on the Railway volume and migrates in place on
   boot. Take a manual backup first (`PUT /api/db-backups`; **`POST` restores**), and test the
   build on a throwaway Railway service before merging.
5. `.github/workflows/upstream-sync-check.yml` tracks the latest published upstream release.
6. Refresh the drift manifest on the merged result: `node scripts/check/check-upstream-drift.mjs
   --update --upstream <tag>`.

## What not to do

- **Never "bump the pinned image tag"** to the upstream image. That drops the WMM fixes.
- **Never delete `Dockerfile.railway`** until Railway supports `--target` selection.
- Railway applies env-var changes only on a successful deploy: a broken build silently blocks them.
