/**
 * db/settings/shared.ts — Foundational types and helpers shared across settings leaf modules.
 */

import { type JsonRecord } from "@/shared/types/json";
export type { JsonRecord };

export function toRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}
