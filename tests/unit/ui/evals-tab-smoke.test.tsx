// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

describe("EvalsTab memoization", { timeout: 30000 }, () => {
  it("EvalsTab page module exports a default component", async () => {
    const mod = await import("@/app/(dashboard)/dashboard/usage/components/EvalsTab");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });
});
