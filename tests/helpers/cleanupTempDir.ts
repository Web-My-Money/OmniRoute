import fs from "node:fs";

/**
 * Removes a per-test DATA_DIR after the shared SQLite handle is closed.
 *
 * On Windows, `rmSync` on a directory that still holds an open
 * `storage.sqlite` fails with EBUSY/EPERM — the better-sqlite3 connection
 * keeps the file locked until `closeDbInstance()` releases it, and brief
 * antivirus/indexer locks need the retry window. Use this in `test.after`
 * for any suite that sets `process.env.DATA_DIR`.
 */
export async function cleanupTestDataDir(dir: string): Promise<void> {
  try {
    const { closeDbInstance } = await import("../../src/lib/db/core.ts");
    closeDbInstance();
  } catch {
    // DB module not loaded or already closed — nothing to release.
  }
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
