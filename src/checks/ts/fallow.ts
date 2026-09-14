import { join } from "node:path";

import { z } from "zod";

import { addAnchoredFinding, excludeGlobs, fail, FindingsBuilder, isInScope, parseJsonOutput, POLICY, relativize } from "../shared/kit.ts";
import type { CheckAdapter, CheckContext, ParsedFindings } from "../shared/kit.ts";

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

export const fallowErrorSchema = z.looseObject({
  error: z.literal(true),
  message: z.string(),
});

export function fallowConfig(ctx: CheckContext, extraIgnorePatterns: readonly string[] = []): string {
  return JSON.stringify({
    ignorePatterns: [...excludeGlobs(ctx.config, true), "artifacts/**", ...extraIgnorePatterns],
    health: { maxCyclomatic: POLICY.complexity, maxCognitive: POLICY.cognitive },
    duplicates: POLICY.advisoryDuplication,
  }, null, 2);
}

export async function fallowFindings(ctx: CheckContext, input: unknown): Promise<ParsedFindings> {
  const error = fallowErrorSchema.safeParse(input);
  if (error.success) return fail(error.data.message);
  const report = fallowSchema.parse(input);
  if (report.findings.length !== report.summary.functions_analyzed) {
    return fail("Incomplete Fallow function report");
  }
  const findings = new FindingsBuilder();
  for (const finding of report.findings) {
    const file = relativize(ctx.root, finding.path);
    // Spec §7: production discovery scans the repository, but the gate owns configured paths.
    if (!isInScope(file, ctx.paths) || finding.cognitive <= POLICY.cognitive) continue;
    await addAnchoredFinding(ctx, findings, {
      file, rule: "cognitive-complexity", value: finding.cognitive,
      line: finding.line, column: finding.col + 1, blockMode: false, symbol: finding.name,
      message: `Function '${finding.name}' has a cognitive complexity of ${finding.cognitive}. `
        + `Maximum allowed is ${POLICY.cognitive}.`,
      threshold: POLICY.cognitive,
    });
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
    exitCodes: [0, 2],
  }),
  parse: (ctx, result) => fallowFindings(
    ctx,
    parseJsonOutput(result.stdout, "fallow", result.stderr),
  ),
};
