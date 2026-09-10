import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  deptryAdapter,
  deptryExcludeRegex,
  deptryFindings,
} from "../../../src/checks/python/deptry.ts";
import { BUILTIN_EXCLUSIONS } from "../../../src/core/config/exclusions.ts";
import { checkContext } from "../../helpers/check-context.ts";

const root = resolve("fixtures/python-project");
const nativeFile = resolve("tests/fixtures/native/python-unused-deptry/deptry.json");

function report(code: string): unknown {
  return [{ error: { code, message: "dependency issue" }, module: "requests",
    location: { file: "pyproject.toml", line: null, column: null } }];
}

describe("deptry synthetic parser", () => {
  const ctx = checkContext("/r", "python");

  it("rejects unknown DEP009 diagnostics", () => {
    expect(() => deptryFindings(ctx, report("DEP009"))).toThrow();
  });

  it("uses the DEP002 dependency key shape", () => {
    expect(deptryFindings(ctx, report("DEP002"))).toEqual({
      "pyproject.toml | deptry-DEP002 | requests": 1,
    });
  });

  it("converts built-in exclusions to Rust-compatible regexes", () => {
    expect(BUILTIN_EXCLUSIONS.map(deptryExcludeRegex)).toEqual([
      "(^|/)node_modules(/|$)", "(^|/)vendor(/|$)", "(^|/)\\.venv(/|$)",
      "(^|/)dist(/|$)", "(^|/)artifacts(/|$)",
    ]);
  });

  it("converts and escapes a consumer exclusion glob", () => {
    expect(deptryExcludeRegex("**/generated.v1/**")).toBe("(^|/)generated\\.v1(/|$)");
    expect(deptryExcludeRegex("src/generated?.py")).toBe("^src/generated[^/]\\.py$");
  });

  it("passes converted exclusions to deptry", () => {
    const configured = checkContext("/r", "python");
    configured.config.exclude.push("**/generated.v1/**");
    const args = deptryAdapter.command(configured).args;
    expect(args).toContain("(^|/)generated\\.v1(/|$)");
    expect(args.every((arg) => !arg.includes("(?="))).toBe(true);
  });
});

describe.skipIf(!existsSync(nativeFile))("deptry captured fixture", () => {
  it("finds requests as an unused dependency", () => {
    const input = JSON.parse(readFileSync(nativeFile, "utf8")) as unknown;
    expect(deptryFindings(checkContext(root, "python"), input)).toHaveProperty(
      "pyproject.toml | deptry-DEP002 | requests", 1,
    );
  });
});
