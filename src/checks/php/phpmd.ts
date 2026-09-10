import { join } from "node:path";

import { z } from "zod";

import { addAnchoredFinding, excludeGlobs, extractMeasurement, fail, FindingsBuilder, POLICY, relativizeFrom, xml } from "../shared/kit.ts";
import type { CheckAdapter, CheckContext, Findings } from "../shared/kit.ts";

const phpmdSchema = z.looseObject({
  version: z.string(),
  package: z.literal("phpmd"),
  timestamp: z.string().optional(),
  files: z.array(z.looseObject({
    file: z.string(),
    violations: z.array(z.looseObject({
      beginLine: z.number().int().positive(),
      endLine: z.number().int().positive().optional(),
      package: z.string().optional(),
      class: z.string().nullable().optional(),
      rule: z.string(),
      description: z.string(),
      method: z.string().nullable(),
      function: z.string().nullable(),
      priority: z.number().int().positive().optional(),
    })),
  })),
  errors: z.array(z.looseObject({ fileName: z.string(), message: z.string() })).optional(),
});

const PHPMD_METRICS: Record<string, RegExp> = {
  CyclomaticComplexity: /has a Cyclomatic Complexity of (\d+)\./u,
  ExcessiveMethodLength: /has (\d+) lines of code\./u,
  ExcessiveParameterList: /has (\d+) parameters\./u,
};

function property(name: string, value: string): string {
  return xml("property", { name, value });
}

function rule(ref: string, properties: string[]): string {
  return xml("rule", { ref }, [xml("properties", {}, properties)]);
}

export function phpmdRuleset(): string {
  // PHPMD thresholds are inclusive, so reporting starts one above the policy limit.
  const rules = [
    rule("rulesets/codesize.xml/CyclomaticComplexity", [
      property("reportLevel", String(POLICY.complexity + 1)), property("showClassesComplexity", "false"),
      property("showMethodsComplexity", "true"),
    ]),
    rule("rulesets/codesize.xml/ExcessiveMethodLength", [
      property("minimum", String(POLICY.maxLinesPerFunction + 1)), property("ignore-whitespace", "true"),
    ]),
    rule("rulesets/codesize.xml/ExcessiveParameterList", [
      property("minimum", String(POLICY.maxParams + 1)),
    ]),
  ];
  const attrs = {
    name: "code-quality", xmlns: "http://pmd.sf.net/ruleset/1.0.0",
    "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "xsi:schemaLocation": "http://pmd.sf.net/ruleset/1.0.0 http://pmd.sf.net/ruleset_xml_schema.xsd",
  };
  return `<?xml version="1.0"?>\n${xml("ruleset", attrs, [
    xml("description", {}, ["Runroom complexity policy"]), ...rules,
  ])}\n`;
}

export async function phpmdFindings(ctx: CheckContext, input: unknown): Promise<Findings> {
  const report = phpmdSchema.parse(input);
  if ((report.errors?.length ?? 0) > 0) return fail("PHPMD reported processing errors");
  const findings = new FindingsBuilder();
  for (const entry of report.files) await addFileFindings(ctx, findings, entry);
  return findings.build();
}

async function addFileFindings(
  ctx: CheckContext,
  findings: FindingsBuilder,
  entry: z.infer<typeof phpmdSchema>["files"][number],
): Promise<void> {
  const file = relativizeFrom(ctx.root, entry.file);
  for (const violation of entry.violations) {
    const pattern = PHPMD_METRICS[violation.rule];
    if (!pattern) return fail(`Unbaselined PHPMD rule ${violation.rule}`);
    const value = extractMeasurement(pattern, violation.description, violation.rule);
    await addAnchoredFinding(ctx, findings, {
      file, rule: violation.rule, value, line: violation.beginLine, blockMode: false,
    });
  }
}

export const phpmdAdapter: CheckAdapter = {
  id: "php-complexity-phpmd", check: "complexity", language: "php",
  tool: { bin: "phpmd", version: "2.15.0" },
  applicability: () => ({ kind: "run" }),
  configFiles: () => [{ path: "phpmd-ruleset.xml", content: phpmdRuleset() }],
  command: (ctx) => ({
    bin: "phpmd",
    args: [ctx.paths.join(","), "json", join(ctx.tempDir, "phpmd-ruleset.xml"),
      "--exclude", excludeGlobs(ctx.config, true).join(","), "--ignore-violations-on-exit"],
    exitCodes: [0],
  }),
  parse: (ctx, result) => phpmdFindings(ctx, JSON.parse(result.stdout) as unknown),
};
