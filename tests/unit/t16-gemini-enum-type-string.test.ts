import test from "node:test";
import assert from "node:assert/strict";
import type { LooseDeep } from "../helpers/looseTypes.ts";

const { cleanJSONSchemaForAntigravity } =
  await import("../../open-sse/translator/helpers/geminiHelper.ts");

test("T16: enum-only fields gain type:string after Gemini schema cleanup", () => {
  const schema = {
    type: "object",
    properties: {
      mode: {
        enum: ["fast", "balanced", "slow"],
      },
    },
    required: ["mode"],
  };

  const cleaned = cleanJSONSchemaForAntigravity(schema);
  assert.equal((cleaned as LooseDeep).properties.mode.type, "string");
  assert.deepEqual((cleaned as LooseDeep).properties.mode.enum, ["fast", "balanced", "slow"]);
});

test("T16: existing explicit type:string is preserved", () => {
  const schema = {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["auto", "manual"],
      },
    },
  };

  const cleaned = cleanJSONSchemaForAntigravity(schema);
  assert.equal((cleaned as LooseDeep).properties.mode.type, "string");
  assert.deepEqual((cleaned as LooseDeep).properties.mode.enum, ["auto", "manual"]);
});

test("T16: schemas without enum are not forced to string", () => {
  const schema = {
    type: "object",
    properties: {
      retries: {
        type: "number",
        minimum: 0,
      },
    },
  };

  const cleaned = cleanJSONSchemaForAntigravity(schema);
  assert.equal((cleaned as LooseDeep).properties.retries.type, "number");
  assert.equal((cleaned as LooseDeep).properties.retries.enum, undefined);
});
