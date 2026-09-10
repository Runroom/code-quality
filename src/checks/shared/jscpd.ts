import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { findingsSchema } from "../../core/snapshot.ts";
import { excludeGlobs, FindingsBuilder, POLICY } from "./kit.ts";
import type { CheckAdapter, CheckContext, Findings } from "./kit.ts";
import type { Language } from "../../core/types.ts";

const FORMATS: Record<Language, string[]> = {
  ts: ["typescript", "tsx", "javascript", "jsx"],
  php: ["php"],
  python: ["python"],
  web: ["twig", "html", "css", "scss", "less"],
};

const reportSchema = z.looseObject({
  statistics: z.looseObject({
    total: z.looseObject({ sources: z.number().int().nonnegative() }),
  }),
  duplicates: z.array(z.looseObject({ fragment: z.string() })),
});
const baselineSchema = z.strictObject({
  version: z.literal(1),
  fingerprints: findingsSchema,
});

function outputPaths(ctx: CheckContext): [string, string] {
  return [
    join(ctx.artifactDir, "jscpd", "jscpd-report.json"),
    join(ctx.artifactDir, "jscpd-current.json"),
  ];
}

function config(ctx: CheckContext, language: Language): string {
  return JSON.stringify({
    mode: POLICY.duplication.mode,
    minTokens: POLICY.duplication.minTokens,
    minLines: POLICY.duplication.minLines,
    format: FORMATS[language],
    ignore: excludeGlobs(ctx.config, true),
    reporters: ["json"],
    output: join(ctx.artifactDir, "jscpd"),
    noTips: true,
    silent: true,
    absolute: false,
  }, null, 2);
}

export function jscpdFindings(ctx: CheckContext): Findings {
  const [reportFile, baselineFile] = outputPaths(ctx);
  const report = reportSchema.parse(JSON.parse(readFileSync(reportFile, "utf8")));
  const native = baselineSchema.parse(JSON.parse(readFileSync(baselineFile, "utf8")));
  if (report.statistics.total.sources === 0) return {};
  const findings = new FindingsBuilder();
  for (const [fingerprint, count] of Object.entries(native.fingerprints)) {
    findings.addRaw(fingerprint, count);
  }
  return findings.build();
}

export function jscpdAdapter(language: Language): CheckAdapter {
  return {
    id: `${language}-duplication`,
    check: "duplication",
    language,
    tool: { bin: "jscpd", version: "5.2.0" },
    applicability: () => ({ kind: "run" }),
    configFiles: (ctx) => {
      const baseline = outputPaths(ctx)[1];
      if (existsSync(baseline)) rmSync(baseline, { force: true });
      return [{ path: "jscpd.json", content: config(ctx, language) }];
    },
    command: (ctx) => ({
      bin: "jscpd",
      args: [
        "--config", join(ctx.tempDir, "jscpd.json"),
        "--baseline", join(ctx.artifactDir, "jscpd-current.json"),
        "--update-baseline", ...ctx.paths,
      ],
      exitCodes: [0],
    }),
    artifactOutputs: (ctx) => outputPaths(ctx),
    parse: async (ctx) => jscpdFindings(ctx),
  };
}
