/**
 * Zed editor installation detection.
 * Purely filesystem-based — no shell interpolation (Hard Rule #13).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DetectionResult } from "../types";

const HOME = os.homedir();
const PATHS = [
  "/Applications/Zed.app",
  path.join(HOME, "Applications", "Zed.app"),
  "/usr/bin/zed",
  "/usr/local/bin/zed",
  path.join(HOME, ".local", "bin", "zed"),
  path.join(HOME, ".local", "share", "zed"),
  path.join(HOME, ".config", "zed"),
  // Windows
  path.join(
    process.env.LOCALAPPDATA ?? path.join(HOME, "AppData", "Local"),
    "Programs",
    "Zed",
    "Zed.exe"
  ),
];

export function detectZed(): DetectionResult {
  for (const p of PATHS) {
    if (fs.existsSync(/* turbopackIgnore: true */ p)) return { installed: true, path: p };
  }
  return { installed: false };
}
