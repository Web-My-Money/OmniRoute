/**
 * Resolve the real MDX component map from the `fumadocs-ui/mdx` module.
 *
 * The module *namespace* is NOT the component map: the map is its `default`
 * export, and the namespace also carries `createRelativeLink` — a factory
 * function, not a component. Spreading the namespace once passed
 * `default`/`createRelativeLink` to <MDX components={...}> as literal
 * component names, silently stripping every real mapping from docs pages.
 */
export function getMdxComponentMap(mod: Record<string, unknown>): Record<string, unknown> {
  const inner = mod.default;
  if (inner && typeof inner === "object") return inner as Record<string, unknown>;
  return mod;
}
