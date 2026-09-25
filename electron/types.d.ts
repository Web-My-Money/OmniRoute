/**
 * OmniRoute Electron Types
 *
 * TypeScript definitions for the Electron API exposed to the renderer process.
 *
 * Updated to reflect:
 * - Fix #6: onServerStatus/onPortChanged return disposer functions
 * - Removed removeServerStatusListener/removePortChangedListener (replaced by disposers)
 */

export interface AppInfo {
  name: string;
  version: string;
  platform: "win32" | "darwin" | "linux";
  isDev: boolean;
  port: number;
  /** Set when Remote Server Mode is active (tray → Remote Server → Connect…). */
  remoteServerUrl: string | null;
}

export interface ServerStatus {
  status: "starting" | "running" | "stopped" | "restarting" | "error";
  port: number;
  /** Present only while connected to a remote server instead of the embedded one. */
  remoteUrl?: string;
}

export type UpdateStatus =
  | { status: "checking" }
  | { status: "available" | "not-available" | "downloaded"; version?: string }
  | { status: "downloading"; percent: number; transferred: number; total: number }
  | { status: "error"; message?: string };

export interface LoginStatus {
  providerId?: string;
  status: string;
  message?: string;
}

export interface LoginResult {
  success: boolean;
  error?: string;
  credentials?: Record<string, unknown>;
}

export interface ElectronAPI {
  // ── Invoke (async) ─────────────────────────────────────
  getAppInfo(): Promise<AppInfo>;
  openExternal(url: string): Promise<void>;
  getDataDir(): Promise<string>;
  restartServer(): Promise<{ success: boolean }>;
  getAppVersion(): Promise<string>;

  // ── Auto-Update ────────────────────────────────────────
  checkForUpdates(): Promise<{ success: boolean; error?: string }>;
  downloadUpdate(): Promise<{ success: boolean; error?: string }>;
  installUpdate(): Promise<void>;

  // ── Autostart ──────────────────────────────────────────
  getAutostartStatus(): Promise<boolean>;
  enableAutostart(): Promise<boolean>;
  disableAutostart(): Promise<boolean>;

  // ── Send (fire-and-forget) ─────────────────────────────
  minimizeWindow(): void;
  maximizeWindow(): void;
  closeWindow(): void;

  // ── Receive (returns disposer for cleanup) ─────────────
  onServerStatus(callback: (data: ServerStatus) => void): () => void;
  onPortChanged(callback: (port: number) => void): () => void;
  onUpdateStatus(callback: (data: UpdateStatus) => void): () => void;

  // ── Web-Cookie Login ───────────────────────────────────
  startLogin(providerId: string, options?: Record<string, unknown>): Promise<LoginResult>;
  cancelLogin(): Promise<{ success: boolean }>;
  getLoginStatus(): Promise<{ active: boolean }>;
  onLoginStatus(callback: (data: LoginStatus) => void): () => void;

  // ── Static Properties ──────────────────────────────────
  isElectron: boolean;
  platform: "win32" | "darwin" | "linux";
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
