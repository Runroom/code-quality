import { join } from "node:path";

import { parseJsonOutput, POLICY, xml } from "../shared/kit.ts";
import { phpcsCommand, phpcsFindings, phpcsRuleset } from "./phpcs-shared.ts";
import type { CheckAdapter } from "../shared/kit.ts";

const COGNITIVE_RULE = {
  sources: { "SlevomatCodingStandard.Complexity.Cognitive.ComplexityTooHigh": "ERROR" },
  measure: /is (\d+) but has to be/u,
  ruleLabel: "cognitive-complexity",
  minimumExclusive: POLICY.cognitive,
};

export function cognitiveRuleset(): string {
  const properties = xml("properties", {}, [
    xml("property", { name: "maxComplexity", value: String(POLICY.cognitive) }),
  ]);
  return phpcsRuleset("code-quality-cognitive", xml(
    "rule", { ref: "SlevomatCodingStandard.Complexity.Cognitive" }, [properties],
  ));
}

export const phpcsCognitiveAdapter: CheckAdapter = {
  id: "php-cognitive", check: "cognitive", language: "php",
  tool: { bin: "phpcs", version: "4.0.4" },
  applicability: () => ({ kind: "run" }),
  configFiles: () => [{ path: "phpcs-cognitive.xml", content: cognitiveRuleset() }],
  command: (ctx) => phpcsCommand(ctx, join(ctx.tempDir, "phpcs-cognitive.xml")),
  parse: (ctx, result) => phpcsFindings(ctx, parseJsonOutput(result.stdout, "phpcs"), COGNITIVE_RULE),
};
