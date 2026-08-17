// @ts-nocheck
/**
 * Streaming vs non-streaming usage-accounting parity (WMM-481).
 *
 * A streamed request and its non-streamed equivalent must persist the SAME token
 * counts to `usage_history`, and the streamed response must carry the usage/cost
 * figures to the client somewhere.
 *
 * The zeroed `x-omniroute-tokens-*` / `x-omniroute-response-cost` RESPONSE HEADERS on the
 * streaming path are NOT an accounting bug and this test pins that distinction:
 * HTTP response headers are flushed before the first SSE byte, long before the
 * upstream reports usage in its terminal chunk, so they are necessarily zero at
 * that point (see `assembleStreamingResponseHeaders`, which passes
 * `usage: null, costUsd: 0` deliberately). The real figures reach the client via
 * the trailing `: x-omniroute-*` SSE metadata comment emitted before `data: [DONE]`,
 * and reach the database via `recordStreamingUsageStats` -> `saveRequestUsage`.
 *
 * Regression guard: if a future refactor drops usage off the stream-completion
 * callback, the DB rows below go to 0 while request counts keep incrementing —
 * the exact "blind counter" failure mode WMM-481 was opened to rule out.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-stream-usage-parity-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.ts");

const PROMPT_TOKENS = 1446;
const COMPLETION_TOKENS = 8;

const originalFetch = globalThis.fetch;

function noopLog() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

function buildUpstreamResponse(stream: boolean, text = "ping") {
  if (stream) {
    return new Response(
      `data: ${JSON.stringify({
        id: "chatcmpl-stream",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { role: "assistant", content: text } }],
      })}\n\ndata: ${JSON.stringify({
        id: "chatcmpl-stream",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: {
          prompt_tokens: PROMPT_TOKENS,
          completion_tokens: COMPLETION_TOKENS,
          total_tokens: PROMPT_TOKENS + COMPLETION_TOKENS,
        },
      })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  return new Response(
    JSON.stringify({
      id: "chatcmpl-json",
      object: "chat.completion",
      model: "gpt-4o-mini",
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: PROMPT_TOKENS,
        completion_tokens: COMPLETION_TOKENS,
        total_tokens: PROMPT_TOKENS + COMPLETION_TOKENS,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

async function invoke(stream: boolean) {
  globalThis.fetch = async (_url, init = {}) => {
    const headers = init.headers || {};
    const accept = String(headers.Accept || headers.accept || "").toLowerCase();
    return buildUpstreamResponse(accept.includes("text/event-stream"));
  };

  const body = {
    model: "gpt-4o-mini",
    stream,
    messages: [{ role: "user", content: "ping" }],
  };

  try {
    const result = await handleChatCore({
      body: structuredClone(body),
      modelInfo: { provider: "openai", model: "gpt-4o-mini", extendedContext: false },
      credentials: { apiKey: "sk-test", providerSpecificData: {} },
      log: noopLog(),
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        body: structuredClone(body),
        headers: new Headers({ accept: stream ? "text/event-stream" : "application/json" }),
      },
      connectionId: null,
      apiKeyInfo: { id: "parity-key", name: "parity" },
      userAgent: "unit-test",
      isCombo: false,
      comboStrategy: null,
    });
    return { result, text: await result.response.text() };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function waitForUsageRow(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  const db = core.getDbInstance();
  while (Date.now() < deadline) {
    const rows = db
      .prepare("SELECT tokens_input, tokens_output, success FROM usage_history")
      .all() as Array<{ tokens_input: number; tokens_output: number; success: number }>;
    if (rows.length > 0) return rows;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return [];
}

function resetDataDir() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.after(() => {
  globalThis.fetch = originalFetch;
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("streamed and non-streamed requests persist identical, non-zero token counts", async () => {
  resetDataDir();
  await invoke(false);
  const nonStreamRows = await waitForUsageRow();

  resetDataDir();
  const { text } = await invoke(true);
  const streamRows = await waitForUsageRow();

  assert.equal(nonStreamRows.length, 1, "non-streamed request must persist exactly one usage row");
  assert.equal(streamRows.length, 1, "streamed request must persist exactly one usage row");

  // The core WMM-481 assertion: streaming is not blind. A stream that persists
  // 0/0 while the request count increments is the reported failure mode.
  assert.equal(streamRows[0].tokens_input, PROMPT_TOKENS);
  assert.equal(streamRows[0].tokens_output, COMPLETION_TOKENS);
  assert.equal(streamRows[0].success, 1);

  assert.equal(streamRows[0].tokens_input, nonStreamRows[0].tokens_input);
  assert.equal(streamRows[0].tokens_output, nonStreamRows[0].tokens_output);

  // The client still receives the real figures on the stream — via the trailing
  // SSE metadata comment, which must land before the [DONE] terminator.
  const trailerTokensIn = /: x-omniroute-tokens-in=(\d+)/.exec(text)?.[1];
  const trailerTokensOut = /: x-omniroute-tokens-out=(\d+)/.exec(text)?.[1];
  assert.equal(trailerTokensIn, String(PROMPT_TOKENS));
  assert.equal(trailerTokensOut, String(COMPLETION_TOKENS));
  assert.ok(
    text.indexOf(": x-omniroute-tokens-in=") < text.indexOf("data: [DONE]"),
    "usage metadata must be flushed before the [DONE] terminator"
  );
});

test("zeroed streaming usage headers are a documented flush-order artifact, not lost data", async () => {
  resetDataDir();
  const { result, text } = await invoke(true);
  const rows = await waitForUsageRow();

  // Response headers go out before the upstream has reported any usage, so they
  // read zero by construction. Pinned so nobody "fixes" the DB write by chasing
  // these headers, and so a future move to real HTTP trailers is a conscious change.
  assert.equal(result.response.headers.get("x-omniroute-tokens-in"), "0");
  assert.equal(result.response.headers.get("x-omniroute-tokens-out"), "0");
  assert.equal(result.response.headers.get("x-omniroute-response-cost"), "0.0000000000");

  // ...while the same request's accounting is intact downstream.
  assert.equal(rows[0].tokens_input, PROMPT_TOKENS);
  assert.match(text, /: x-omniroute-response-cost=\d+\.\d{10}/);
});
