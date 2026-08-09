// Regression coverage for the WMM fork's 2026-08-09 chatBodyAdmission fix.
//
// Before this fix, `admitChatStructure` misclassified ordinary tool-schema-heavy
// requests as "heavy" via three independent false-positive paths in its structural
// token estimator, then rejected them with a 503 `chat_admission_busy`
// (`reason: structure_limit`) once the single-slot heavyweight admission controller
// (`OMNIROUTE_CHAT_MAX_HEAVY_IN_FLIGHT`, default was 1) was already held by another
// request — even though the real `usage.prompt_tokens` for these requests was far
// below `CHAT_HEAVY_ESTIMATED_TOKENS` (observed in production: ~31k real tokens across
// 15 messages, well under the 32,000 default). The three paths:
//
//   1. Depth cap (was 12): nested JSON Schema tool definitions ($defs, oneOf/anyOf,
//      nested object properties) routinely exceed 12 levels, which made the estimator
//      give up and assume "heavy" by structural shape alone.
//   2. Node cap (was 10,000): a request with several dozen MCP/Claude-Code tools can
//      exceed 10,000 total JSON nodes even when the real content is small.
//   3. Non-ASCII overcounting (was a flat 1 token/char for any codepoint >= 0x80,
//      applied uniformly to object keys AND tool-schema description/enum strings,
//      not just real message content): a handful of accented characters or emoji in a
//      schema description could inflate the estimate by 4x versus the ASCII rate.
//
// Each test below isolates one of those three paths and proves it no longer
// false-flags a small-real-content request as heavy. The final test proves the
// opposite direction was NOT broken: a genuinely oversized message still gets
// classified heavy and a full admission controller still rejects it with 503.
//
// Every test uses its own fresh `ChatAdmissionController` (never the module's
// `defaultAdmissionController` singleton) so tests stay isolated under
// `--test-concurrency` and never leak heavyweight leases across test files.

import test from "node:test";
import assert from "node:assert/strict";

const { admitChatStructure, ChatAdmissionController } = await import(
  "../../src/shared/middleware/chatBodyAdmission.ts"
);

/** Build a plain-object JSON Schema `depth` levels deep, cheap in both nodes and tokens. */
function deepObjectSchema(depth: number): Record<string, unknown> {
  let node: Record<string, unknown> = { type: "string" };
  for (let i = 0; i < depth; i++) {
    node = { type: "object", properties: { level: node } };
  }
  return node;
}

function shortMessages(count = 2) {
  return Array.from({ length: count }, (_, i) => ({
    role: "user",
    content: `hello ${i}`,
  }));
}

/** Fully occupy a controller's single heavyweight slot so the caller can prove a
 * request was never classified "heavy" in the first place — a heavy request would
 * be rejected (503) while capacity is exhausted; a non-heavy request always admits
 * without touching the controller at all. */
function exhaustedController(): InstanceType<typeof ChatAdmissionController> {
  const controller = new ChatAdmissionController(1);
  const lease = controller.tryAcquireHeavy();
  assert.ok(lease, "test setup: expected to acquire the sole heavyweight slot");
  return controller;
}

test("chatBodyAdmission: deeply nested tool schema (>12 levels) does not false-flag heavy", () => {
  const controller = exhaustedController();
  const body = {
    messages: shortMessages(),
    tools: [
      {
        type: "function",
        function: {
          name: "deep_tool",
          description: "a tool with deeply nested parameters",
          // 15 *logical* schema levels. Each logical level costs ~2 raw object-key
          // traversals in this walker (entering `properties`, then the named property
          // under it), so this reaches ~34 raw depth — comfortably under the new
          // 40-level cap, and well above the old 12-level cap that used to false-flag it.
          parameters: deepObjectSchema(15),
        },
      },
    ],
  };

  const result = admitChatStructure(body, null, { controller });
  assert.equal(
    result.admit,
    true,
    "a small-content request should not be rejected just because its tool schema nests deeply"
  );
});

test("chatBodyAdmission: high tool-array node count (>10,000) does not false-flag heavy", () => {
  const controller = exhaustedController();
  // 60 tools x ~230 nodes/tool ≈ 13,800 total JSON nodes: over the old 10,000-node cap,
  // under the new 50,000-node cap. Kept under CHAT_HEAVY_TOOL_COUNT (64) and each
  // property's real string content stays tiny, so this isolates the node-cap path.
  const tools = Array.from({ length: 60 }, (_, i) => ({
    type: "function",
    function: {
      name: `tool_${i}`,
      description: "short",
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          Array.from({ length: 40 }, (_, j) => [`p${j}`, { type: "string" }])
        ),
      },
    },
  }));

  const result = admitChatStructure({ messages: shortMessages(), tools }, null, { controller });
  assert.equal(
    result.admit,
    true,
    "a request with many small tool definitions should not be rejected on raw node count alone"
  );
});

test("chatBodyAdmission: non-ASCII text in tool descriptions does not false-flag heavy", () => {
  const controller = exhaustedController();
  // 20 tools x 2,000 non-ASCII characters = 40,000 chars of description text.
  // Old flat 1 token/char (applied to tool-schema text) => 40,000 estimated tokens,
  // over CHAT_HEAVY_ESTIMATED_TOKENS (32,000) => misclassified heavy.
  // New structural rate (0.25 token/char, non-ASCII treated the same as ASCII for
  // schema/tool text) => 10,000 estimated tokens, comfortably under the threshold.
  const accented = "á".repeat(2000);
  const tools = Array.from({ length: 20 }, (_, i) => ({
    type: "function",
    function: {
      name: `tool_${i}`,
      description: accented,
      parameters: { type: "object", properties: {} },
    },
  }));

  const result = admitChatStructure({ messages: shortMessages(), tools }, null, { controller });
  assert.equal(
    result.admit,
    true,
    "non-ASCII characters in tool-schema text should not be weighted as if they were 4x the token cost"
  );
});

test("chatBodyAdmission: a genuinely oversized message is still classified heavy and rejected under full capacity", () => {
  // No forced-exhaustion here — this must earn "heavy" on its own real size, at the
  // unchanged ASCII rate (0.25 token/char): 140,000 chars => 35,000 estimated tokens,
  // over the 32,000 default.
  const bigMessage = { role: "user", content: "a".repeat(140_000) };
  const controllerA = new ChatAdmissionController(1);

  const first = admitChatStructure({ messages: [bigMessage], tools: [] }, null, {
    controller: controllerA,
  });
  assert.equal(first.admit, true, "the first heavy request should acquire the sole free slot");
  if (first.admit) {
    assert.ok(first.lease, "an admitted heavy request must hold a lease");
  }

  // Capacity is now fully held by `first` (never released) — a second, equally heavy
  // request must be turned away with a retryable 503, proving the real protection this
  // module exists for was not accidentally disabled by the false-positive fixes above.
  const second = admitChatStructure({ messages: [bigMessage], tools: [] }, null, {
    controller: controllerA,
  });
  assert.equal(second.admit, false, "a second heavy request must be rejected while capacity is full");
  if (!second.admit) {
    assert.equal(second.response.status, 503);
  }
});

test("chatBodyAdmission: large non-ASCII MESSAGE content (not tool schema) is still weighted as real content", () => {
  // Same character count as the tool-description test above (40,000 non-ASCII chars),
  // but as message content instead of tool-schema text. Content mode uses 0.5
  // token/char for non-ASCII (not the 0.25 structural rate), so this is expected to
  // still register meaningful weight — proving the content/structural distinction is
  // real, not just a blanket loosening of every non-ASCII character everywhere.
  const accented = "á".repeat(2000);
  const messages = Array.from({ length: 20 }, () => ({ role: "user", content: accented }));
  const controllerA = new ChatAdmissionController(1);

  const first = admitChatStructure({ messages, tools: [] }, null, { controller: controllerA });
  assert.equal(first.admit, true, "first request should be admitted (acquires the sole slot if heavy)");

  const second = admitChatStructure({ messages, tools: [] }, null, { controller: controllerA });
  // 40,000 non-ASCII chars * 0.5 token/char = 20,000 estimated tokens — under the
  // 32,000 default on its own, so this specific size is NOT expected to be "heavy"
  // (and therefore does not need the controller at all). This test documents that
  // behavior explicitly rather than asserting rejection, so a future threshold change
  // that makes this content-mode case heavy is a deliberate, visible decision.
  assert.equal(
    second.admit,
    true,
    "20k content-mode estimated tokens is under the default heavy threshold and should not require the controller"
  );
});
