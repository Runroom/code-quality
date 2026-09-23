import { join } from "node:path";

import { parseJsonOutput, POLICY, xml } from "../shared/kit.ts";
import { phpcsCommand, phpcsFindings, phpcsRuleset } from "./phpcs-shared.ts";
import type { CheckAdapter } from "../shared/kit.ts";
import type { PhpcsRule } from "./phpcs-shared.ts";
import { phpcsExtensions } from "./phpcs-shared.ts";
import type { ResolvedConfig } from "../../core/config/types.ts";

const COMPLEXITY_RULES: readonly PhpcsRule[] = [
  {
    sources: {
      "Generic.Metrics.CyclomaticComplexity.TooHigh": "WARNING",
      "Generic.Metrics.CyclomaticComplexity.MaxExceeded": "ERROR",
    },
    measure: /complexity \((\d+)\)/u,
    ruleLabel: "Generic.Metrics.CyclomaticComplexity",
    minimumExclusive: POLICY.complexity,
  },
  {
    sources: {
      "Generic.Metrics.NestingLevel.TooHigh": "WARNING",
      "Generic.Metrics.NestingLevel.MaxExceeded": "ERROR",
    },
    measure: /nesting level \((\d+)\)/u,
    ruleLabel: "Generic.Metrics.NestingLevel",
    minimumExclusive: POLICY.maxDepth,
  },
  {
    sources: {
      "SlevomatCodingStandard.Functions.FunctionLength.FunctionLength": "ERROR",
    },
    // VERIFY-AT-CAPTURE: confirm the pinned sniff's exact message wording.
    measure: /Currently using (\d+)/u,
    ruleLabel: "SlevomatCodingStandard.Functions.FunctionLength",
    minimumExclusive: POLICY.maxLinesPerFunction,
  },
  {
    sources: { "Runroom.Metrics.ParameterCount.TooMany": "WARNING" },
    measure: /has (\d+) parameters/u,
    ruleLabel: "Runroom.Metrics.ParameterCount",
    minimumExclusive: POLICY.maxParams,
  },
];

function property(name: string, value: number): string {
  return xml("property", { name, value: String(value) });
}

function configuredRule(ref: string, properties: string[]): string {
  return xml("rule", { ref }, [xml("properties", {}, properties)]);
}

export function complexityRuleset(config: Pick<ResolvedConfig, "isDrupal">): string {
  const rules = [
    configuredRule("Generic.Metrics.CyclomaticComplexity", [
      property("complexity", POLICY.complexity), property("absoluteComplexity", 1000),
    ]),
    configuredRule("Generic.Metrics.NestingLevel", [
      property("nestingLevel", POLICY.maxDepth), property("absoluteNestingLevel", 1000),
    ]),
    configuredRule("SlevomatCodingStandard.Functions.FunctionLength", [
      property("maxLinesLength", POLICY.maxLinesPerFunction),
    ]),
    configuredRule("Runroom.Metrics.ParameterCount", [
      property("maxParameters", POLICY.maxParams),
    ]),
  ];
  return phpcsRuleset("code-quality-complexity", rules.join(""), phpcsExtensions(config));
}

export const phpcsComplexityAdapter: CheckAdapter = {
  id: "php-complexity", check: "complexity", language: "php",
  tool: { bin: "phpcs", version: "4.0.4" },
  applicability: () => ({ kind: "run" }),
  configFiles: (ctx) => [{ path: "phpcs-complexity.xml", content: complexityRuleset(ctx.config) }],
  command: (ctx) => phpcsCommand(ctx, join(ctx.tempDir, "phpcs-complexity.xml")),
  parse: (ctx, result) => phpcsFindings(
    ctx, parseJsonOutput(result.stdout, "phpcs", result.stderr), COMPLEXITY_RULES,
  ),
};
