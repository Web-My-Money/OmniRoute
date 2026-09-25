/**
 * Canonical loose-object types + guards.
 *
 * `JsonRecord` is the codebase's shared name for `Record<string, unknown>` —
 * the type used when accepting untrusted/partially-known object payloads at
 * boundaries (DB rows, JSON bodies, provider-specific blobs). It was previously
 * re-declared locally in ~30 files; keep one definition here and import it.
 */
export type JsonRecord = Record<string, unknown>;

/** Type guard: value is a plain object (not null, not an array). */
export function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Coerce an unknown value to a JsonRecord — `{}` when it isn't an object. */
export function toRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}
