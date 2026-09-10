import { describe, expect, it } from "vitest";

import {
  assertInScope,
  excludeGlobs,
  relativize,
  relativizeFrom,
} from "../../../src/checks/shared/paths.ts";
import { TEST_EXCLUSIONS } from "../../../src/core/config/exclusions.ts";
import { checkContext } from "../../helpers/check-context.ts";

describe("shared paths", () => {
  it("relativizes an absolute path and retains a relative path", () => {
    expect(relativize("/r", "/r/src/a.ts")).toBe("src/a.ts");
    expect(relativize("/r", "src/a.ts")).toBe("src/a.ts");
  });

  it("rejects an absolute path outside the root", () => {
    expect(() => relativize("/r", "/x/a.ts")).toThrow("escapes repository root");
  });

  it("maps captured container paths to the fixture root", () => {
    expect(relativizeFrom("/fixtures/php-project", "/work/src/a.php")).toBe("src/a.php");
  });

  it("prefers the real root when running inside the container", () => {
    expect(relativizeFrom("/work/project", "/work/project/src/a.php")).toBe("src/a.php");
  });

  it("enforces source scope with explicit manifest exceptions", () => {
    expect(() => assertInScope("scripts/x.ts", ["src"])).toThrow("outside configured paths");
    expect(() => assertInScope("package.json", ["src"], ["package.json"])).not.toThrow();
  });

  it("adds test exclusions only when requested", () => {
    const config = checkContext("/r").config;
    expect(excludeGlobs(config, true)).toEqual(expect.arrayContaining([...TEST_EXCLUSIONS]));
    expect(excludeGlobs(config, false)).not.toContain(TEST_EXCLUSIONS[0]);
  });
});
