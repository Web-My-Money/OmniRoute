// Test-only widened shapes for credential-selection results.
//
// auth.getProviderCredentials*() returns a big union: real credentials,
// env-credential shapes, and sentinel branches like { allExpired: true }.
// Every test asserts only the branch it exercised, so a JsonRecord
// intersection with the asserted members keeps the checks honest without
// per-site narrowing noise.
import type { JsonRecord } from "../../src/shared/types/json.ts";

export type LooseCreds = JsonRecord & {
  connectionId?: string;
  apiKey?: string | null;
  accessToken?: string | null;
  lastError?: string | null;
  lastErrorCode?: string | null;
  lastErrorType?: string | null;
  lastErrorSource?: string | null;
  errorCode?: string | null;
  error?: string | null;
  allExpired?: boolean;
  expiredCount?: number;
  expiredStatus?: string;
  allRateLimited?: boolean;
  retryAfter?: number;
  waitingForCapacity?: boolean;
  leaseRequired?: boolean;
  leaseFenceStale?: boolean;
  exclusiveLease?: JsonRecord | null;
  freeCount?: number;
  connectionsCount?: number;
  codexScopeRateLimitedUntil?: string | number | null;
  providerSpecificData?: JsonRecord;
};

// Wrap a credential-selection fn so its union result reads as LooseCreds.
export const looseCreds =
  <A extends unknown[]>(fn: (...args: A) => Promise<unknown>) =>
  async (...args: A): Promise<LooseCreds | null> => {
    const r = await fn(...args);
    return r == null ? null : (r as LooseCreds);
  };

// Deep-loose shape for assertion-heavy helper-output tests: strict union
// returns (tool_calls variants, ClaudeContentBlock, schemas) make every member
// access an error even though the test exercised exactly the branch it reads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- reason: deliberate deep-any assertion surface
export type LooseDeep = { [key: string]: any };

// Wrap an object of helper fns so each return value reads as LooseDeep.
export const wrapLoose = <T extends object>(mod: T) =>
  mod as unknown as {
    [K in keyof T]: T[K] extends (...args: infer A) => infer R
      ? (...args: A) => R extends Promise<unknown> ? Promise<LooseDeep> : LooseDeep
      : T[K];
  };

// Wrap a single async media/generation handler so its provider-union result
// reads as LooseDeep for assertion-heavy tests (same rationale as wrapLoose).
export const looseAsync =
  <A extends unknown[]>(fn: (...args: A) => Promise<unknown>) =>
  async (...args: A): Promise<LooseDeep> =>
    (await fn(...args)) as LooseDeep;

// Sync variant of looseAsync for helpers returning loose object shapes.
export const looseSync =
  <A extends unknown[]>(fn: (...args: A) => unknown) =>
  (...args: A): LooseDeep =>
    fn(...args) as LooseDeep;
