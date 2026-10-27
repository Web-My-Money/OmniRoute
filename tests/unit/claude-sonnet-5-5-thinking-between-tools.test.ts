import test from "node:test";
import assert from "node:assert/strict";
import { normalizeThinkingForModel, getModelSpec } from "../../src/shared/constants/modelSpecs.ts";
import { normalizeClaudeAdaptiveThinking } from "../../open-sse/services/claudeAdaptiveThinking.ts";

// Claude Sonnet 5.5 rejects `thinking.type:"disabled"` with an upstream 400:
//   To turn thinking off on this model, send "thinking": {"type": "between_tools"}
//   instead of {"type": "disabled"}.
// The gateway-wide thinking budget (mode "custom", budget 0) and Claude Code's internal
// calls both emit `disabled`, so every request to the model failed. Before the fix there was
// no spec for the id: "claude-sonnet-5-5" prefix-matched "claude-sonnet-5", which accepts
// `disabled`, so nothing rewrote the value.

test("claude-sonnet-5-5 has its own spec (not the claude-sonnet-5 prefix match)", () => {
  assert.equal(getModelSpec("claude-sonnet-5-5")?.thinkingDisabledAs, "between_tools");
  assert.equal(getModelSpec("claude-sonnet-5")?.thinkingDisabledAs, undefined);
});

test("dated / suffixed sonnet-5-5 ids resolve to the sonnet-5-5 spec, not sonnet-5", () => {
  assert.equal(getModelSpec("claude-sonnet-5-5-20261001")?.thinkingDisabledAs, "between_tools");
});

test("sonnet-5-5 keeps the context/output limits it inherited before it had a spec", () => {
  const five = getModelSpec("claude-sonnet-5");
  const fiveFive = getModelSpec("claude-sonnet-5-5");
  assert.equal(fiveFive?.contextWindow, five?.contextWindow);
  assert.equal(fiveFive?.maxOutputTokens, five?.maxOutputTokens);
  assert.equal(fiveFive?.adaptiveThinkingOnly, five?.adaptiveThinkingOnly);
});

test("disabled thinking is rewritten to between_tools for sonnet-5-5 (budget field dropped)", () => {
  const body = {
    model: "claude-sonnet-5-5",
    max_tokens: 16,
    thinking: { type: "disabled", budget_tokens: 0 },
  };
  const out = normalizeThinkingForModel(body, "claude-sonnet-5-5");
  assert.deepEqual(out.thinking, { type: "between_tools" });
  assert.equal(out.max_tokens, 16, "other fields untouched");
  assert.deepEqual(body.thinking, { type: "disabled", budget_tokens: 0 }, "input not mutated");
});

test("the rewrite survives the adaptive-thinking guard that runs right after it", () => {
  const body = { thinking: { type: "disabled", budget_tokens: 0 } };
  const out = normalizeClaudeAdaptiveThinking(
    normalizeThinkingForModel(body, "claude-sonnet-5-5"),
    "claude-sonnet-5-5"
  );
  assert.deepEqual(out.thinking, { type: "between_tools" });
});

test("enabled / adaptive / between_tools thinking is preserved for sonnet-5-5", () => {
  for (const thinking of [{ type: "adaptive" }, { type: "between_tools" }]) {
    const out = normalizeThinkingForModel({ thinking }, "claude-sonnet-5-5");
    assert.deepEqual(out.thinking, thinking);
  }
  const enabled = normalizeThinkingForModel(
    { thinking: { type: "enabled", budget_tokens: 4000 } },
    "claude-sonnet-5-5"
  );
  assert.deepEqual(enabled.thinking, { type: "enabled", budget_tokens: 4000 });
});

test("a body without thinking is returned untouched for sonnet-5-5", () => {
  const body = { model: "claude-sonnet-5-5", messages: [] };
  assert.equal(normalizeThinkingForModel(body, "claude-sonnet-5-5"), body);
});

test("models that accept disabled still keep it (sonnet-5, sonnet-4-6, opus-4-8)", () => {
  for (const m of ["claude-sonnet-5", "claude-sonnet-4-6", "claude-opus-4-8"]) {
    const out = normalizeThinkingForModel({ thinking: { type: "disabled" } }, m);
    assert.deepEqual(out.thinking, { type: "disabled" }, `disabled preserved for ${m}`);
  }
});

test("fable-5 behaviour from #3554 is unchanged: disabled is dropped, not rewritten", () => {
  const out = normalizeThinkingForModel({ thinking: { type: "disabled" } }, "claude-fable-5");
  assert.equal("thinking" in out, false);
});
