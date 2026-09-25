import { spawn, spawnSync } from "child_process";
import type {
  ChildProcess,
  SpawnOptions,
  SpawnSyncOptions,
  SpawnSyncOptionsWithStringEncoding,
  SpawnSyncReturns,
} from "child_process";

/**
 * Pass-through wrappers for spawning host-installed binaries (cloudflared,
 * tailscaled, docker, CLI tools, ...). Turbopack's NFT analyzer treats the
 * binary argument of every literal `spawn(...)`/`spawnSync(...)` call as a
 * file to trace into the standalone bundle — but these paths only exist on
 * the user's machine at runtime, so the trace unions glob over ~10k project
 * files and floods the build with false-positive warnings. Calling through
 * these wrappers confines the traced surface to this one module.
 */
export function spawnHostBinary(
  binary: string,
  args: string[],
  options: SpawnOptions
): ChildProcess {
  return spawn(binary, args, options);
}

export function spawnHostBinarySync(
  binary: string,
  args: string[],
  options: SpawnSyncOptionsWithStringEncoding
): SpawnSyncReturns<string>;
export function spawnHostBinarySync(
  binary: string,
  args: string[],
  options: SpawnSyncOptions
): SpawnSyncReturns<Buffer>;
export function spawnHostBinarySync(
  binary: string,
  args: string[],
  options: SpawnSyncOptions
): SpawnSyncReturns<string | Buffer> {
  return spawnSync(binary, args, options);
}
