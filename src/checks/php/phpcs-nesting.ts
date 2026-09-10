import { join } from "node:path";

import { POLICY, xml } from "../shared/kit.ts";
import { phpcsCommand, phpcsFindings, phpcsRuleset } from "./phpcs-shared.ts";
import type { CheckAdapter } from "../shared/kit.ts";

const NESTING_RULE = {
  sources: {
    "Generic.Metrics.NestingLevel.TooHigh": "WARNING",
    "Generic.Metrics.NestingLevel.MaxExceeded": "ERROR",
  },
  measure: /nesting level \((\d+)\)/u,
  ruleLabel: "Generic.Metrics.NestingLevel",
};

export function nestingRuleset(): string {
  const properties = xml("properties", {}, [
    xml("property", { name: "nestingLevel", value: String(POLICY.maxDepth) }),
    xml("property", { name: "absoluteNestingLevel", value: "100" }),
  ]);
  return phpcsRuleset("code-quality-nesting", xml(
    "rule", { ref: "Generic.Metrics.NestingLevel" }, [properties],
  ));
}

export const phpcsNestingAdapter: CheckAdapter = {
  id: "php-complexity-phpcs", check: "complexity", language: "php",
  tool: { bin: "phpcs", version: "4.0.4" },
  applicability: () => ({ kind: "run" }),
  configFiles: () => [{ path: "phpcs-nesting.xml", content: nestingRuleset() }],
  command: (ctx) => phpcsCommand(ctx, join(ctx.tempDir, "phpcs-nesting.xml")),
  parse: (ctx, result) => phpcsFindings(ctx, JSON.parse(result.stdout) as unknown, NESTING_RULE),
};
