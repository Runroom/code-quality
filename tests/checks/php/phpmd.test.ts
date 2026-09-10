import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { phpmdFindings, phpmdRuleset } from "../../../src/checks/php/phpmd.ts";
import { POLICY } from "../../../src/core/config/policy.ts";
import { checkContext } from "../../helpers/check-context.ts";

const root = resolve("fixtures/php-project");
const nativeFile = resolve("tests/fixtures/native/php-complexity-phpmd/stdout.json");
const source = "<?php\nfinal class Demo {\n    public function run(): void {}\n}\n";

function report(rule = "CyclomaticComplexity", version = "2.15.0"): unknown {
  return {
    version, package: "phpmd", errors: [],
    files: [{ file: "src/a.php", violations: [{
      beginLine: 3, rule, description: "The method run() has a Cyclomatic Complexity of 12.",
      method: "run", function: null,
    }] }],
  };
}

describe("phpmd config and synthetic parser", () => {
  it("generates inclusive thresholds 11, 61, and 5", () => {
    const ruleset = phpmdRuleset();
    expect(ruleset).toContain(`name="reportLevel" value="${POLICY.complexity + 1}"`);
    expect(ruleset).toContain(`name="minimum" value="${POLICY.maxLinesPerFunction + 1}"`);
    expect(ruleset).toContain(`name="minimum" value="${POLICY.maxParams + 1}"`);
  });

  it("rejects unknown NPathComplexity rules", async () => {
    await expect(phpmdFindings(
      checkContext("/r", "php", { "src/a.php": source }), report("NPathComplexity"),
    )).rejects.toThrow("Unbaselined PHPMD rule");
  });

  it("rejects processing errors", async () => {
    const input = report() as { errors: unknown[] };
    input.errors = [{ fileName: "src/a.php", message: "parse failed" }];
    await expect(phpmdFindings(
      checkContext("/r", "php", { "src/a.php": source }), input,
    )).rejects.toThrow("processing errors");
  });

  it("accepts the unexpanded PHPMD package version", async () => {
    await expect(phpmdFindings(
      checkContext("/r", "php", { "src/a.php": source }), report(undefined, "@package_version@"),
    )).resolves.toHaveProperty("src/a.php | CyclomaticComplexity | /class:Demo/method:run", 12);
  });
});

describe("phpmd captured fixture", () => {
  it("finds all three complexity metrics", async () => {
    const parsed = await phpmdFindings(
      checkContext(root, "php"), JSON.parse(readFileSync(nativeFile, "utf8")) as unknown,
    );
    expect(parsed).toEqual({
      "src/Service/Complex.php | CyclomaticComplexity | /class:Complex/method:run": 12,
      "src/Service/Complex.php | ExcessiveMethodLength | /class:Complex/method:run": 67,
      "src/Service/Complex.php | ExcessiveParameterList | /class:Complex/method:run": 5,
    });
  });
});
