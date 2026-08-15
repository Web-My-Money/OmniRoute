import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-wmm367-auth-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "wmm367-secret";

const core = await import("../../src/lib/db/core.ts");
const settingsDb = await import("../../src/lib/db/settings.ts");
const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");
const v1ModelsCatalog = await import("../../src/app/api/v1/models/catalog.ts");

async function resetStorage() {
  core.resetDbInstance();
  apiKeysDb.resetApiKeyState();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  v1ModelsCatalog.__resetCatalogBuilderRunsForTest();
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(async () => {
  core.resetDbInstance();
  apiKeysDb.resetApiKeyState();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("WMM-367: GET /v1/models requires auth and rejects unauthenticated callers with 403", async () => {
  await settingsDb.updateSettings({
    requireLogin: true,
    password: "hashed-password",
  });

  // 1. Unauthenticated request without Authorization header -> 403
  const unauthRes = await v1ModelsCatalog.getUnifiedModelsResponse(
    new Request("http://localhost/api/v1/models")
  );
  assert.equal(unauthRes.status, 403);
  const unauthBody = (await unauthRes.json()) as any;
  assert.equal(unauthBody.error.code, "invalid_api_key");
  assert.match(unauthBody.error.message, /Authentication required/i);

  // 2. Request with invalid Bearer API key -> 403
  const invalidRes = await v1ModelsCatalog.getUnifiedModelsResponse(
    new Request("http://localhost/api/v1/models", {
      headers: { authorization: "Bearer invalid-api-key" },
    })
  );
  assert.equal(invalidRes.status, 403);
  const invalidBody = (await invalidRes.json()) as any;
  assert.equal(invalidBody.error.code, "invalid_api_key");
  assert.match(invalidBody.error.message, /Invalid API key/i);

  // 3. Request with valid Bearer API key -> 200 OK
  const createdKey = await apiKeysDb.createApiKey("valid-key", "test-machine");
  v1ModelsCatalog.__resetCatalogBuilderRunsForTest();

  const validRes = await v1ModelsCatalog.getUnifiedModelsResponse(
    new Request("http://localhost/api/v1/models", {
      headers: { authorization: `Bearer ${createdKey.key}` },
    })
  );
  assert.equal(validRes.status, 200);
  const validBody = (await validRes.json()) as any;
  assert.equal(validBody.object, "list");
  assert.ok(Array.isArray(validBody.data));
});
