import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// WMM fork regression (2026-11-07 02:03Z): a 502 on a codex connection set a 5 s connection
// cooldown, the 60 s ConnectionRecovery job cleared it through clearAccountError(), and the
// unconditional nested-cooldown strip removed the multi-hour quota_reset scope cooldown with it,
// so ~95 requests burned 429s against a provably exhausted account.

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-codex-scope-survive-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET ||= "codex-scope-survive-test-secret";

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const accountState = await import("../../src/lib/db/providers/codexAccountState.ts");
const auth = await import("../../src/sse/services/auth.ts");
const codexAccount = await import("../../open-sse/services/codexAccount/index.ts");

async function resetStorage(): Promise<void> {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(resetStorage);

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

async function seedCodex(providerSpecificData: Record<string, unknown>) {
  return providersDb.createProviderConnection({
    provider: "codex",
    authType: "oauth",
    name: "codex-scope-survive",
    email: "codex-scope-survive@example.com",
    accessToken: "codex-scope-survive-access",
    refreshToken: "codex-scope-survive-refresh",
    isActive: true,
    testStatus: "active",
    providerSpecificData,
  }) as unknown as Promise<{ id: string }>;
}

async function read(id: string) {
  const connection = (await providersDb.getProviderConnectionById(id)) as unknown as Record<
    string,
    unknown
  >;
  assert.ok(connection);
  return connection;
}

const psdOf = (connection: Record<string, unknown>) =>
  (connection.providerSpecificData ?? {}) as Record<string, unknown>;

test("an active quota_reset scope cooldown survives a connection-cooldown recovery", async () => {
  const quotaUntil = iso(3 * 60 * 60_000);
  const connection = await seedCodex({
    codexScopeRateLimitedUntil: { codex: quotaUntil },
    codexScopeRateLimitSource: { codex: "quota_reset" },
    unrelated: { retained: true },
  });

  // The 502: markAccountUnavailable leaves a short connection cooldown behind.
  await providersDb.updateProviderConnection(connection.id, {
    testStatus: "unavailable",
    lastError: "ECONNREFUSED",
    lastErrorType: "server_error",
    errorCode: 502,
    rateLimitedUntil: iso(5_000),
  });
  const cooling = await read(connection.id);

  // The recovery tick (and every successful request) clears it through clearAccountError().
  await auth.clearAccountError(connection.id, cooling as never);

  const after = await read(connection.id);
  const data = psdOf(after);
  assert.equal(after.testStatus, "active");
  assert.equal(after.rateLimitedUntil, undefined);
  assert.deepEqual(data.codexScopeRateLimitedUntil, { codex: quotaUntil });
  assert.deepEqual(data.codexScopeRateLimitSource, { codex: "quota_reset" });
  assert.deepEqual(data.unrelated, { retained: true });
  assert.equal(codexAccount.isCodexChildUnavailable(after as never, "gpt-5.5"), true);
  assert.equal(codexAccount.getCodexChildCooldown(after as never, "gpt-5.5"), quotaUntil);
});

test("recovery drops an expired scope entry and keeps the live one", async () => {
  const liveUntil = iso(90 * 60_000);
  const connection = await seedCodex({
    codexScopeRateLimitedUntil: { codex: iso(-60_000), spark: liveUntil },
    codexScopeRateLimitSource: { codex: "quota_reset", spark: "fallback" },
  });
  await providersDb.updateProviderConnection(connection.id, {
    testStatus: "unavailable",
    rateLimitedUntil: iso(-1_000),
  });

  await auth.clearAccountError(connection.id, (await read(connection.id)) as never);

  const data = psdOf(await read(connection.id));
  assert.deepEqual(data.codexScopeRateLimitedUntil, { spark: liveUntil });
  assert.deepEqual(data.codexScopeRateLimitSource, { spark: "fallback" });
});

test("recovery removes the nested maps when every scope entry has expired", async () => {
  const connection = await seedCodex({
    codexScopeRateLimitedUntil: { codex: iso(-120_000), spark: iso(-30_000) },
    codexScopeRateLimitSource: { codex: "quota_reset", spark: "fallback" },
    unrelated: { retained: true },
  });
  await providersDb.updateProviderConnection(connection.id, { rateLimitedUntil: null });

  const after = await read(connection.id);
  const data = psdOf(after);
  assert.equal(data.codexScopeRateLimitedUntil, undefined);
  assert.equal(data.codexScopeRateLimitSource, undefined);
  assert.deepEqual(data.unrelated, { retained: true });
  assert.equal(codexAccount.isCodexChildUnavailable(after as never, "gpt-5.5"), false);
});

test("stripExpiredCodexChildCooldownFields treats unparseable deadlines as expired", () => {
  const live = iso(60_000);
  const next = accountState.stripExpiredCodexChildCooldownFields({
    codexScopeRateLimitedUntil: { codex: "not-a-date", spark: live },
    codexScopeRateLimitSource: { codex: "fallback", spark: "quota_reset", orphan: "fallback" },
  });
  assert.deepEqual(next.codexScopeRateLimitedUntil, { spark: live });
  assert.deepEqual(next.codexScopeRateLimitSource, { spark: "quota_reset" });
  // Nothing to strip: the very same object comes back.
  const untouched = { unrelated: 1 };
  assert.equal(accountState.stripExpiredCodexChildCooldownFields(untouched), untouched);
});

test("getCodexChildCooldown returns only an ACTIVE cooldown", async () => {
  const live = iso(60_000);
  const stale = iso(-60_000);
  const liveConn = await seedCodex({ codexScopeRateLimitedUntil: { codex: live } });
  const staleConn = await seedCodex({ codexScopeRateLimitedUntil: { codex: stale } });
  assert.equal(
    codexAccount.getCodexChildCooldown((await read(liveConn.id)) as never, "gpt-5.5"),
    live
  );
  assert.equal(
    codexAccount.getCodexChildCooldown((await read(staleConn.id)) as never, "gpt-5.5"),
    null
  );
});

test("a fresh 429 over a stale scope entry persists a real cooldown, not a zero-length one", async () => {
  const stale = iso(-10 * 60_000);
  const connection = await seedCodex({ codexScopeRateLimitedUntil: { codex: stale } });

  const result = await auth.markAccountUnavailable(
    connection.id,
    429,
    "usage limit reached",
    "codex",
    "gpt-5.5"
  );

  assert.equal(result.shouldFallback, true);
  assert.ok(result.cooldownMs > 0, "the 429 must get a cooldown");
  const until = (psdOf(await read(connection.id)).codexScopeRateLimitedUntil ?? {}) as Record<
    string,
    string
  >;
  assert.ok(
    Date.parse(until.codex) > Date.now(),
    "the persisted scope cooldown must be in the future"
  );
});
