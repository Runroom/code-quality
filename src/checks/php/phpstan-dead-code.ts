import { join } from "node:path";

import { z } from "zod";

import { addAnchoredFinding, excludeGlobs, fail, FindingsBuilder, parseJsonOutput, relativizeFrom } from "../shared/kit.ts";
import { requireVendor } from "./vendor.ts";
import type { CheckAdapter, CheckContext, ParsedFindings } from "../shared/kit.ts";

const reportSchema = z.looseObject({
  totals: z.looseObject({ errors: z.number().int(), file_errors: z.number().int() }),
  files: z.record(z.string(), z.looseObject({
    messages: z.array(z.looseObject({
      message: z.string(), line: z.number().int().positive(), identifier: z.string(),
      ignorable: z.boolean().optional(), tip: z.string().optional(),
    })),
  })),
  errors: z.array(z.string()),
});

const DEAD_CODE_MEMBER = /^(?:Unused|Property|Constant|Method|Enum case)?\s*(\S+)::(\$?\w+)/u;

function neonList(values: readonly string[]): string {
  return values.map((value) => `            - ${JSON.stringify(value)}`).join("\n");
}

function phpstanConfig(ctx: CheckContext): string {
  const paths = ctx.paths.map((path) => join(ctx.root, path));
  const excludes = excludeGlobs(ctx.config, true).map((path) => join(ctx.root, path));
  return `includes:\n    - /opt/php/phpstan/vendor/shipmonk/dead-code-detector/rules.neon\n`
    + `parameters:\n    customRulesetUsed: true\n    paths:\n${neonList(paths)}\n`
    + `    excludePaths:\n        analyseAndScan:\n${neonList(excludes)}\n`
    + `    tmpDir: ${JSON.stringify(join(ctx.tempDir, "phpstan-cache"))}\n`
    + "    reportUnmatchedIgnoredErrors: false\n";
}

export async function phpstanFindings(ctx: CheckContext, input: unknown): Promise<ParsedFindings> {
  const report = reportSchema.parse(input);
  if (report.errors.length > 0) return fail(`PHPStan errors: ${report.errors.join("; ")}`);
  const findings = new FindingsBuilder();
  for (const [nativeFile, entry] of Object.entries(report.files)) {
    await addMessages(ctx, findings, nativeFile, entry.messages);
  }
  return findings.build();
}

async function addMessages(
  ctx: CheckContext,
  findings: FindingsBuilder,
  nativeFile: string,
  messages: z.infer<typeof reportSchema>["files"][string]["messages"],
): Promise<void> {
  const file = relativizeFrom(ctx.root, nativeFile);
  for (const message of messages) {
    if (!/^shipmonk\.dead[A-Za-z]+(\.[A-Za-z]+)*$/u.test(message.identifier)) {
      return fail(`Unbaselined PHPStan diagnostic ${message.identifier}`);
    }
    const member = DEAD_CODE_MEMBER.exec(message.message)?.[2];
    if (member === undefined) {
      return fail(`Unbaselined PHPStan diagnostic shape: ${message.message}`);
    }
    await addAnchoredFinding(ctx, findings, {
      file, rule: "dead-code", value: 1, line: message.line, blockMode: false,
      anchorSuffix: `#${message.identifier}#${member}`, symbol: member,
      message: message.message,
    });
  }
}

export const phpstanDeadCodeAdapter: CheckAdapter = {
  id: "php-unused-phpstan", check: "unused", language: "php",
  tool: { bin: "phpstan", version: "2.2.13" },
  applicability: (config) => config.isDrupal
    ? {
      kind: "skip",
      reason: "Drupal project: PHPStan dead-code analysis is skipped "
        + "(the project's own PHPStan extensions are incompatible with the image)",
    }
    : requireVendor(config),
  configFiles: (ctx) => [{ path: "phpstan.neon", content: phpstanConfig(ctx) }],
  command: (ctx) => ({
    bin: "phpstan",
    args: ["analyse", "--configuration", join(ctx.tempDir, "phpstan.neon"),
      "--error-format=json", "--no-progress", "--no-interaction", "--memory-limit=1G"],
    cwd: ctx.root,
    exitCodes: [0, 1],
  }),
  parse: (ctx, result) => phpstanFindings(
    ctx,
    parseJsonOutput(result.stdout, "phpstan", result.stderr),
  ),
};
