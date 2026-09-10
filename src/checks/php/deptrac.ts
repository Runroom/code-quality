import { z } from "zod";

import { addAnchoredFinding, fail, FindingsBuilder, relativizeFrom, toolOutput } from "../shared/kit.ts";
import type { CheckAdapter, CheckContext, Findings } from "../shared/kit.ts";

const messageSchema = z.looseObject({
  message: z.string(), line: z.number().int().positive(),
  type: z.enum(["error", "warning"]),
});

const deptracSchema = z.looseObject({
  Report: z.looseObject({
    Violations: z.number().int(),
    "Skipped violations": z.number().int(),
    Uncovered: z.number().int(),
    Allowed: z.number().int(),
    Warnings: z.number().int(),
    Errors: z.number().int(),
  }),
  files: z.record(z.string(), z.looseObject({
    violations: z.number().int(),
    messages: z.array(messageSchema),
  })).optional(),
});

const MESSAGE = /^(\S+) must not depend on (\S+) \((\S+) on (\S+)\)$/u;

export async function deptracFindings(ctx: CheckContext, input: unknown): Promise<Findings> {
  const report = deptracSchema.parse(input);
  const findings = new FindingsBuilder();
  let errors = 0;
  for (const [nativeFile, entry] of Object.entries(report.files ?? {})) {
    errors += await addMessages(ctx, findings, nativeFile, entry.messages);
  }
  if (errors !== report.Report.Violations) {
    return fail(`Deptrac violation count mismatch: report ${report.Report.Violations}, parsed ${errors}`);
  }
  return findings.build();
}

async function addMessages(
  ctx: CheckContext,
  findings: FindingsBuilder,
  nativeFile: string,
  messages: Array<z.infer<typeof messageSchema>>,
): Promise<number> {
  let errors = 0;
  const file = relativizeFrom(ctx.root, nativeFile);
  for (const diagnostic of messages) {
    if (diagnostic.type === "warning") continue;
    const match = MESSAGE.exec(diagnostic.message);
    if (!match) return fail(`Unknown deptrac message shape: ${diagnostic.message}`);
    await addAnchoredFinding(ctx, findings, {
      file, rule: `deptrac:${match[3]}-on-${match[4]}`, value: 1,
      line: diagnostic.line, blockMode: false, fallbackAnchor: match[1],
    });
    errors += 1;
  }
  return errors;
}

export const deptracAdapter: CheckAdapter = {
  id: "php-architecture", check: "architecture", language: "php",
  tool: { bin: "deptrac", version: "4.7.1" },
  applicability: (config) => config.architecture.php?.kind === "file"
    ? { kind: "run" } : { kind: "skip", reason: "no deptrac.yaml" },
  configFiles: (ctx) => toolOutput(ctx, "deptrac.json").clear(),
  command: (ctx) => {
    const selection = ctx.config.architecture.php;
    if (selection?.kind !== "file") throw new Error("deptrac rules file is unavailable");
    return {
      bin: "deptrac",
      args: ["analyse", "--config-file", selection.rulesFile, "--formatter=json",
        `--output=${toolOutput(ctx, "deptrac.json").path}`, "--no-progress", "--no-interaction"],
      exitCodes: [0, 1],
    };
  },
  artifactOutputs: (ctx) => toolOutput(ctx, "deptrac.json").outputs(),
  parse: (ctx) => deptracFindings(
    ctx, JSON.parse(toolOutput(ctx, "deptrac.json").read("deptrac")) as unknown,
  ),
};
