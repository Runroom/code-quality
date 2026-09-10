import { z } from "zod";

import { FindingsBuilder, parseJsonOutput } from "../shared/kit.ts";
import { requireVendor } from "./vendor.ts";
import type { CheckAdapter, Findings } from "../shared/kit.ts";

const reportSchema = z.strictObject({
  _meta: z.object({
    "composer-require-checker": z.object({
      version: z.string().startsWith("4.24.0"),
    }),
    date: z.string(),
  }),
  "unknown-symbols": z.record(z.string(), z.array(z.string())),
});

export function requireCheckerFindings(input: unknown): Findings {
  const report = reportSchema.parse(input);
  const findings = new FindingsBuilder();
  for (const symbol of Object.keys(report["unknown-symbols"])) {
    findings.add("composer.json", "unknown-symbol", symbol, 1);
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
    args: ["check", "--output=json", "composer.json"],
    cwd: ctx.root,
    exitCodes: [0, 1],
  }),
  parse: (_ctx, result) => Promise.resolve(
    requireCheckerFindings(parseJsonOutput(result.stdout, "composer-require-checker")),
  ),
};
