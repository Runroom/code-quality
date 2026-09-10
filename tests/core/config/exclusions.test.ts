import { describe, expect, it } from "vitest";

import {
  BUILTIN_EXCLUSIONS,
  TEST_EXCLUSIONS,
  isExcluded,
} from "../../../src/core/config/exclusions.ts";

describe("isExcluded", () => {
  it("excludes test files", () => {
    expect(isExcluded("src/a.test.ts", TEST_EXCLUSIONS)).toBe(true);
    expect(isExcluded("src/tests/x.py", TEST_EXCLUSIONS)).toBe(true);
  });

  it("keeps ordinary source files", () => {
    expect(isExcluded("src/a.ts", TEST_EXCLUSIONS)).toBe(false);
  });

  it("excludes built-in dependency directories", () => {
    expect(isExcluded("vendor/x.php", BUILTIN_EXCLUSIONS)).toBe(true);
  });

  it.each([
    "public/build/app.js",
    "assets/app.min.js",
    "assets/site.min.css",
    "var/cache/dev/container.php",
  ])("excludes built-in generated path %s", (file) => {
    expect(isExcluded(file, BUILTIN_EXCLUSIONS)).toBe(true);
  });

  it("matches dot directories", () => {
    expect(isExcluded(".hidden/x.ts", ["**/.hidden/**"])).toBe(true);
  });
});
