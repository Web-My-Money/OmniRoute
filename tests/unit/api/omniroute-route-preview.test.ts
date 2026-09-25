/**
 * POST /api/omniroute/route/preview — regression: the handler must pass
 * `parsed.data.candidates` (the array) to `rankCandidates`, not the wrapper
 * `parsed.data` object — a past drift crashed the route with a 500 on every call.
 * Run: node --import tsx/esm --test tests/unit/api/omniroute-route-preview.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-route-preview-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../../src/lib/db/core.ts");
const routeModule = await import("../../../src/app/api/omniroute/route/preview/route.ts");

const CANDIDATE = {
  providerId: "openai",
  modelId: "gpt-4o",
  capabilityScore: 0.9,
  allocation: "allow" as const,
  healthScore: 1,
  circuit: "closed" as const,
  quota: "healthy" as const,
};

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/omniroute/route/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test.beforeEach(() => {
  core.resetDbInstance();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("preview POST returns 200 with a ranked candidates array (not a 500)", async () => {
  const res = await routeModule.POST(makeRequest({ candidates: [CANDIDATE] }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.liveRequestExecuted, false);
  assert.equal(body.request.candidateCount, 1);
  assert.ok(Array.isArray(body.candidates), "response must carry the ranked candidate list");
  assert.equal(body.candidates.length, 1);
  assert.equal(body.selected, "openai");
});

test("preview POST ranks multiple candidates deterministically", async () => {
  const candidates = [
    CANDIDATE,
    { ...CANDIDATE, providerId: "anthropic", modelId: "claude-x", healthScore: 0.1 },
  ];
  const res = await routeModule.POST(makeRequest({ candidates }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.candidates.length, 2);
  assert.equal(body.selected, "openai");
});

test("preview POST 400s on a malformed body (no 500)", async () => {
  const res = await routeModule.POST(makeRequest({ candidates: "not-an-array" }));
  assert.equal(res.status, 400);
});

test("preview POST 400s on an empty candidates list", async () => {
  const res = await routeModule.POST(makeRequest({ candidates: [] }));
  assert.equal(res.status, 400);
});
