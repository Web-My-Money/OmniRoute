export interface TokenEstimate {
  tokens: number;
  exhausted: boolean;
}

// Structural JSON limits, raised for tool-schema-heavy requests (WMM fork, 2026-08-09).
// The prior depth 12 / 10,000-node caps were reached — and the estimate defaulted to
// "exhausted -> heavy" — by ordinary nested JSON Schema tool definitions ($defs,
// oneOf/anyOf, nested object properties are routinely >12 levels deep, and a request
// with dozens of MCP/Claude-Code tools can exceed 10,000 total JSON nodes) well before
// the request was actually anywhere near CHAT_HEAVY_ESTIMATED_TOKENS. That produced
// chat_admission_busy/structure_limit 503s on requests with real usage.prompt_tokens far
// below the heavy threshold (e.g. ~31k tokens across 15 messages, observed in production).
// 40/50,000 gives real tool-schema-heavy payloads room to be measured on their actual
// token weight instead of being auto-flagged heavy by structural shape alone; the walk is
// still bounded by `limit` (CHAT_HEAVY_ESTIMATED_TOKENS) so a truly oversized body still
// exits early via the token check, not the node/depth counters. 40 (not a smaller "20ish")
// because each logical JSON-Schema nesting level costs ~2 raw object-key traversals here
// (one to enter a `properties` object, one more to enter the named property under it —
// e.g. `properties.someParam.properties.nestedParam...`), so a schema that is genuinely
// only ~15-18 "levels" deep by a human's count already reaches raw depth 31-37;
// empirically verified against tests/unit/chat-admission-structure-false-positives.test.ts.
const STRUCTURE_MAX_DEPTH = 40;
const STRUCTURE_MAX_NODES = 50_000;

/**
 * `mode: "content"` is for the `messages` array: non-ASCII text there (accented
 * characters, emoji, non-English languages, the injected Output Styles persona) is
 * genuine user-facing content, so it gets a realistic-but-still-conservative 0.5
 * tokens/char weight instead of the old flat 1/char.
 *
 * `mode: "structural"` is for the `tools` array and for every object KEY regardless of
 * mode: JSON Schema description/enum strings and property names are technical
 * definitions, not user content. Treating them at the harsh non-ASCII rate is what
 * actually caused legitimate tool-schema-heavy requests to misclassify as heavy — a
 * handful of non-ASCII characters in a schema description or enum value should not cost
 * 4x an equivalent ASCII string. Structural strings use the same 0.25 tokens/char as
 * ASCII regardless of character set.
 */
export function estimateStructureTokens(
  value: unknown,
  limit: number,
  mode: "content" | "structural" = "structural"
): TokenEstimate {
  const valueNonAsciiMultiplier = mode === "content" ? 0.5 : 0.25;
  let tokens = 0;
  let visited = 0;
  const maxNodes = STRUCTURE_MAX_NODES;
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (stack.length > 0 && tokens < limit && visited < maxNodes) {
    const current = stack.pop();
    if (!current) break;
    visited += 1;
    if (typeof current.value === "string") {
      tokens += conservativeStringTokens(current.value, limit - tokens, valueNonAsciiMultiplier);
      continue;
    }
    if (!current.value || typeof current.value !== "object") continue;
    if (current.depth >= STRUCTURE_MAX_DEPTH) return { tokens, exhausted: true };

    const remainingNodes = maxNodes - visited - stack.length;
    if (Array.isArray(current.value)) {
      if (current.value.length > remainingNodes) return { tokens, exhausted: true };
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: current.value[index], depth: current.depth + 1 });
      }
      continue;
    }

    let children = 0;
    for (const key in current.value) {
      if (!Object.hasOwn(current.value, key)) continue;
      children += 1;
      if (children > remainingNodes) return { tokens, exhausted: true };
      // Object keys are always structural identifiers, regardless of mode.
      tokens += conservativeStringTokens(key, limit - tokens, 0.25);
      if (tokens >= limit) return { tokens: limit, exhausted: false };
      stack.push({
        value: (current.value as Record<string, unknown>)[key],
        depth: current.depth + 1,
      });
    }
  }
  return { tokens, exhausted: stack.length > 0 && tokens < limit };
}

function conservativeStringTokens(
  value: string,
  remaining: number,
  nonAsciiMultiplier: number
): number {
  let tokens = 0;
  for (const character of value) {
    tokens += character.codePointAt(0)! < 0x80 ? 0.25 : nonAsciiMultiplier;
    if (tokens >= remaining) return remaining;
  }
  return tokens;
}
