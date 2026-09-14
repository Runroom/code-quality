import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  cognitiveRuleset,
  phpcsCognitiveAdapter,
} from "../../../src/checks/php/phpcs-cognitive.ts";
import {
  complexityRuleset,
  phpcsComplexityAdapter,
} from "../../../src/checks/php/phpcs-complexity.ts";
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

function complexityReport(): unknown {
  const messages = [
    ["Generic.Metrics.CyclomaticComplexity.TooHigh", "The function's cyclomatic complexity (12) exceeds 10; consider refactoring the function", "WARNING"],
    ["Generic.Metrics.NestingLevel.TooHigh", "Function's nesting level (4) exceeds 3; consider refactoring the function", "WARNING"],
    ["SlevomatCodingStandard.Functions.FunctionLength.FunctionLength", "Your function is too long. Currently using 66 lines. Can be up to 60 lines.", "ERROR"],
    ["Runroom.Metrics.ParameterCount.TooMany", 'Function "run" has 5 parameters; the limit is 4', "WARNING"],
  ].map(([messageSource, message, type]) => ({
    message, source: messageSource, type, line: 3, column: 5,
  }));
  return { totals: { errors: 1, warnings: 3 }, files: { "src/a.php": { messages } } };
}

describe("phpcs config and synthetic parser", () => {
  it("generates all PHP complexity thresholds and cognitive max 15", () => {
    const ruleset = complexityRuleset({ isDrupal: false });
    expect(ruleset).toContain(`name="complexity" value="${POLICY.complexity}"`);
    expect(ruleset).toContain(`name="nestingLevel" value="${POLICY.maxDepth}"`);
    expect(ruleset).toContain(`name="maxLinesLength" value="${POLICY.maxLinesPerFunction}"`);
    expect(ruleset).toContain(`name="maxParameters" value="${POLICY.maxParams}"`);
    expect(ruleset).toContain("/opt/php/phpcs-standard");
    expect(ruleset).toContain('name="extensions" value="php"');
    expect(cognitiveRuleset({ isDrupal: false })).toContain(`name="maxComplexity" value="${POLICY.cognitive}"`);
    expect(cognitiveRuleset({ isDrupal: false })).toContain('name="extensions" value="php"');

    const drupalRuleset = complexityRuleset({ isDrupal: true });
    const drupalCognitiveRuleset = cognitiveRuleset({ isDrupal: true });
    const extensions = 'name="extensions" value="php,module,theme,install,inc,profile,engine"';
    expect(drupalRuleset).toContain(extensions);
    expect(drupalCognitiveRuleset).toContain(extensions);

    const context = checkContext("/r", "php", { "src/a.php": source });
    context.config.isDrupal = true;
    expect(phpcsComplexityAdapter.configFiles(context)[0]!.content).toContain(extensions);
    expect(phpcsCognitiveAdapter.configFiles(context)[0]!.content).toContain(extensions);
  });

  it("rejects an unknown source", async () => {
    await expect(phpcsFindings(
      checkContext("/r", "php", { "src/a.php": source }),
      report("PSR2.Classes.ClassDeclaration.OpenBraceNewLine", "nesting level (4)"), nestingRule,
    )).rejects.toThrow("Unbaselined PHPCS source");
  });

  it("skips PHPCS internal notices", async () => {
    expect((await phpcsFindings(
      checkContext("/r", "php", { "src/a.php": source }),
      report("Internal.NoCodeFound", "No PHP code was found"), nestingRule,
    )).findings).toEqual({});
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

  it("normalizes all four complexity sniff measurements", async () => {
    const { findings: parsed } = await phpcsComplexityAdapter.parse(
      checkContext("/r", "php", { "src/a.php": source }),
      { stdout: JSON.stringify(complexityReport()), stderr: "", exitCode: 1 },
    );
    expect(parsed).toEqual({
      "src/a.php | Generic.Metrics.CyclomaticComplexity | /class:Demo/method:run": 12,
      "src/a.php | Generic.Metrics.NestingLevel | /class:Demo/method:run": 4,
      "src/a.php | Runroom.Metrics.ParameterCount | /class:Demo/method:run": 5,
      "src/a.php | SlevomatCodingStandard.Functions.FunctionLength | /class:Demo/method:run": 66,
    });
  });
});

const complexityFixture = resolve("tests/fixtures/native/php-complexity/stdout.json");

describe.skipIf(!existsSync(complexityFixture))("PHP complexity captured fixture", () => {
  it("finds all four Complex::run metrics", async () => {
    const capturedReport = JSON.parse(readFileSync(complexityFixture, "utf8")) as {
      files: Record<string, { messages: Array<{
        source: string; message: string; line: number; column: number;
      }> }>;
    };
    const { findings: parsed, details } = await phpcsComplexityAdapter.parse(
      checkContext(root, "php"),
      { stdout: JSON.stringify(capturedReport), stderr: "", exitCode: 1 },
    );
    expect(parsed).toEqual({
      "src/Service/Complex.php | Generic.Metrics.CyclomaticComplexity | /class:Complex/method:run": 12,
      "src/Service/Complex.php | Generic.Metrics.NestingLevel | /class:Complex/method:run": 4,
      "src/Service/Complex.php | Runroom.Metrics.ParameterCount | /class:Complex/method:run": 5,
      "src/Service/Complex.php | SlevomatCodingStandard.Functions.FunctionLength | /class:Complex/method:run": 66,
    });
    const message = capturedReport.files["/work/src/Service/Complex.php"]!.messages.find(
      (entry) => entry.source === "Generic.Metrics.CyclomaticComplexity.TooHigh",
    )!;
    expect(details["src/Service/Complex.php | Generic.Metrics.CyclomaticComplexity | /class:Complex/method:run"])
      .toMatchObject({
        line: message.line,
        column: message.column,
        message: message.message,
        threshold: POLICY.complexity,
      });
  });
});

describe("cognitive complexity captured fixture", () => {
  it("finds the Complex::run cognitive complexity violation", async () => {
    const nativeFile = resolve("tests/fixtures/native/php-cognitive/stdout.json");
    const capturedReport = JSON.parse(readFileSync(nativeFile, "utf8")) as {
      files: Record<string, { messages: Array<{
        source: string; message: string; line: number; column: number;
      }> }>;
    };
    const { findings: parsed, details } = await phpcsFindings(
      checkContext(root, "php"), capturedReport,
      cognitiveRule,
    );
    expect(parsed).toEqual({
      "src/Service/Complex.php | cognitive-complexity | /class:Complex/method:run": 17,
    });
    const message = capturedReport.files["/work/src/Service/Complex.php"]!.messages[0]!;
    expect(details["src/Service/Complex.php | cognitive-complexity | /class:Complex/method:run"])
      .toMatchObject({
        line: message.line,
        column: message.column,
        message: message.message,
        threshold: POLICY.cognitive,
      });
  });
});
