/**
 * cgroup memory accounting — reads what the container runtime actually bills.
 *
 * On Railway (and other cgroup-based hosts) the billed figure is
 * `memory.current`, which counts RSS **plus page cache** — so an 865 MB
 * SQLite file under constant reads shows up as billed memory even when the
 * Node heap is small. `memory.stat` splits that total into `anon` (real
 * process memory) and `file` (page cache), which is the split operators need
 * to tell "app leak" apart from "filesystem cache pressure".
 *
 * Returns null off-Linux / outside a cgroup container — callers must treat
 * the block as optional.
 */

import fs from "node:fs";

export interface CgroupMemorySnapshot {
  /** cgroup interface generation that was readable. */
  version: 1 | 2;
  /** Billed memory — `memory.current` (v2) or `memory.usage_in_bytes` (v1). */
  currentBytes: number;
  /** Anonymous (real process) memory from memory.stat. null when unparsed. */
  anonBytes: number | null;
  /** Page-cache bytes from memory.stat. null when unparsed. */
  fileBytes: number | null;
  /** Configured limit. null when unlimited ("max" / v1 huge sentinel). */
  limitBytes: number | null;
}

const V2_ROOT = "/sys/fs/cgroup";
const V1_ROOT = "/sys/fs/cgroup/memory";

/** v1 reports "no limit" as an enormous sentinel, not the word "max". */
const V1_UNLIMITED_SENTINEL = 1 << 60;

/** Parse a cgroup `memory.stat` file into a key→value map. */
export function parseCgroupMemoryStat(text: string): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const spaceIndex = trimmed.indexOf(" ");
    if (spaceIndex <= 0) continue;
    const key = trimmed.slice(0, spaceIndex);
    const value = Number.parseInt(trimmed.slice(spaceIndex + 1).trim(), 10);
    if (Number.isFinite(value)) stats[key] = value;
  }
  return stats;
}

function readIntFile(path: string): number | null {
  try {
    const raw = fs.readFileSync(path, "utf8").trim();
    if (!raw || raw === "max") return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function readStatFile(path: string): Record<string, number> | null {
  try {
    return parseCgroupMemoryStat(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Read the cgroup memory snapshot for this process, or null when the host
 * does not expose one (Windows dev, bare-metal, unrestricted runtimes).
 */
export function readCgroupMemory(): CgroupMemorySnapshot | null {
  // cgroup v2 — unified hierarchy (what Railway/containers use today).
  const v2Current = readIntFile(`${V2_ROOT}/memory.current`);
  if (v2Current !== null) {
    const stat = readStatFile(`${V2_ROOT}/memory.stat`);
    return {
      version: 2,
      currentBytes: v2Current,
      anonBytes: stat?.anon ?? null,
      fileBytes: stat?.file ?? null,
      limitBytes: readIntFile(`${V2_ROOT}/memory.max`),
    };
  }

  // cgroup v1 — legacy memory controller layout.
  const v1Current = readIntFile(`${V1_ROOT}/memory.usage_in_bytes`);
  if (v1Current !== null) {
    const stat = readStatFile(`${V1_ROOT}/memory.stat`);
    const rawLimit = readIntFile(`${V1_ROOT}/memory.limit_in_bytes`);
    return {
      version: 1,
      currentBytes: v1Current,
      anonBytes: stat?.total_rss ?? stat?.rss ?? null,
      fileBytes: stat?.total_cache ?? stat?.cache ?? null,
      limitBytes: rawLimit !== null && rawLimit >= V1_UNLIMITED_SENTINEL ? null : rawLimit,
    };
  }

  return null;
}
