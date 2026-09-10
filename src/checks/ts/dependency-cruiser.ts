import { z } from "zod";

import { assertInScope, FindingsBuilder, parseJsonOutput } from "../shared/kit.ts";
import type { CheckAdapter, CheckContext, ParsedFindings } from "../shared/kit.ts";

const reportSchema = z.looseObject({
  summary: z.looseObject({
    violations: z.array(z.looseObject({
      from: z.string(),
      to: z.string(),
      rule: z.looseObject({
        name: z.string(),
        severity: z.enum(["error", "warn", "info", "ignore"]),
      }),
    })),
    totalCruised: z.number().int().positive(),
  }),
});

export function dependencyCruiserFindings(ctx: CheckContext, input: unknown): ParsedFindings {
  const report = reportSchema.parse(input);
  const findings = new FindingsBuilder();
  for (const violation of report.summary.violations) {
    if (violation.rule.severity === "ignore") continue;
    assertInScope(violation.from, ctx.paths);
    findings.add({
      file: violation.from, rule: violation.rule.name, anchor: violation.to, value: 1,
      message: `${violation.from} must not import ${violation.to} (rule ${violation.rule.name})`,
    });
  }
  return findings.build();
}

export const dependencyCruiserAdapter: CheckAdapter = {
  id: "ts-architecture",
  check: "architecture",
  language: "ts",
  tool: { bin: "depcruise", version: "18.2.0" },
  applicability: (config) => {
    const selection = config.architecture.ts;
    return selection?.kind === "file"
      ? { kind: "run" }
      : { kind: "skip", reason: "no .dependency-cruiser.cjs" };
  },
  configFiles: () => [],
  command: (ctx) => {
    const selection = ctx.config.architecture.ts;
    if (selection?.kind !== "file") throw new Error("dependency-cruiser rules file is unavailable");
    return {
      bin: "depcruise",
      args: ["--config", selection.rulesFile, "--output-type", "json", "--no-progress", ...ctx.paths],
      exitCodes: "any",
    };
  },
  parse: (ctx, result) => Promise.resolve(
    dependencyCruiserFindings(ctx, parseJsonOutput(result.stdout, "depcruise", result.stderr)),
  ),
};
