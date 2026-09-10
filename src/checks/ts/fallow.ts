import { join } from "node:path";

import { z } from "zod";

import { excludeGlobs, fail, FindingsBuilder, isInScope, lineColumnToByteOffset, POLICY, relativize } from "../shared/kit.ts";
import type { CheckAdapter, CheckContext, Findings } from "../shared/kit.ts";

const fallowSchema = z.looseObject({
  kind: z.literal("health"),
  version: z.literal("3.23.0"),
  schema_version: z.literal(11),
  summary: z.looseObject({
    files_analyzed: z.number().int().positive(),
    functions_analyzed: z.number().int().nonnegative(),
    max_cyclomatic_threshold: z.literal(0),
    max_cognitive_threshold: z.literal(0),
  }),
  findings: z.array(z.looseObject({
    path: z.string(),
    name: z.string(),
    cognitive: z.number().int().nonnegative(),
    line: z.number().int().positive(),
    col: z.number().int().nonnegative(),
  })),
});

function fallowConfig(ctx: CheckContext): string {
  return JSON.stringify({
    ignorePatterns: [...excludeGlobs(ctx.config, false), "artifacts/**"],
    health: { maxCyclomatic: POLICY.complexity, maxCognitive: POLICY.cognitive },
    duplicates: POLICY.advisoryDuplication,
  }, null, 2);
}

export async function fallowFindings(ctx: CheckContext, input: unknown): Promise<Findings> {
  const report = fallowSchema.parse(input);
  if (report.findings.length !== report.summary.functions_analyzed) {
    return fail("Incomplete Fallow function report");
  }
  const findings = new FindingsBuilder();
  for (const finding of report.findings) {
    const file = relativize(ctx.root, finding.path);
    // Spec §7: production discovery scans the repository, but the gate owns configured paths.
    if (!isInScope(file, ctx.paths) || finding.cognitive <= POLICY.cognitive) continue;
    const source = ctx.readSource(file);
    const offset = lineColumnToByteOffset(source, finding.line, finding.col + 1);
    const anchor = await ctx.anchor.anchor(file, source, offset, false);
    findings.add(file, "cognitive-complexity", anchor, finding.cognitive);
  }
  return findings.build();
}

export const fallowAdapter: CheckAdapter = {
  id: "ts-cognitive",
  check: "cognitive",
  language: "ts",
  tool: { bin: "fallow", version: "3.23.0" },
  applicability: () => ({ kind: "run" }),
  configFiles: (ctx) => [{ path: "fallowrc.json", content: fallowConfig(ctx) }],
  command: (ctx) => ({
    bin: "fallow",
    args: [
      "health", "--production", "--complexity", "--max-cyclomatic", "0",
      "--max-cognitive", "0", "--report-only", "--no-cache", "--quiet",
      "--format", "json", "--config", join(ctx.tempDir, "fallowrc.json"),
    ],
    env: { FALLOW_TELEMETRY_DISABLED: "1" },
    exitCodes: [0],
  }),
  parse: (ctx, result) => fallowFindings(ctx, JSON.parse(result.stdout) as unknown),
};
