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

export function maintainMemoryFts(
  db: SqliteAdapter,
  options: MemoryFtsMaintenanceOptions = {}
): MemoryFtsMaintenanceResult {
  const startedAt = Date.now();
  const base = { ftsBytes: 0, memoriesBytes: 0 };

  try {
    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_fts'")
      .get();
    if (!exists) {
      return { action: "missing", ...base, durationMs: Date.now() - startedAt };
    }

    const ftsBytes = bytesFor(db, "name GLOB ?", "memory_fts*");
    const memoriesBytes = Math.max(1, bytesFor(db, "name = ?", "memories"));
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
