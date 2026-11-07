import { createHmac } from "node:crypto";

import { normalizeCodexSessionId } from "./codexClient.ts";
import {
  deriveStableUUIDv4,
  getCodexClientSessionId,
  getCodexFingerprintSeed,
} from "./codexIdentity.ts";

// WMM fork patch (upstream PR #18274 stopped sending a Codex session for clients that present none;
// Hermes presents none, and its Codex cache-read share fell from 84.5% to 14.9%). When the client
// supplies no session of its own, derive a stable per-conversation id server-side and present it
// exactly like a client-supplied `x-session-id`, so identity convergence, `session_id` and
// `thread-id` are produced by the same code path a real client session takes.
//
// The id is an HMAC of the conversation's stable prefix (system-prompt head + first user turn)
// keyed by the connection's persisted fingerprint seed, reduced to a UUID: it never carries
// message text, stays identical across the turns of one conversation, and differs between
// conversations. It is never random per request and never one global value.

const DERIVED_SESSION_NAMESPACE = "omniroute:wmm-codex-derived-session:v1:";
// Only the head of the system prompt is hashed: the tail (skills index, memory snapshots) may be
// refreshed mid-conversation, and a changing id would then forfeit the cache hit it exists for.
const SYSTEM_PREFIX_CHARS = 4096;
const SESSION_HEADER_ALIASES = new Set([
  "session-id",
  "session_id",
  "x-opencode-session-id",
  "x-session-affinity",
  "x-session-id",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    const record = asRecord(part);
    if (record && typeof record.text === "string") parts.push(record.text);
  }
  return parts.join("\n");
}

/**
 * The conversation's stable prefix: `instructions` plus every system/developer item before the
 * first user turn (head-capped), then the first user turn. Null when there is no non-empty user
 * turn, so there is nothing conversation-specific to key on.
 */
export function extractCodexConversationPrefix(body: unknown): string | null {
  const record = asRecord(body);
  if (!record) return null;
  // A continuation only carries the new items; its first user turn is not the conversation's.
  if (typeof record.previous_response_id === "string" && record.previous_response_id) return null;

  let system = typeof record.instructions === "string" ? record.instructions : "";
  let firstUser = "";
  if (typeof record.input === "string") {
    firstUser = record.input;
  } else {
    // The executor can still receive a Chat Completions body (`messages`) before it converts it.
    const items = Array.isArray(record.input)
      ? record.input
      : Array.isArray(record.messages)
        ? record.messages
        : [];
    for (const item of items) {
      const entry = asRecord(item);
      if (!entry) continue;
      const role = entry.role;
      if (role === "user") {
        firstUser = contentText(entry.content);
        break;
      }
      if (role === "system" || role === "developer") {
        system += `\n${contentText(entry.content)}`;
      }
    }
  }
  firstUser = firstUser.trim();
  if (!firstUser) return null;
  return `${system.slice(0, SYSTEM_PREFIX_CHARS)}\u0000${firstUser}`;
}

function bodyPresentsSession(body: unknown): boolean {
  const record = asRecord(body);
  if (!record) return false;
  return (
    normalizeCodexSessionId(record.prompt_cache_key) !== null ||
    normalizeCodexSessionId(record.session_id) !== null ||
    normalizeCodexSessionId(record.conversation_id) !== null
  );
}

/** Derives the per-conversation session id, or null when no usable prefix exists. */
export function deriveCodexConversationSessionId(
  body: unknown,
  providerSpecificData?: Record<string, unknown> | null,
  accountKey?: string | null
): string | null {
  const prefix = extractCodexConversationPrefix(body);
  if (!prefix) return null;
  const key = getCodexFingerprintSeed(providerSpecificData) || accountKey || "default";
  const digest = createHmac("sha256", key).update(prefix).digest("hex");
  return deriveStableUUIDv4(`${DERIVED_SESSION_NAMESPACE}${digest}`);
}

/**
 * Returns `clientHeaders` untouched when the client already presented a session (header or body)
 * or no id can be derived; otherwise a copy carrying the derived id as `x-session-id`.
 */
export function withDerivedCodexSessionHeader(
  clientHeaders: Record<string, string> | null | undefined,
  body: unknown,
  providerSpecificData?: Record<string, unknown> | null,
  accountKey?: string | null
): Record<string, string> | null | undefined {
  if (process.env.WMM_CODEX_DERIVED_SESSION === "0") return clientHeaders;
  if (getCodexClientSessionId(clientHeaders) || bodyPresentsSession(body)) return clientHeaders;
  const derived = deriveCodexConversationSessionId(body, providerSpecificData, accountKey);
  if (!derived) return clientHeaders;
  const next: Record<string, string> = {};
  for (const [name, value] of Object.entries(clientHeaders ?? {})) {
    // An unusable client alias (failed normalization above) must not shadow the derived id.
    if (!SESSION_HEADER_ALIASES.has(name.toLowerCase())) next[name] = value;
  }
  next["x-session-id"] = derived;
  return next;
}
