#!/usr/bin/env node
// scripts/check/check-upstream-drift.mjs
// Upstream-drift guard for local patches.
//
// History: the v3.8.50 adoption rebase (`-s ours`) silently reverted every
// merged local fix wherever upstream touched the same file — none of it showed
// up as a conflict, so the regressions shipped (see PR #28).
//
// This gate freezes a manifest of "sentinel" lines — lines that exist in our
// tree but not in the upstream merge-base, per file we have locally patched
// (config/quality/upstream-patch-manifest.json). Check mode greps the working
// tree: a missing sentinel means a file that once carried a local fix no
// longer does, which is exactly what a `-s ours` rebase produces. No git or
// network access is required at check time — only --update needs the
// `upstream` remote.
//
// False-positive remedy: legitimate edits that remove a sentinel just need a
// manifest refresh via --update (run it on the rebased/merged result).
//
// Run:
//   node scripts/check/check-upstream-drift.mjs            # verify
//   node scripts/check/check-upstream-drift.mjs --update   # regen manifest
//   node scripts/check/check-upstream-drift.mjs --update --upstream <ref>

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MANIFEST_PATH = path.join(ROOT, "config/quality/upstream-patch-manifest.json");
const UPDATE = process.argv.includes("--update");
const upstreamIdx = process.argv.indexOf("--upstream");
const UPSTREAM_REF =
  upstreamIdx !== -1 && process.argv[upstreamIdx + 1]
    ? process.argv[upstreamIdx + 1]
    : loadManifestRef() || "upstream/main";

const MAX_SENTINELS_PER_FILE = 3;
const MIN_SENTINEL_LEN = 8;

// Lines that carry no identifying content (braces, closers, empty blocks).
const TRIVIAL_LINE = /^[\s{}\]()<>[\],;:&|.+\-*/'"`?~!@#$%^=\\]*$/;

function normalizeLine(line) {
  return line.trim().replace(/\s+/g, " ");
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd: ROOT });
}

function loadManifestRef() {
  try {
    if (fs.existsSync(MANIFEST_PATH)) {
      const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
      return m.upstreamRef;
    }
  } catch {
    /* fall through to default */
  }
  return null;
}

/**
 * Picks up to MAX_SENTINELS_PER_FILE distinctive added lines from a file's
 * `git diff <ref>...HEAD` patch. Exported for unit testing.
 */
export function pickSentinels(unifiedPatch) {
  const added = [];
  for (const raw of String(unifiedPatch).split("\n")) {
    if (!raw.startsWith("+") || raw.startsWith("+++")) continue;
    const line = normalizeLine(raw.slice(1));
    if (line.length < MIN_SENTINEL_LEN || TRIVIAL_LINE.test(line)) continue;
    if (!added.includes(line)) added.push(line);
  }
  // Longest lines are the most distinctive — prefer them as sentinels.
  return added.sort((a, b) => b.length - a.length).slice(0, MAX_SENTINELS_PER_FILE);
}

/**
 * Compares the working tree against the manifest. Returns `{ regressions }`:
 * entries where a manifest file is missing, was expected deleted but exists,
 * or has lost a sentinel line. Exported for unit testing.
 */
export function diffWorkingTree(manifest, rootDir = ROOT) {
  const regressions = [];
  for (const [file, entry] of Object.entries(manifest.files || {})) {
    const abs = path.join(rootDir, file);
    if (entry.deleted) {
      if (fs.existsSync(abs)) {
        regressions.push({ file, reason: "file was locally deleted vs upstream but exists again" });
      }
      continue;
    }
    if (!fs.existsSync(abs)) {
      regressions.push({ file, reason: "file missing from working tree" });
      continue;
    }
    let content = fs.readFileSync(abs, "utf8");
    // Whitespace-insensitive matching: normalize each line once.
    const lines = new Set(content.split("\n").map(normalizeLine));
    for (const sentinel of entry.sentinels || []) {
      if (!lines.has(normalizeLine(sentinel))) {
        regressions.push({ file, reason: `lost sentinel: ${sentinel}` });
      }
    }
  }
  return regressions;
}

function generateManifest() {
  // merge-base vs working tree (no commit-ish second arg): uncommitted fixes
  // count too, and the sentinels match what check mode greps on disk.
  const base = git(["merge-base", UPSTREAM_REF, "HEAD"]).trim();
  // With -z, --name-status emits "STATUS\0PATH\0" pairs (renames emit two paths).
  const nameStatus = git(["diff", base, "--name-status", "-z"]);
  const tokens = nameStatus.split("\0").filter(Boolean);
  const files = {};
  for (let i = 0; i < tokens.length; i++) {
    const status = tokens[i];
    if (status.startsWith("R") || status.startsWith("C")) {
      // Rename/copy: old path follows, then new path — track the new one.
      i += 1;
      const file = tokens[++i];
      if (file) files[file] = { sentinels: [] };
      continue;
    }
    const file = tokens[++i];
    if (!file) continue;
    if (status === "D") {
      files[file] = { deleted: true };
      continue;
    }
    if (status === "R" || status === "C") {
      skipped++;
      continue;
    }
    const patch = git(["diff", base, "--", file]);
    if (patch.includes("Binary files")) {
      files[file] = { sentinels: [] }; // existence-only check
      continue;
    }
    files[file] = { sentinels: pickSentinels(patch) };
  }
  return { upstreamRef: UPSTREAM_REF, files };
}

function main() {
  if (UPDATE) {
    const manifest = generateManifest();
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
    console.log(
      `[upstream-drift] manifest rewritten — ${Object.keys(manifest.files).length} locally-patched files vs ${UPSTREAM_REF}.`
    );
    process.exit(0);
  }

  if (!fs.existsSync(MANIFEST_PATH)) {
    process.stderr.write(`[upstream-drift] FAIL — manifest not found at ${MANIFEST_PATH}\n`);
    process.exit(2);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const regressions = diffWorkingTree(manifest);

  if (regressions.length > 0) {
    process.stderr.write(
      `[upstream-drift] FAIL — ${regressions.length} locally-patched file(s) lost their ` +
        `sentinel lines (baseline vs ${manifest.upstreamRef}):\n` +
        regressions.map((r) => `  ✗ ${r.file} — ${r.reason}`).join("\n") +
        `\n\nThis usually means an '-s ours' rebase or merge silently reverted local fixes\n` +
        `(the exact mechanism that regressed PR #28's fixes during the v3.8.50 adoption).\n` +
        `Restore the local patches, or if the change was intentional regen the manifest:\n` +
        `  node scripts/check/check-upstream-drift.mjs --update\n`
    );
    process.exit(1);
  }

  console.log(
    `[upstream-drift] OK — ${Object.keys(manifest.files || {}).length} locally-patched files intact.`
  );
  process.exit(0);
}

main();
