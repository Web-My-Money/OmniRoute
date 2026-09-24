import fs from "node:fs";
import path from "node:path";

/**
 * Indirection for path joins whose segments point at runtime-resolved
 * locations outside the repository (install dirs, host binaries, env
 * overrides). Turbopack/NFT evaluates `path.join(dir, name)` with a
 * dynamic segment as a glob pattern and traces tens of thousands of
 * repository files into the standalone output; routing the join through
 * a plain function call keeps the result opaque to the static analyzer.
 */
export function opaqueJoin(...segments: string[]): string {
  return path.join(...segments);
}

/**
 * Walk up from each anchor looking for `rel` (a subdirectory marker like
 * "open-sse/services/compression"); returns the containing directory.
 * Falls back to `fallback` when no anchor matches. Keeping the probe loop
 * inside this module confines the fs trace to one file instead of every
 * importer's NFT context.
 */
export function probeUpForSubpath(
  anchors: string[],
  rel: string,
  fallback: string,
  maxDepth = 8
): string {
  for (const anchor of anchors) {
    let dir = path.resolve(anchor);
    for (let i = 0; i <= maxDepth; i++) {
      if (fs.existsSync(/* turbopackIgnore: true */ path.join(dir, rel))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return fallback;
}
