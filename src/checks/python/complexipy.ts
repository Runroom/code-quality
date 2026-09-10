import { z } from "zod";

import { addAnchoredFinding, excludeGlobs, extractMeasurement, fail, FindingsBuilder, POLICY, relativizeFrom, toolOutput } from "../shared/kit.ts";
import type { CheckAdapter, CheckContext, Findings } from "../shared/kit.ts";

const RULE_ID = "CC001";
const MESSAGE = /has a cognitive complexity of (\d+),/u;

const resultSchema = z.looseObject({
  ruleId: z.string(),
  message: z.looseObject({ text: z.string() }),
  locations: z.array(z.looseObject({
    physicalLocation: z.looseObject({
      artifactLocation: z.looseObject({ uri: z.string() }),
      region: z.looseObject({ startLine: z.number().int().positive() }),
    }),
  })).min(1),
});

const sarifSchema = z.looseObject({
  version: z.literal("2.1.0"),
  runs: z.array(z.looseObject({
    tool: z.looseObject({ driver: z.looseObject({
      name: z.string(), version: z.literal("8.0.1").optional(),
    }) }),
    results: z.array(resultSchema),
  })).length(1),
});

export async function complexipyFindings(ctx: CheckContext, input: unknown): Promise<Findings> {
  const report = sarifSchema.parse(input);
  const findings = new FindingsBuilder();
  for (const result of report.runs[0]!.results) {
    if (result.ruleId !== RULE_ID) return fail(`Unbaselined complexipy rule ${result.ruleId}`);
    const location = result.locations[0]!.physicalLocation;
    const file = relativizeFrom(ctx.root, location.artifactLocation.uri);
    const value = extractMeasurement(MESSAGE, result.message.text, result.ruleId);
    if (value <= POLICY.cognitive) {
      return fail(`${result.ruleId} is below policy threshold ${POLICY.cognitive}`);
    }
    await addAnchoredFinding(ctx, findings, {
      file, rule: "cognitive-complexity", value,
      line: location.region.startLine, blockMode: false,
    });
  }
  return findings.build();
}

export const complexipyAdapter: CheckAdapter = {
  id: "python-cognitive", check: "cognitive", language: "python",
  tool: { bin: "complexipy", version: "8.0.1" },
  applicability: () => ({ kind: "run" }),
  configFiles: (ctx) => toolOutput(ctx, "complexipy.sarif").clear(),
  command: (ctx) => ({
    bin: "complexipy",
    args: ["--max-complexity-allowed", String(POLICY.cognitive), "--quiet", "--output-format", "sarif",
      "--output", toolOutput(ctx, "complexipy.sarif").path, ...excludeGlobs(ctx.config, false)
        .flatMap((glob) => ["--exclude", glob]), ...ctx.paths],
    exitCodes: [0, 1],
  }),
  artifactOutputs: (ctx) => toolOutput(ctx, "complexipy.sarif").outputs(),
  parse: (ctx) => complexipyFindings(
    ctx, JSON.parse(toolOutput(ctx, "complexipy.sarif").read("complexipy")) as unknown,
  ),
};
