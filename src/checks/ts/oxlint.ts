import { join } from "node:path";

import { z } from "zod";

import { addAnchoredFinding, excludeGlobs, extractMeasurement, fail, FindingsBuilder, parseJsonOutput, POLICY, relativize } from "../shared/kit.ts";
import type { CheckAdapter, CheckContext, ParsedFindings } from "../shared/kit.ts";
import type { ResolvedConfig } from "../../core/config/types.ts";

const METRICS: Record<string, { pattern: RegExp; threshold: number; jsxThreshold?: number }> = {
  "eslint(complexity)": {
    pattern: /complexity of (\d+)\./u,
    threshold: POLICY.complexity,
    jsxThreshold: POLICY.jsx.complexity,
  },
  "eslint(max-lines-per-function)": {
    pattern: /too many lines \((\d+)\)/u, threshold: POLICY.maxLinesPerFunction,
    jsxThreshold: POLICY.jsx.maxLinesPerFunction,
  },
  "eslint(max-params)": { pattern: /too many parameters \((\d+)\)/u, threshold: POLICY.maxParams },
  "eslint(max-depth)": { pattern: /nested too deeply \((\d+)\)/u, threshold: POLICY.maxDepth },
  "eslint(max-nested-callbacks)": {
    pattern: /(?:callbacks|deeply) \((\d+)\)/u, threshold: POLICY.maxNestedCallbacks,
  },
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
    overrides: [{
      files: ["**/*.tsx", "**/*.jsx"],
      rules: {
        complexity: ["warn", POLICY.jsx.complexity],
        "max-lines-per-function": ["warn", {
          max: POLICY.jsx.maxLinesPerFunction,
          skipBlankLines: true,
          skipComments: true,
        }],
      },
    }],
  }, null, 2);
}

function metricThreshold(
  metric: { threshold: number; jsxThreshold?: number },
  file: string,
): number {
  return /\.(?:tsx|jsx)$/u.test(file) ? metric.jsxThreshold ?? metric.threshold : metric.threshold;
}

export async function oxlintFindings(ctx: CheckContext, input: unknown): Promise<ParsedFindings> {
  const report = reportSchema.parse(input);
  if (report.number_of_files === 0) return fail("oxlint scanned no files");
  const findings = new FindingsBuilder();
  for (const diagnostic of report.diagnostics) {
    const metric = METRICS[diagnostic.code];
    if (!metric || diagnostic.severity !== "warning") {
      return fail(
        `Unbaselined diagnostic: ${diagnostic.filename} ${diagnostic.code}: ${diagnostic.message}`,
      );
    }
    const file = relativize(ctx.root, diagnostic.filename);
    const threshold = metricThreshold(metric, file);
    const value = extractMeasurement(metric.pattern, diagnostic.message, diagnostic.code);
    if (value <= threshold) return fail(`${diagnostic.code} is below policy threshold ${threshold}`);
    const blockMode = diagnostic.code === "eslint(max-depth)";
    await addAnchoredFinding(ctx, findings, {
      file, rule: diagnostic.code,
      value,
      offset: diagnostic.labels[0]!.span.offset, blockMode,
      symbol: SYMBOL.exec(diagnostic.message)?.[1],
      message: diagnostic.message, threshold,
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
