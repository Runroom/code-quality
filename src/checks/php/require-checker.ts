import { z } from "zod";

import { FindingsBuilder, parseJsonOutput } from "../shared/kit.ts";
import { requireVendor } from "./vendor.ts";
import type { CheckAdapter, ParsedFindings } from "../shared/kit.ts";

const reportSchema = z.strictObject({
  _meta: z.object({
    "composer-require-checker": z.object({
      version: z.string().startsWith("4.24.0"),
    }),
    date: z.string(),
  }),
  "unknown-symbols": z.record(z.string(), z.array(z.string())),
});

export function requireCheckerFindings(input: unknown): ParsedFindings {
  const report = reportSchema.parse(input);
  const findings = new FindingsBuilder();
  for (const symbol of Object.keys(report["unknown-symbols"])) {
    findings.add({ file: "composer.json", rule: "unknown-symbol", anchor: symbol, value: 1,
      message: `unknown symbol '${symbol}'`,
    });
  }
  return findings.build();
}

export const requireCheckerAdapter: CheckAdapter = {
  id: "php-unused-require-checker", check: "unused", language: "php",
  tool: { bin: "composer-require-checker", version: "4.24.0" },
  applicability: requireVendor,
  configFiles: () => [],
  command: (ctx) => ({
    bin: "composer-require-checker",
    args: ["check", "--ignore-parse-errors", "--output=json", "composer.json"],
    cwd: ctx.root,
    exitCodes: [0, 1],
  }),
  parse: (ctx, result) => {
    const output = `${result.stdout}\n${result.stderr}`;
    if (result.exitCode !== 0
      && output.includes("There were no symbols found, please check your configuration")) {
      ctx.notice(
        "composer-require-checker found no symbols to analyse "
          + "(composer.json autoload does not cover the configured paths); check skipped",
      );
      return Promise.resolve({ findings: {}, details: {} });
    }
    return Promise.resolve(
      requireCheckerFindings(
        parseJsonOutput(result.stdout, "composer-require-checker", result.stderr),
      ),
    );
  },
};
