/**
 * @file alibaba-free-tier-allowlist.test.ts
 * @description Tests for built-in Alibaba free-tier text model allowlists.
 *
 * @changes
 * - [2026-07-25] [Composer] - Add built-in allowlist regression tests
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALIBABA_FREE_TIER_TEXT_CAPABLE_MODELS,
  ALIBABA_NO_FREE_TIER_TEXT_MODELS,
  isAlibabaBuiltinFreeTierTextModel,
  isAlibabaBuiltinNoFreeTierTextModel,
  isAlibabaFreeTierAllowlistPackValid,
  loadAlibabaFreeTierAllowlistPack,
  resetAlibabaFreeTierAllowlistCache,
} from "../../open-sse/services/alibabaFreeTierAllowlist.ts";

test("built-in allowlist includes operator free models and excludes paid blocklist", () => {
  assert.ok(ALIBABA_FREE_TIER_TEXT_CAPABLE_MODELS.includes("qwen3.6-plus"));
  assert.ok(ALIBABA_FREE_TIER_TEXT_CAPABLE_MODELS.includes("glm-5.2"));
  assert.ok(ALIBABA_NO_FREE_TIER_TEXT_MODELS.includes("qwen3.7-max"));
  assert.ok(ALIBABA_NO_FREE_TIER_TEXT_MODELS.includes("glm-5.2-fast-preview"));
  assert.equal(isAlibabaBuiltinFreeTierTextModel("qwen3.6-plus"), true);
  assert.equal(isAlibabaBuiltinNoFreeTierTextModel("kimi-k2.7-code"), true);
  assert.equal(isAlibabaBuiltinFreeTierTextModel("qwen3.7-max"), false);
});

test("allowlist JSON pack overrides embedded lists when valid", () => {
  // Hermetic: the shipped config pack has a real `validUntil` that expires
  // (data-freshness semantics are the point of the field), so the test writes
  // its own pack instead of depending on shipped data staying fresh forever.
  const dir = mkdtempSync(join(tmpdir(), "alibaba-allowlist-"));
  const packPath = join(dir, "pack.json");
  writeFileSync(
    packPath,
    JSON.stringify({
      asOf: "2099-01-01",
      validUntil: "2099-12-31",
      capable: ["qwen3.6-plus", "test-only-capable"],
      noFreeTier: ["test-only-paid"],
    })
  );
  const previousPath = process.env.ALIBABA_FREE_TIER_ALLOWLIST_PATH;
  try {
    process.env.ALIBABA_FREE_TIER_ALLOWLIST_PATH = packPath;
    resetAlibabaFreeTierAllowlistCache();

    const pack = loadAlibabaFreeTierAllowlistPack();
    assert.ok(pack);
    assert.ok(isAlibabaFreeTierAllowlistPackValid(pack!));
    assert.ok(pack!.capable.includes("test-only-capable"));
    assert.ok(pack!.noFreeTier.includes("test-only-paid"));
  } finally {
    if (previousPath) process.env.ALIBABA_FREE_TIER_ALLOWLIST_PATH = previousPath;
    else delete process.env.ALIBABA_FREE_TIER_ALLOWLIST_PATH;
    resetAlibabaFreeTierAllowlistCache();
    rmSync(dir, { recursive: true, force: true });
  }
});
