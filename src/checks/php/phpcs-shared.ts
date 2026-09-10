import { z } from "zod";

import { addAnchoredFinding, excludeGlobs, extractMeasurement, fail, FindingsBuilder, relativizeFrom, xml } from "../shared/kit.ts";
import type { CheckContext, Findings, ToolInvocation } from "../shared/kit.ts";

const phpcsSchema = z.looseObject({
  totals: z.looseObject({
    errors: z.number().int(), warnings: z.number().int(), fixable: z.number().int().optional(),
  }),
  files: z.record(z.string(), z.looseObject({
    errors: z.number().int().optional(),
    warnings: z.number().int().optional(),
    messages: z.array(z.looseObject({
      message: z.string(), source: z.string(), type: z.enum(["ERROR", "WARNING"]),
      line: z.number().int().positive(), column: z.number().int().positive(),
      severity: z.number().int().optional(), fixable: z.boolean().optional(),
    })),
  })),
});

export interface PhpcsRule {
  sources: Readonly<Record<string, string>>;
  measure: RegExp;
  ruleLabel: string;
  minimumExclusive?: number;
}

export function phpcsRuleset(name: string, rules: string): string {
  const installed = xml("config", {
    name: "installed_paths", value: "/opt/php/phpcs/vendor/slevomat/coding-standard",
  });
  const extensions = xml("arg", { name: "extensions", value: "php" });
  return `<?xml version="1.0"?>\n${xml("ruleset", { name }, [installed, extensions, rules])}\n`;
}

export function phpcsCommand(ctx: CheckContext, rulesetFile: string): ToolInvocation {
  return {
    bin: "phpcs",
    args: ["--report=json", `--standard=${rulesetFile}`,
      `--ignore=${excludeGlobs(ctx.config, true).join(",")}`, "-q", ...ctx.paths],
    exitCodes: [0, 1, 2],
  };
}

export async function phpcsFindings(
  ctx: CheckContext,
  input: unknown,
  rule: PhpcsRule,
): Promise<Findings> {
  const report = phpcsSchema.parse(input);
  const findings = new FindingsBuilder();
  for (const [nativeFile, entry] of Object.entries(report.files)) {
    await addMessages(ctx, findings, { nativeFile, messages: entry.messages }, rule);
  }
  return findings.build();
}

async function addMessages(
  ctx: CheckContext,
  findings: FindingsBuilder,
  entry: {
    nativeFile: string;
    messages: z.infer<typeof phpcsSchema>["files"][string]["messages"];
  },
  rule: PhpcsRule,
): Promise<void> {
  const file = relativizeFrom(ctx.root, entry.nativeFile);
  for (const message of entry.messages) {
    if (message.source.startsWith("Internal.")) continue;
    if (!Object.hasOwn(rule.sources, message.source)) {
      return fail(`Unbaselined PHPCS source ${message.source}`);
    }
    if (rule.sources[message.source] !== message.type) {
      return fail(`Unexpected PHPCS severity for ${message.source}: ${message.type}`);
    }
    const value = extractMeasurement(rule.measure, message.message, message.source);
    if (rule.minimumExclusive !== undefined && value <= rule.minimumExclusive) {
      return fail(`${message.source} is below policy threshold ${rule.minimumExclusive}`);
    }
    await addAnchoredFinding(ctx, findings, {
      file, rule: rule.ruleLabel, value, line: message.line,
      column: message.column, blockMode: false,
    });
  }
}
