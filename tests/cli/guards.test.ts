import { describe, expect, it } from "vitest";

import { assertNotInCi, resolveMode } from "../../src/cli/guards.ts";

describe("CLI guards", () => {
  it("refuses baseline changes in GitHub Actions", () => {
    expect(() => assertNotInCi({ GITHUB_ACTIONS: "true" }, "baseline")).toThrow(
      "Refusing `baseline` in GitHub Actions",
    );
  });

  it("allows local baseline changes", () => {
    expect(() => assertNotInCi({}, "baseline")).not.toThrow();
  });

  it.each(["true", "1", "yes"])("refuses baseline changes when CI=%s", (value) => {
    expect(() => assertNotInCi({ CI: value }, "baseline")).toThrow(
      `Refusing baseline in CI (CI=${value})`,
    );
  });

  it("rejects mutually exclusive modes", () => {
    expect(() => resolveMode({ update: true, initialize: true })).toThrow(
      "--update and --initialize are mutually exclusive",
    );
  });

  it("resolves the default check mode", () => {
    expect(resolveMode({})).toBe("check");
  });
});
