import { z } from "zod";

import { excludeGlobs, FindingsBuilder, parseJsonOutput } from "../shared/kit.ts";
import { requireVendor } from "./vendor.ts";
import type { CheckAdapter, CheckContext, ParsedFindings } from "../shared/kit.ts";

const reportSchema = z.strictObject({
  "used-packages": z.array(z.object({ name: z.string() })).optional(),
  "unused-packages": z.array(z.string()).optional(),
  "ignored-packages": z.array(z.string()).optional(),
  "zombie-exclusions": z.array(z.string()).optional(),
});

export function composerUnusedFindings(input: unknown): ParsedFindings {
  const report = reportSchema.parse(input);
  const findings = new FindingsBuilder();
  for (const name of report["unused-packages"] ?? []) {
    findings.add({ file: "composer.json", rule: "unused-package", anchor: name, value: 1,
      message: `unused package '${name}'`,
    });
  }
  for (const filter of report["zombie-exclusions"] ?? []) {
    findings.add({ file: "composer.json", rule: "zombie-exclusion", anchor: filter, value: 1,
      message: `zombie exclusion '${filter}'`,
    });
  }
  return findings.build();
}

function topLevelExcludes(ctx: CheckContext): string[] {
  const directories = excludeGlobs(ctx.config, true)
    .map((glob) => glob.replace(/^\*\*\//u, "").split("/")[0])
    .filter((value): value is string => value !== undefined && value.length > 0
      && !value.includes("*"));
  return [...new Set(directories)];
}

export const composerUnusedAdapter: CheckAdapter = {
  id: "php-unused-composer-unused", check: "unused", language: "php",
  tool: { bin: "composer-unused", version: "0.9.6" },
  applicability: requireVendor,
  configFiles: () => [],
  command: (ctx) => ({
    bin: "composer-unused",
    args: ["--output-format=json", "--no-progress", "--no-interaction", "--ignore-exit-code",
      ...topLevelExcludes(ctx).flatMap((path) => ["--excludeDir", path]), "composer.json"],
    cwd: ctx.root,
    exitCodes: [0],
  }),
  parse: (_ctx, result) => Promise.resolve(
    composerUnusedFindings(parseJsonOutput(result.stdout, "composer-unused", result.stderr)),
  ),
};
