import { join } from "node:path";

import { z } from "zod";

import { addAnchoredFinding, excludeGlobs, extractMeasurement, fail, FindingsBuilder, parseJsonOutput, POLICY, relativize } from "../shared/kit.ts";
import type { CheckAdapter, CheckContext, Findings } from "../shared/kit.ts";
import type { ResolvedConfig } from "../../core/config/types.ts";

const METRICS: Record<string, RegExp> = {
  "eslint(complexity)": /complexity of (\d+)\./u,
  "eslint(max-params)": /too many parameters \((\d+)\)/u,
  "eslint(max-lines-per-function)": /too many lines \((\d+)\)/u,
  "eslint(max-depth)": /nested too deeply \((\d+)\)/u,
  "eslint(max-nested-callbacks)": /(?:callbacks|deeply) \((\d+)\)/u,
};
const SYMBOL = /(?:Function|Method) ['"]([^'"]+)['"]/u;

const reportSchema = z.looseObject({
  number_of_files: z.number().int().nonnegative(),
  diagnostics: z.array(z.looseObject({
    code: z.string(),
    message: z.string(),
    filename: z.string(),
    severity: z.string(),
    labels: z.array(z.looseObject({
      span: z.looseObject({ offset: z.number().int().nonnegative() }),
    })).min(1),
  })),
});

export function oxlintConfig(_config: ResolvedConfig): string {
  return JSON.stringify({
    plugins: ["typescript", "react"],
    categories: {
      correctness: "off", suspicious: "off", pedantic: "off", perf: "off",
      style: "off", restriction: "off", nursery: "off",
    },
    rules: {
      complexity: ["warn", POLICY.complexity],
      "max-lines-per-function": ["warn", {
        max: POLICY.maxLinesPerFunction,
        skipBlankLines: true,
        skipComments: true,
      }],
      "max-params": ["warn", POLICY.maxParams],
      "max-depth": ["warn", POLICY.maxDepth],
      "max-nested-callbacks": ["warn", POLICY.maxNestedCallbacks],
    },
  }, null, 2);
}

export async function oxlintFindings(ctx: CheckContext, input: unknown): Promise<Findings> {
  const report = reportSchema.parse(input);
  if (report.number_of_files === 0) return fail("oxlint scanned no files");
  const findings = new FindingsBuilder();
  for (const diagnostic of report.diagnostics) {
    const pattern = METRICS[diagnostic.code];
    if (!pattern || diagnostic.severity !== "warning") {
      return fail(
        `Unbaselined diagnostic: ${diagnostic.filename} ${diagnostic.code}: ${diagnostic.message}`,
      );
    }
    const file = relativize(ctx.root, diagnostic.filename);
    const blockMode = diagnostic.code === "eslint(max-depth)";
    await addAnchoredFinding(ctx, findings, {
      file, rule: diagnostic.code,
      value: extractMeasurement(pattern, diagnostic.message, diagnostic.code),
      offset: diagnostic.labels[0]!.span.offset, blockMode,
      symbol: SYMBOL.exec(diagnostic.message)?.[1],
    });
  }
  return findings.build();
}

export const oxlintAdapter: CheckAdapter = {
  id: "ts-complexity",
  check: "complexity",
  language: "ts",
  tool: { bin: "oxlint", version: "1.82.0" },
  applicability: () => ({ kind: "run" }),
  configFiles: (ctx) => [{
    path: "oxlintrc.quality.json",
    content: oxlintConfig(ctx.config),
  }],
  command: (ctx) => ({
    bin: "oxlint",
    args: ["-c", join(ctx.tempDir, "oxlintrc.quality.json"),
      ...excludeGlobs(ctx.config, true).flatMap((glob) => ["--ignore-pattern", glob]),
      "--format", "json", ...ctx.paths],
    exitCodes: [0],
  }),
  parse: (ctx, result) => oxlintFindings(
    ctx,
    parseJsonOutput(result.stdout, "oxlint", result.stderr),
  ),
};
