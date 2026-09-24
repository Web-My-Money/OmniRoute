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
