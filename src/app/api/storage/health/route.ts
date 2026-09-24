import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { resolveDataDir } from "@/lib/dataPaths";
import {
  getAppLogRetentionDays,
  getCallLogRetentionDays,
  getCallLogsTableMaxRows,
  getProxyLogsTableMaxRows,
} from "@/lib/logEnv";
import { getDbBackupMaxFiles, getDbBackupRetentionDays } from "@/lib/db/backup";
import { getDbInstance } from "@/lib/db/core";
import { getLastCleanupRun } from "@/lib/db/cleanup";
import { getUserDatabaseSettings } from "@/lib/db/databaseSettings";
import { measureMemoryFts } from "@/lib/db/memoryFtsMaintenance";
import { getTopTablesBySize } from "@/lib/db/stats";
import { readCgroupMemory } from "@/lib/monitoring/cgroupMemory";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/error";

/**
 * GET /api/storage/health — Return database storage information.
 * Provides: driver, dbPath, sizeBytes, lastBackupAt, retentionDays
 */
export async function GET() {
  try {
    const dataDir = resolveDataDir({});
    const dbFilePath = path.join(dataDir, "storage.sqlite");
    const backupsDir = path.join(dataDir, "db_backups");

    // Get DB file size
    let sizeBytes = 0;
    try {
      if (fs.existsSync(dbFilePath)) {
        const stat = fs.statSync(dbFilePath);
        sizeBytes = stat.size;
      }
    } catch {
      /* ignore */
    }

    // WAL file size — a large WAL means un-checkpointed write backlog, which
    // is disk cost AND a driver of page-cache pressure on container hosts.
    let walBytes = 0;
    try {
      const walPath = `${dbFilePath}-wal`;
      if (fs.existsSync(walPath)) {
        walBytes = fs.statSync(walPath).size;
      }
    } catch {
      /* ignore */
    }

    // Get last backup info
    let lastBackupAt = null;
    let backupCount = 0;
    try {
      if (fs.existsSync(backupsDir)) {
        const files = fs
          .readdirSync(backupsDir)
          .filter((f) => f.startsWith("db_") && f.endsWith(".sqlite"))
          .sort()
          .reverse();
        backupCount = files.length;
        if (files.length > 0) {
          const latestStat = fs.statSync(path.join(backupsDir, files[0]));
          lastBackupAt = latestStat.mtime.toISOString();
        }
      }
    } catch {
      /* ignore */
    }

    // Get the display path (abbreviated with ~)
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    const displayPath = dbFilePath.startsWith(homeDir)
      ? "~" + dbFilePath.slice(homeDir.length)
      : dbFilePath;

    // Operator-visibility blocks — each best-effort so one failing subsystem
    // never blanks the whole payload (same posture as monitoring/health).
    let memory: {
      process: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number };
      cgroup: ReturnType<typeof readCgroupMemory>;
    } | null = null;
    try {
      const usage = process.memoryUsage();
      memory = {
        process: {
          rssBytes: usage.rss,
          heapUsedBytes: usage.heapUsed,
          heapTotalBytes: usage.heapTotal,
        },
        cgroup: readCgroupMemory(),
      };
    } catch {
      /* ignore */
    }

    let topTables: ReturnType<typeof getTopTablesBySize> = [];
    let memoryFts: ReturnType<typeof measureMemoryFts> = {
      exists: false,
      ftsBytes: 0,
      memoriesBytes: 0,
    };
    let cleanup: {
      autoCleanupEnabled: boolean;
      lastRun: ReturnType<typeof getLastCleanupRun>;
    } = { autoCleanupEnabled: false, lastRun: null };
    try {
      const db = getDbInstance();
      topTables = getTopTablesBySize(db, 12);
      memoryFts = measureMemoryFts(db);
      cleanup = {
        autoCleanupEnabled: getUserDatabaseSettings().retention.autoCleanupEnabled === true,
        lastRun: getLastCleanupRun(),
      };
    } catch {
      /* ignore */
    }

    return NextResponse.json({
      driver: "sqlite",
      dbPath: displayPath,
      sizeBytes,
      walBytes,
      lastBackupAt,
      backupCount,
      retentionDays: {
        app: getAppLogRetentionDays(),
        call: getCallLogRetentionDays(),
      },
      tableMaxRows: {
        callLogs: getCallLogsTableMaxRows(),
        proxyLogs: getProxyLogsTableMaxRows(),
      },
      backupRetention: {
        maxFiles: getDbBackupMaxFiles(),
        days: getDbBackupRetentionDays(),
      },
      dataDir: dataDir.startsWith(homeDir) ? "~" + dataDir.slice(homeDir.length) : dataDir,
      memory,
      topTables,
      memoryFts,
      cleanup,
    });
  } catch (error) {
    console.error("[API] Error getting storage health:", error);
    return NextResponse.json({ error: sanitizeErrorMessage(error) }, { status: 500 });
  }
}
