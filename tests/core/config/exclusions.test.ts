import { describe, expect, it } from "vitest";

import {
  BUILTIN_EXCLUSIONS,
  PAYLOAD_NEXT_EXCLUSIONS,
  payloadNextExclusions,
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

  it.each([
    "src/app/(payload)/admin/page.tsx",
    "src/app/(payload)/backoffice/importMap.js",
    "src/migrations-2024/x.ts",
    "src/payload-types.ts",
    "src/seed/seed.ts",
  ])("excludes Payload/Next generated path %s", (file) => {
    expect(isExcluded(file, payloadNextExclusions(["src"]))).toBe(true);
  });

  it.each([
    "src/app/(frontend)/page.tsx",
    "src/app/api/payload/route.ts",
  ])("keeps non-generated Payload/Next path %s", (file) => {
    expect(isExcluded(file, payloadNextExclusions(["src"]))).toBe(false);
  });

  it("scopes generated exclusions to TypeScript roots except root Next files", () => {
    expect(payloadNextExclusions(["src"])).toEqual([
      "src/**/payload-types.ts", "src/**/importMap.js", "src/**/app/[(]payload[)]/**",
      "src/**/migrations/**", "src/**/migrations-*/**", "src/**/seed/**",
      ".next/**", "next-env.d.ts",
    ]);
    expect(PAYLOAD_NEXT_EXCLUSIONS).toHaveLength(8);
  });

  it("excludes the Payload route group when app itself is the TypeScript root", () => {
    expect(isExcluded("app/(payload)/admin/page.tsx", payloadNextExclusions(["app"]))).toBe(true);
  });
});
