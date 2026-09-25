/**
 * getMdxComponentMap — regression: spreading the fumadocs-ui/mdx module
 * namespace once passed `default`/`createRelativeLink` to <MDX components>
 * as literal component names, stripping every real mapping from docs pages.
 * Run: node --import tsx/esm --test tests/unit/lib/docs-mdx-components.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

const { getMdxComponentMap } = await import("../../../src/lib/docsMdxComponents.ts");

test("returns the module's default export (the real component map)", () => {
  const components = { h1: () => null, pre: () => null };
  const mod = { default: components, createRelativeLink: () => null };
  const result = getMdxComponentMap(mod);
  assert.equal(result.h1, components.h1);
  assert.equal(result.pre, components.pre);
  assert.equal("default" in result, false);
  assert.equal("createRelativeLink" in result, false);
});

test("passes through a plain component map when there is no default export", () => {
  const components = { h1: () => null };
  assert.deepEqual(getMdxComponentMap(components), components);
});
