import { join } from "node:path";

import { z } from "zod";

import { addAnchoredFinding, excludeGlobs, extractMeasurement, fail, FindingsBuilder, POLICY, relativizeFrom } from "../shared/kit.ts";
import type { CheckAdapter, CheckContext, Findings } from "../shared/kit.ts";

const METRICS: Record<string, RegExp> = {
  C901: new RegExp(`is too complex \\((\\d+) > ${POLICY.complexity}\\)`, "u"),
  PLR0913: new RegExp(`\\((\\d+) > ${POLICY.maxParams}\\)`, "u"),
  PLR0915: new RegExp(`\\((\\d+) > ${POLICY.maxLinesPerFunction}\\)`, "u"),
  PLR1702: new RegExp(`\\((\\d+) > ${POLICY.maxDepth}\\)`, "u"),
};

const reportSchema = z.array(z.looseObject({
  code: z.string(),
  message: z.string(),
  filename: z.string(),
  location: z.looseObject({
    row: z.number().int().positive(),
    column: z.number().int().positive(),
  }),
}));

export function ruffConfig(): string {
  return `[lint]
select = ["C901", "PLR0913", "PLR0915", "PLR1702"]
[lint.mccabe]
max-complexity = ${POLICY.complexity}
[lint.pylint]
max-args = ${POLICY.maxParams}
max-statements = ${POLICY.maxLinesPerFunction}
max-nested-blocks = ${POLICY.maxDepth}
`;
}

export async function ruffFindings(ctx: CheckContext, input: unknown): Promise<Findings> {
  const report = reportSchema.parse(input);
  const findings = new FindingsBuilder();
  for (const diagnostic of report) {
    const pattern = METRICS[diagnostic.code];
    if (!pattern) return fail(`Unbaselined Ruff code ${diagnostic.code}`);
    const file = relativizeFrom(ctx.root, diagnostic.filename);
    const value = extractMeasurement(pattern, diagnostic.message, diagnostic.code);
    await addAnchoredFinding(ctx, findings, {
      file, rule: diagnostic.code, value, line: diagnostic.location.row,
      column: diagnostic.location.column, blockMode: diagnostic.code === "PLR1702",
    });
  }
  return findings.build();
}

export const ruffAdapter: CheckAdapter = {
  id: "python-complexity", check: "complexity", language: "python",
  tool: { bin: "ruff", version: "0.16.6" },
  applicability: () => ({ kind: "run" }),
  configFiles: () => [{ path: "ruff.toml", content: ruffConfig() }],
  command: (ctx) => ({
    bin: "ruff",
    args: ["check", "--config", join(ctx.tempDir, "ruff.toml"), "--output-format", "json",
      "--no-cache", "--exit-zero", "--exclude", excludeGlobs(ctx.config, true).join(","),
      ...ctx.paths],
    exitCodes: [0],
  }),
  parse: (ctx, result) => ruffFindings(ctx, JSON.parse(result.stdout) as unknown),
};
