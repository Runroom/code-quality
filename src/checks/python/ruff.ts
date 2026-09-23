import { join } from "node:path";

import { z } from "zod";

import { addAnchoredFinding, excludeGlobs, extractMeasurement, fail, FindingsBuilder, parseJsonOutput, POLICY, relativizeFrom } from "../shared/kit.ts";
import type { CheckAdapter, CheckContext, ParsedFindings } from "../shared/kit.ts";
import { compareMajorMinor, PYTHON_314_VERSION, pythonTarget } from "../../core/config/runtime.ts";
import { pythonInvocation } from "./interpreter.ts";

const METRICS: Record<string, RegExp> = {
  C901: new RegExp(`is too complex \\((\\d+) > ${POLICY.complexity}\\)`, "u"),
  PLR0913: new RegExp(`\\((\\d+) > ${POLICY.maxParams}\\)`, "u"),
  PLR0915: new RegExp(`\\((\\d+) > ${POLICY.maxLinesPerFunction}\\)`, "u"),
  PLR1702: new RegExp(`\\((\\d+) > ${POLICY.maxDepth}\\)`, "u"),
};

const MINIMUM_TARGET = "3.10";
const MAXIMUM_TARGET = PYTHON_314_VERSION.split(".").slice(0, 2).join(".");

const reportSchema = z.array(z.looseObject({
  code: z.string().nullable(),
  message: z.string(),
  filename: z.string(),
  location: z.looseObject({
    row: z.number().int().positive(),
    column: z.number().int().positive(),
  }),
}));

export function ruffConfig(target?: string): string {
  const supported = target !== undefined && compareMajorMinor(target, MINIMUM_TARGET) >= 0
    && compareMajorMinor(target, MAXIMUM_TARGET) <= 0;
  const targetVersion = supported
    ? `target-version = "py${target.replace(".", "")}"\n`
    : "";
  return `${targetVersion}[lint]
select = ["C901", "PLR0913", "PLR0915", "PLR1702"]
[lint.mccabe]
max-complexity = ${POLICY.complexity}
[lint.pylint]
max-args = ${POLICY.maxParams}
max-statements = ${POLICY.maxLinesPerFunction}
max-nested-blocks = ${POLICY.maxDepth}
`;
}

export async function ruffFindings(ctx: CheckContext, input: unknown): Promise<ParsedFindings> {
  const report = reportSchema.parse(input);
  const syntaxErrors = report.filter((diagnostic) => diagnostic.code === null);
  if (syntaxErrors.length > 0) {
    const examples = syntaxErrors.slice(0, 3).map((diagnostic) =>
      `${relativizeFrom(ctx.root, diagnostic.filename)}:${diagnostic.location.row} ${diagnostic.message}`
    );
    return fail(
      `Ruff could not parse Python source: ${examples.join("; ")}. `
      + "Hint: set .python-version or requires-python so Ruff targets the right Python version",
    );
  }
  const findings = new FindingsBuilder();
  for (const diagnostic of report) {
    const code = diagnostic.code!;
    const pattern = METRICS[code];
    if (!pattern) return fail(`Unbaselined Ruff code ${code}`);
    const file = relativizeFrom(ctx.root, diagnostic.filename);
    const value = extractMeasurement(pattern, diagnostic.message, code);
    await addAnchoredFinding(ctx, findings, {
      file, rule: code, value, line: diagnostic.location.row,
      column: diagnostic.location.column, message: diagnostic.message,
      blockMode: code === "PLR1702",
    });
  }
  return findings.build();
}

export const ruffAdapter: CheckAdapter = {
  id: "python-complexity", check: "complexity", language: "python",
  tool: { bin: "ruff", version: "0.16.6" },
  applicability: () => ({ kind: "run" }),
  configFiles: (ctx) => [{ path: "ruff.toml", content: ruffConfig(pythonTarget(ctx.root)?.version) }],
  command: (ctx) => pythonInvocation(ctx, {
    bin: "ruff",
    args: ["check", "--config", join(ctx.tempDir, "ruff.toml"), "--output-format", "json",
      "--no-cache", "--exit-zero", "--exclude", excludeGlobs(ctx.config, true).join(","),
      ...ctx.paths],
    exitCodes: [0],
  }),
  parse: (ctx, result) => ruffFindings(
    ctx,
    parseJsonOutput(result.stdout, "ruff", result.stderr),
  ),
};
