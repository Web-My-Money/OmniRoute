import test from "node:test";
import assert from "node:assert/strict";
import {
  MODEL_SPECS,
  normalizeThinkingForModel,
  getModelSpec,
  getCanonicalModelSpecId,
} from "../../src/shared/constants/modelSpecs.ts";
import {
  normalizeClaudeAdaptiveThinking,
  normalizeClaudeDisabledThinkingEffort,
} from "../../open-sse/services/claudeAdaptiveThinking.ts";

// Claude Opus 5.5 rejects `thinking.type:"disabled"` with an upstream 400:
//   "thinking.type.disabled" is not supported for this model. Use "adaptive"
// The gateway-wide thinking budget (mode "custom", budget 0) and Claude Code's internal
// calls both emit `disabled`. Before this fix there was no spec for the id:
// "claude-opus-5-5" prefix-matched "claude-opus-5", which accepts `disabled`, so nothing
// rewrote the value. Only an explicit `disabled` may be touched: a plain request already
// answers 200 and must stay byte-for-byte unchanged.

test("claude-opus-5-5 has its own spec (not the claude-opus-5 prefix match)", () => {
  assert.equal(getCanonicalModelSpecId("claude-opus-5-5"), "claude-opus-5-5");
  assert.equal(getModelSpec("claude-opus-5-5")?.thinkingDisabledAs, "adaptive");
  assert.equal(getCanonicalModelSpecId("claude-opus-5"), "claude-opus-5");
  assert.equal(getModelSpec("claude-opus-5")?.thinkingDisabledAs, undefined);
});

test("opus-5-5 is declared before opus-5 (prefix matching is first-match-wins)", () => {
  const keys = Object.keys(MODEL_SPECS);
  assert.ok(keys.indexOf("claude-opus-5-5") >= 0);
  assert.ok(keys.indexOf("claude-opus-5-5") < keys.indexOf("claude-opus-5"));
});

test("dated / suffixed / Bedrock opus-5-5 ids resolve to the opus-5-5 spec, not opus-5", () => {
  for (const id of [
    "claude-opus-5-5-20261001",
    "CLAUDE-OPUS-5-5-20261001",
    "us.anthropic.claude-opus-5-5",
    "bedrock/eu.anthropic.claude-opus-5-5",
  ]) {
    assert.equal(getCanonicalModelSpecId(id), "claude-opus-5-5", id);
    assert.equal(getModelSpec(id)?.thinkingDisabledAs, "adaptive", id);
  }
});

test("opus-5 itself and dated opus-5 ids still resolve to opus-5", () => {
  for (const id of ["claude-opus-5", "claude-opus-5-20260601", "us.anthropic.claude-opus-5"]) {
    assert.equal(getCanonicalModelSpecId(id), "claude-opus-5", id);
  }
});

test("opus-5-5 keeps every limit it inherited before it had a spec", () => {
  const five = getModelSpec("claude-opus-5");
  const fiveFive = getModelSpec("claude-opus-5-5");
  assert.ok(five && fiveFive);
  // Upstream v3.8.53 gave 5.5 its own flags (rejectsThinkingDisabled, rejectsForcedToolChoice,
  // defaultReasoningEffort); compare only the limits it inherited.
  const limits = ({ maxOutputTokens, contextWindow, defaultThinkingBudget, thinkingBudgetCap, supportsThinking, supportsTools, supportsVision, adaptiveThinkingOnly }: Record<string, unknown>) => ({ maxOutputTokens, contextWindow, defaultThinkingBudget, thinkingBudgetCap, supportsThinking, supportsTools, supportsVision, adaptiveThinkingOnly });
  const fiveRest = limits(five as Record<string, unknown>);
  const fiveFiveRest = limits(fiveFive as Record<string, unknown>);
  assert.deepEqual(fiveFiveRest, fiveRest);
  assert.equal(fiveFive.maxOutputTokens, 128000);
  assert.equal(fiveFive.contextWindow, 1000000);
});

test("disabled thinking is rewritten to adaptive for opus-5-5 (budget field dropped)", () => {
  const body = {
    model: "claude-opus-5-5",
    max_tokens: 16,
    messages: [{ role: "user", content: "hi" }],
    output_config: { effort: "low" },
    thinking: { type: "disabled", budget_tokens: 0 },
  };
  const snapshot = JSON.parse(JSON.stringify(body));
  const out = normalizeThinkingForModel(body, "claude-opus-5-5");
  assert.deepEqual(out.thinking, { type: "adaptive" });
  // Other fields untouched (same values; output_config keeps its effort).
  assert.equal(out.model, body.model);
  assert.equal(out.max_tokens, 16);
  assert.deepEqual(out.messages, body.messages);
  assert.deepEqual(out.output_config, { effort: "low" });
  assert.deepEqual(Object.keys(out).sort(), Object.keys(body).sort());
  // Input not mutated.
  assert.deepEqual(body, snapshot);
  assert.notEqual(out, body);
});

test("bare disabled (no budget) and dated ids are rewritten too; no output_config is invented", () => {
  const out = normalizeThinkingForModel(
    { model: "claude-opus-5-5-20261001", thinking: { type: "disabled" } },
    "claude-opus-5-5-20261001"
  );
  assert.deepEqual(out.thinking, { type: "adaptive" });
  assert.equal("output_config" in out, false);
});

test("the rewrite survives the guards that run right after it in chatCore", () => {
  const body = {
    thinking: { type: "disabled", budget_tokens: 0 },
    output_config: { effort: "max" },
  };
  let out = normalizeThinkingForModel(body, "claude-opus-5-5");
  out = normalizeClaudeAdaptiveThinking(out, "claude-opus-5-5");
  out = normalizeClaudeDisabledThinkingEffort(out, "claude-opus-5-5", "anthropic");
  assert.deepEqual(out.thinking, { type: "adaptive" });
  // No longer `disabled`, so the Opus 5 "max effort while disabled" cap must not fire.
  assert.deepEqual(out.output_config, { effort: "max" });
});

test("adaptive / enabled / between_tools thinking is not rewritten by normalizeThinkingForModel", () => {
  for (const thinking of [
    { type: "adaptive" },
    { type: "between_tools" },
    { type: "enabled", budget_tokens: 4000 },
  ]) {
    const body = { thinking };
    assert.equal(normalizeThinkingForModel(body, "claude-opus-5-5"), body);
  }
});

test("a body without thinking is returned untouched for opus-5-5 (same reference)", () => {
  const body = { model: "claude-opus-5-5", messages: [] };
  assert.equal(normalizeThinkingForModel(body, "claude-opus-5-5"), body);
});

test("models without the flag keep `disabled` (opus-5, opus-4-8, sonnet-5, sonnet-4-6)", () => {
  for (const m of ["claude-opus-5", "claude-opus-4-8", "claude-sonnet-5", "claude-sonnet-4-6"]) {
    const body = { thinking: { type: "disabled" } };
    const out = normalizeThinkingForModel(body, m);
    assert.equal(out, body, `same reference for ${m}`);
    assert.deepEqual(out.thinking, { type: "disabled" }, `disabled preserved for ${m}`);
  }
});

test("sonnet-5-5 (#41) is unchanged: disabled -> between_tools", () => {
  assert.equal(getModelSpec("claude-sonnet-5-5")?.thinkingDisabledAs, "between_tools");
  const out = normalizeThinkingForModel(
    { max_tokens: 16, thinking: { type: "disabled", budget_tokens: 0 } },
    "claude-sonnet-5-5"
  );
  assert.deepEqual(out.thinking, { type: "between_tools" });
  assert.equal(out.max_tokens, 16);
});

test("fable-5 behaviour from #3554 is unchanged: disabled is dropped, not rewritten", () => {
  const out = normalizeThinkingForModel({ thinking: { type: "disabled" } }, "claude-fable-5");
  assert.equal("thinking" in out, false);
});
