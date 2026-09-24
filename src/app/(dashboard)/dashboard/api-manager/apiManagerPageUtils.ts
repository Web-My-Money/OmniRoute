export type KeyStatus = "active" | "disabled" | "banned" | "expired";

// "manage" scope = management key; "restricted" = has model/connection allowlists;
// "standard" = no manage scope and no allowlists.
// Note: a "manage" key with allowlists is still classified as "manage" (manage takes priority).
export type KeyType = "standard" | "manage" | "restricted";

export interface ApiKeyShape {
  isActive?: boolean;
  isBanned?: boolean;
  expiresAt?: string | null;
  scopes?: string[];
  allowedModels?: string[] | null;
  allowedConnections?: string[] | null;
}

export function isKeyActive(k: ApiKeyShape): boolean {
  if (k.isBanned === true) return false;
  if (k.isActive === false) return false;
  if (k.expiresAt) {
    return new Date(k.expiresAt).getTime() > Date.now();
  }
  return true;
}

export function isExpired(k: ApiKeyShape): boolean {
  if (!k.expiresAt) return false;
  const ts = new Date(k.expiresAt).getTime();
  if (Number.isNaN(ts)) return false;
  return ts < Date.now();
}

export function isRestricted(k: ApiKeyShape): boolean {
  const hasModelRestrictions = Array.isArray(k.allowedModels) && k.allowedModels.length > 0;
  const hasConnectionRestrictions =
    Array.isArray(k.allowedConnections) && k.allowedConnections.length > 0;
  return hasModelRestrictions || hasConnectionRestrictions;
}

export function classifyKeyStatus(k: ApiKeyShape): KeyStatus {
  if (k.isBanned === true) return "banned";
  if (isExpired(k)) return "expired";
  if (k.isActive === false) return "disabled";
  return "active";
}

export function classifyKeyType(k: ApiKeyShape): KeyType {
  if (Array.isArray(k.scopes) && k.scopes.includes("manage")) return "manage";
  if (isRestricted(k)) return "restricted";
  return "standard";
}

export interface ApiKeyCounts {
  total: number;
  active: number;
  disabled: number;
  banned: number;
  expired: number;
  standard: number;
  manage: number;
  restricted: number;
}

export function computeApiKeyCounts(keys: ApiKeyShape[]): ApiKeyCounts {
  const counts: ApiKeyCounts = {
    total: keys.length,
    active: 0,
    disabled: 0,
    banned: 0,
    expired: 0,
    standard: 0,
    manage: 0,
    restricted: 0,
  };

  for (const k of keys) {
    const status = classifyKeyStatus(k);
    counts[status] += 1;

    const type = classifyKeyType(k);
    counts[type] += 1;
  }

  return counts;
}

export function toLocalDateTimeInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function formatUsdCost(value: number, locale: string): string {
  const amount = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amount > 0 && amount < 1 ? 4 : 2,
    maximumFractionDigits: amount > 0 && amount < 1 ? 4 : 2,
  }).format(amount);
}

/**
 * Mask a fully revealed API key for the at-rest display: keep the first 8 chars
 * (provider prefix + a few entropy bits, e.g. `sk-or-12...`), append an ellipsis.
 * Returns "" for empty/missing input so the UI can render an empty `<code>` cleanly.
 */
export function maskKey(fullKey: string | null | undefined): string {
  if (!fullKey) return "";
  if (fullKey.includes("****")) return fullKey;
  return fullKey.length > 8 ? `${fullKey.slice(0, 8)}...` : fullKey;
}

/**
 * Immutable Set toggle helper for the "which keys are currently revealed" state.
 * Returns a NEW Set so React state setters always see a fresh reference.
 */
export function toggleKeyVisibility(prev: Set<string>, keyId: string): Set<string> {
  const next = new Set(prev);
  if (next.has(keyId)) next.delete(keyId);
  else next.add(keyId);
  return next;
}

import { useState, useEffect } from "react";

export const MAX_KEY_NAME_LENGTH = 200;
export const MAX_SELECTED_MODELS = 500;
export const CLAUDE_CODE_DEFAULT_MODEL_ID = "cc/*";
export const CLAUDE_CODE_DEFAULT_MODEL_NAME = "Claude Code default";
export const CLAUDE_CODE_DEFAULT_FAMILIES = [
  { id: "other", label: "other" },
  { id: "fable", label: "fable" },
  { id: "opus", label: "opus" },
  { id: "sonnet", label: "sonnet" },
  { id: "haiku", label: "haiku" },
] as const;
export type ClaudeCodeFamilyId = (typeof CLAUDE_CODE_DEFAULT_FAMILIES)[number]["id"];
export type ClaudeCodeBlockableFamilyId = Exclude<ClaudeCodeFamilyId, "other">;
export const CLAUDE_CODE_FAMILY_BLOCK_PATTERNS: Record<ClaudeCodeBlockableFamilyId, string[]> = {
  fable: ["claude-fable*", "fable"],
  opus: ["claude-opus*", "opus"],
  sonnet: ["claude-sonnet*", "sonnet"],
  haiku: ["claude-haiku*", "haiku"],
};
export const CLAUDE_CODE_BLOCK_PATTERN_SET = new Set(
  Object.values(CLAUDE_CODE_FAMILY_BLOCK_PATTERNS).flat()
);

// Debounce hook for search optimization
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// Sanitize user input to prevent XSS
export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, "")
    .replace(/"/g, "")
    .replace(/'/g, "")
    .trim()
    .slice(0, MAX_KEY_NAME_LENGTH);
}

// Validate key name
export function validateKeyName(
  name: string,
  t: (key: string, values?: Record<string, unknown>) => string
): { valid: boolean; error?: string } {
  if (!name || !name.trim()) {
    return { valid: false, error: t("keyNameRequired") };
  }
  if (name.length > MAX_KEY_NAME_LENGTH) {
    return { valid: false, error: t("keyNameTooLong", { max: MAX_KEY_NAME_LENGTH }) };
  }
  // Allow Unicode letters (accented chars), numbers, spaces, hyphens, underscores
  if (!/^[\p{L}\p{N}_\-\s]+$/u.test(name)) {
    return {
      valid: false,
      error: t("keyNameInvalid"),
    };
  }
  return { valid: true };
}

export interface AccessSchedule {
  enabled: boolean;
  from: string;
  until: string;
  days: number[];
  tz: string;
}

export type StreamDefaultMode = "legacy" | "json";

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  allowedModels: string[] | null;
  blockedModels?: string[] | null;
  allowedCombos: string[] | null;
  allowedConnections: string[] | null;
  noLog?: boolean;
  autoResolve?: boolean;
  isActive?: boolean;
  throttleDelayMs?: number | null;
  isBanned?: boolean;
  expiresAt?: string | null;
  maxSessions?: number;
  accessSchedule?: AccessSchedule | null;
  rateLimits?: Array<{ limit: number; window: number }> | null;
  scopes?: string[];
  allowedEndpoints?: string[];
  streamDefaultMode?: StreamDefaultMode;
  disableNonPublicModels?: boolean;
  allowUsageCommand?: boolean;
  chaosModeEnabled?: boolean;
  usageLimitEnabled?: boolean;
  dailyUsageLimitUsd?: number | null;
  weeklyUsageLimitUsd?: number | null;
  allowedQuotas?: string[] | null;
  createdAt: string;
}

export interface ProviderConnection {
  id: string;
  name: string;
  provider: string;
  isActive: boolean;
}

export interface KeyUsageStats {
  totalRequests: number;
  totalCost: number;
  lastUsed: string | null;
}

export interface Model {
  id: string;
  owned_by: string;
  name?: string;
}

export interface ComboOption {
  id?: string;
  name: string;
  models?: unknown[];
}

/** Tuple type for models grouped by provider: [providerName, models[]] */
export type ProviderGroup = [provider: string, models: Model[]];

export function isClaudeCodeModel(model: Model): boolean {
  return (
    model.owned_by === "claude" || model.id.startsWith("cc/") || model.id.startsWith("claude/")
  );
}

export function withClaudeCodeDefaultModel(models: Model[]): Model[] {
  if (!models.some(isClaudeCodeModel)) return models;
  if (models.some((model) => model.id === CLAUDE_CODE_DEFAULT_MODEL_ID)) return models;
  return [
    {
      id: CLAUDE_CODE_DEFAULT_MODEL_ID,
      name: CLAUDE_CODE_DEFAULT_MODEL_NAME,
      owned_by: "claude",
    },
    ...models,
  ];
}

export function getBlockedClaudeCodeFamilies(
  blockedModels: string[]
): ClaudeCodeBlockableFamilyId[] {
  return (Object.keys(CLAUDE_CODE_FAMILY_BLOCK_PATTERNS) as ClaudeCodeBlockableFamilyId[]).filter(
    (familyId) =>
      CLAUDE_CODE_FAMILY_BLOCK_PATTERNS[familyId].some((pattern) => blockedModels.includes(pattern))
  );
}

export function isClaudeCodeFamilyModel(
  modelId: string,
  familyId: ClaudeCodeBlockableFamilyId
): boolean {
  const normalized = modelId.toLowerCase();
  return (
    normalized === familyId ||
    normalized.includes(`/${familyId}`) ||
    normalized.includes(`-${familyId}`)
  );
}
