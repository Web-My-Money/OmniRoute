#!/usr/bin/env node
// scripts/check/check-tests-typecheck.mjs
// Test-tree typecheck ratchet.
//
// `typecheck:core` runs against a curated file allowlist and
// `check:dashboard-typecheck` only covers src/app/(dashboard)/**. Neither gate
// type-checks the ~200-file test tree (tests/**, src/**/__tests__/**,
// *.test.ts(x)), which carries a large backlog of pre-existing strict-program
// errors (untyped mocks, `unknown` fixture reads, wrong object shapes).
//
// This gate runs `tsc` scoped to the test tree via
// tsconfig.typecheck-tests.json and diffs the result against a frozen
// per-file/per-TS-code count baseline
// (config/quality/tests-typecheck-baseline.json), following the same
// stale-enforcement allowlist convention as check-dashboard-typecheck.mjs. A
// live count that EXCEEDS the baselined count for a given (file, TS code) pair
// is a regression and fails the gate; a live count that is lower is an
// improvement and does not fail (use --update to ratchet the baseline down).
//
// Run:
//   node scripts/check/check-tests-typecheck.mjs
//   node scripts/check/check-tests-typecheck.mjs --update   # re-freeze baseline

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const TSCONFIG = path.join(ROOT, "tsconfig.typecheck-tests.json");
const BASELINE_PATH = path.join(ROOT, "config/quality/tests-typecheck-baseline.json");
const UPDATE = process.argv.includes("--update");

// Matches tsc --pretty false output lines, e.g.:
//   tests/unit/foo.test.tsx(12,7): error TS2304: Cannot find name 'bar'.
const TSC_ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+):/;

/**
 * Parses raw `tsc --pretty false` stdout into a nested count map:
 *   { "<relative file path>": { "<TS code>": <count> } }
 *
 * Pure/exported for unit testing against synthetic tsc output — no child
 * process involved here.
 */
export function parseTscOutput(raw) {
  const counts = {};
  const lines = String(raw).split("\n");
  for (const line of lines) {
    const match = TSC_ERROR_LINE.exec(line);
    if (!match) continue;
    const [, file, , , code] = match;
    if (!counts[file]) counts[file] = {};
    counts[file][code] = (counts[file][code] || 0) + 1;
  }
  return counts;
}

/**
 * Compares live (file, TS code) error counts against a frozen baseline.
 * Returns `{ regressions, improvements }`:
 *   - regressions: entries where live count > baselined count (or the pair is
 *     entirely new/unbaselined) — these fail the gate.
 *   - improvements: entries where live count < baselined count — informational,
 *     do not fail (use --update to ratchet the baseline down).
 *
 * Exported for unit testing.
 */
export function diffAgainstBaseline(live, baseline) {
  const regressions = [];
  const improvements = [];

  for (const [file, codes] of Object.entries(live)) {
    for (const [code, liveCount] of Object.entries(codes)) {
      const baselineCount = (baseline[file] && baseline[file][code]) || 0;
      if (liveCount > baselineCount) {
        regressions.push({ file, code, liveCount, baselineCount });
      } else if (liveCount < baselineCount) {
        improvements.push({ file, code, liveCount, baselineCount });
      }
    }
  }

  for (const [file, codes] of Object.entries(baseline)) {
    for (const [code, baselineCount] of Object.entries(codes)) {
      const liveCount = (live[file] && live[file][code]) || 0;
      if (liveCount === 0 && baselineCount > 0) {
        improvements.push({ file, code, liveCount: 0, baselineCount });
      }
    }
  }

  return { regressions, improvements };
}

function runTsc() {
  try {
    // Invoke the local tsc entrypoint through node directly — spawning npx(.cmd)
    // without a shell throws EINVAL on Windows (CVE-2024-27980 hardening).
    const stdout = execFileSync(
      process.execPath,
      [
        path.join(ROOT, "node_modules", "typescript", "bin", "tsc"),
        "--pretty",
        "false",
        "--noEmit",
        "-p",
        TSCONFIG,
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd: ROOT }
    );
    return stdout;
  } catch (err) {
    // tsc exits non-zero when there are type errors — stdout still has the report.
    if (err.stdout) return String(err.stdout);
    throw err;
  }
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return {};
  return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
}

function writeBaseline(counts) {
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(counts, null, 2) + "\n");
}

function main() {
  if (!fs.existsSync(TSCONFIG)) {
    process.stderr.write(`[tests-typecheck] FAIL — tsconfig not found at ${TSCONFIG}\n`);
    process.exit(2);
  }

  console.log("[tests-typecheck] Running tsc scoped to the test tree…");
  const stdout = runTsc();
  const live = parseTscOutput(stdout);
  const baseline = loadBaseline();
  const { regressions, improvements } = diffAgainstBaseline(live, baseline);

  const liveErrorCount = Object.values(live).reduce(
    (sum, codes) => sum + Object.values(codes).reduce((s, c) => s + c, 0),
    0
  );
  console.log(`testsTypecheckErrors=${liveErrorCount}`);

  if (UPDATE) {
    writeBaseline(live);
    console.log(`[tests-typecheck] baseline rewritten (${liveErrorCount} errors frozen).`);
    process.exit(0);
  }

  if (improvements.length > 0) {
    console.log(
      `[tests-typecheck] ${improvements.length} baselined error(s) no longer present ` +
        `— run 'node scripts/check/check-tests-typecheck.mjs --update' to ratchet the baseline down:\n` +
        improvements
          .map(
            (i) => `  - ${i.file} ${i.code} (baseline ${i.baselineCount} -> live ${i.liveCount})`
          )
          .join("\n")
    );
  }

  if (regressions.length > 0) {
    process.stderr.write(
      `[tests-typecheck] FAIL — ${regressions.length} new/regressed TypeScript error(s) ` +
        `in the test tree not covered by the frozen baseline:\n` +
        regressions
          .map((r) => `  ✗ ${r.file} ${r.code} (baseline ${r.baselineCount}, live ${r.liveCount})`)
          .join("\n") +
        `\n\nIf this is a genuine new test typing bug, fix it.\n` +
        `If it's pre-existing test looseness you're intentionally not fixing in this PR,\n` +
        `do NOT widen the baseline for new regressions — that defeats the gate.\n`
    );
    process.exit(1);
  }

  console.log(
    `[tests-typecheck] OK — ${liveErrorCount} pre-existing error(s), all within frozen baseline.`
  );
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
