import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { cognitiveRuleset } from "../../../src/checks/php/phpcs-cognitive.ts";
import { nestingRuleset } from "../../../src/checks/php/phpcs-nesting.ts";
import { phpcsFindings } from "../../../src/checks/php/phpcs-shared.ts";
import { checkContext } from "../../helpers/check-context.ts";
import { POLICY } from "../../../src/core/config/policy.ts";

const root = resolve("fixtures/php-project");
const source = "<?php\nfinal class Demo {\n    public function run(): void {}\n}\n";
const nestingRule = {
  sources: { "Generic.Metrics.NestingLevel.TooHigh": "WARNING" },
  measure: /nesting level \((\d+)\)/u,
  ruleLabel: "Generic.Metrics.NestingLevel",
};
const cognitiveRule = {
  sources: { "SlevomatCodingStandard.Complexity.Cognitive.ComplexityTooHigh": "ERROR" },
  measure: /is (\d+) but has to be/u,
  ruleLabel: "cognitive-complexity",
  minimumExclusive: 15,
};

function report(sourceName: string, message: string, type: "ERROR" | "WARNING" = "WARNING"): unknown {
  return { totals: { errors: 0, warnings: 1 }, files: { "src/a.php": { messages: [{
    message, source: sourceName, type, line: 3, column: 5,
  }] } } };
}

describe("phpcs config and synthetic parser", () => {
  it("generates nesting level 3 and cognitive max 15", () => {
    expect(nestingRuleset()).toContain(`name="nestingLevel" value="${POLICY.maxDepth}"`);
    expect(cognitiveRuleset()).toContain(`name="maxComplexity" value="${POLICY.cognitive}"`);
  });

  it("rejects an unknown source", async () => {
    await expect(phpcsFindings(
      checkContext("/r", "php", { "src/a.php": source }),
      report("PSR2.Classes.ClassDeclaration.OpenBraceNewLine", "nesting level (4)"), nestingRule,
    )).rejects.toThrow("Unbaselined PHPCS source");
  });

  it("skips PHPCS internal notices", async () => {
    await expect(phpcsFindings(
      checkContext("/r", "php", { "src/a.php": source }),
      report("Internal.NoCodeFound", "No PHP code was found"), nestingRule,
    )).resolves.toEqual({});
  });

  it("rejects a nesting message without a number", async () => {
    await expect(phpcsFindings(
      checkContext("/r", "php", { "src/a.php": source }),
      report("Generic.Metrics.NestingLevel.TooHigh", "nesting is high"), nestingRule,
    )).rejects.toThrow("Unparsable metric message");
  });

  it("rejects a cognitive score at the policy threshold", async () => {
    await expect(phpcsFindings(
      checkContext("/r", "php", { "src/a.php": source }),
      report("SlevomatCodingStandard.Complexity.Cognitive.ComplexityTooHigh",
        'Cognitive complexity for "run" is 15 but has to be less than or equal to 15.', "ERROR"),
      cognitiveRule,
    )).rejects.toThrow("below policy threshold");
  });
});

for (const fixture of [
  { id: "php-complexity-phpcs", rule: nestingRule, label: "nesting" },
  { id: "php-cognitive", rule: cognitiveRule, label: "cognitive complexity" },
]) {
  describe(`${fixture.label} captured fixture`, () => {
    it(`finds the Complex::run ${fixture.label} violation`, async () => {
      const nativeFile = resolve(`tests/fixtures/native/${fixture.id}/stdout.json`);
      const parsed = await phpcsFindings(
        checkContext(root, "php"), JSON.parse(readFileSync(nativeFile, "utf8")) as unknown,
        fixture.rule,
      );
      const ruleLabel = fixture.rule.ruleLabel;
      const value = fixture.id === "php-cognitive" ? 17 : 4;
      expect(parsed).toEqual({
        [`src/Service/Complex.php | ${ruleLabel} | /class:Complex/method:run`]: value,
      });
    });
  });
}
