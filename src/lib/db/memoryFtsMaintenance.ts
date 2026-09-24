import type { SqliteAdapter } from "./adapters/types";

export interface MemoryFtsMaintenanceOptions {
  minFtsBytes?: number;
  rebuildRatio?: number;
}

export interface MemoryFtsMaintenanceResult {
  action: "missing" | "skipped" | "rebuilt";
  ftsBytes: number;
  memoriesBytes: number;
  durationMs: number;
  error?: string;
}

const DEFAULT_MIN_FTS_BYTES = 64 * 1024 * 1024;
const DEFAULT_REBUILD_RATIO = 8;

function bytesFor(db: SqliteAdapter, predicate: string, value: string): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(pgsize), 0) AS bytes FROM dbstat WHERE ${predicate}`)
    .get(value) as { bytes?: number } | undefined;
  return Number(row?.bytes) || 0;
}

export interface MemoryFtsSize {
  exists: boolean;
  ftsBytes: number;
  memoriesBytes: number;
}

/**
 * Read-only size check for the memory FTS index vs its content table.
 * Used by health surfaces — never rebuilds. Returns `exists: false`
 * when the FTS table has not been created yet.
 */
export function measureMemoryFts(db: SqliteAdapter): MemoryFtsSize {
  try {
    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_fts'")
      .get();
    if (!exists) return { exists: false, ftsBytes: 0, memoriesBytes: 0 };
    return {
      exists: true,
      ftsBytes: bytesFor(db, "name GLOB ?", "memory_fts*"),
      memoriesBytes: bytesFor(db, "name = ?", "memories"),
    };
  } catch {
    return { exists: false, ftsBytes: 0, memoriesBytes: 0 };
  }
}

export function maintainMemoryFts(
  db: SqliteAdapter,
  options: MemoryFtsMaintenanceOptions = {}
): MemoryFtsMaintenanceResult {
  const startedAt = Date.now();
  const base = { ftsBytes: 0, memoriesBytes: 0 };

  try {
    const size = measureMemoryFts(db);
    if (!size.exists) {
      return { action: "missing", ...base, durationMs: Date.now() - startedAt };
    }

    const ftsBytes = size.ftsBytes;
    const memoriesBytes = Math.max(1, size.memoriesBytes);
    const minFtsBytes = options.minFtsBytes ?? DEFAULT_MIN_FTS_BYTES;
    const rebuildRatio = options.rebuildRatio ?? DEFAULT_REBUILD_RATIO;

    if (ftsBytes < minFtsBytes || ftsBytes / memoriesBytes < rebuildRatio) {
      return { action: "skipped", ftsBytes, memoriesBytes, durationMs: Date.now() - startedAt };
    }

    db.prepare("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')").run();
    return { action: "rebuilt", ftsBytes, memoriesBytes, durationMs: Date.now() - startedAt };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      action: "skipped",
      ...base,
      durationMs: Date.now() - startedAt,
      error: message.slice(0, 300),
    };
  }
}
