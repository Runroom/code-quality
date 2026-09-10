import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

import { z } from "zod";

import { findingsSchema, readSnapshot } from "../../core/snapshot.ts";
import { baselineFile } from "../../core/types.ts";
import { excludeGlobs, FindingsBuilder, POLICY, relativize } from "./kit.ts";
import type { CheckAdapter, CheckContext, GeneratedFile, ParsedFindings } from "./kit.ts";
import type { DuplicateDetail, Findings, Language } from "../../core/types.ts";

const FORMATS: Record<Language, string[]> = {
  ts: ["typescript", "tsx", "javascript", "jsx"],
  php: ["php"],
  python: ["python"],
  web: ["twig", "html", "css", "scss", "less"],
};

const fileLocationSchema = z.looseObject({
  name: z.string(),
  startLoc: z.looseObject({ line: z.number().int().positive() }),
  endLoc: z.looseObject({ line: z.number().int().positive() }),
});
const reportSchema = z.looseObject({
  statistics: z.looseObject({
    total: z.looseObject({ sources: z.number().int().nonnegative() }),
  }),
  duplicates: z.array(z.looseObject({
    firstFile: fileLocationSchema,
    secondFile: fileLocationSchema,
    lines: z.number().int().positive(),
    tokens: z.number().int().positive(),
    isNew: z.boolean(),
  })),
});
const baselineSchema = z.strictObject({
  version: z.literal(1),
  fingerprints: findingsSchema,
});

function outputPaths(ctx: CheckContext): [string, string] {
  return [
    join(ctx.artifactDir, "jscpd", "jscpd-report.json"),
    join(ctx.tempDir, "jscpd-current.json"),
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
    absolute: true,
  }, null, 2);
}

function readBaselineFindings(file: string): Findings | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return readSnapshot(file).findings;
  } catch {
    return undefined;
  }
}

function generatedFiles(ctx: CheckContext, language: Language, id: string): GeneratedFile[] {
  const files = [{ path: "jscpd.json", content: config(ctx, language) }];
  const findings = readBaselineFindings(join(ctx.root, baselineFile(id)));
  if (!findings) return files;
  const content = { version: 1, fingerprints: findings };
  files.push({ path: "jscpd-current.json", content: `${JSON.stringify(content, null, 2)}\n` });
  return files;
}

function reportFileName(root: string, name: string): string {
  if (!isAbsolute(name)) return relativize(root, name);
  const fromRoot = relative(root, name);
  if (fromRoot === ".." || fromRoot.startsWith("../") || isAbsolute(fromRoot)) return name;
  return relativize(root, name);
}

function duplicateDetail(ctx: CheckContext, duplicate: z.infer<typeof reportSchema>["duplicates"][number]): DuplicateDetail {
  return {
    file: reportFileName(ctx.root, duplicate.firstFile.name),
    line: duplicate.firstFile.startLoc.line,
    endLine: duplicate.firstFile.endLoc.line,
    secondFile: reportFileName(ctx.root, duplicate.secondFile.name),
    secondLine: duplicate.secondFile.startLoc.line,
    secondEndLine: duplicate.secondFile.endLoc.line,
    lines: duplicate.lines,
    tokens: duplicate.tokens,
    isNew: duplicate.isNew,
  };
}

function compareDuplicates(left: DuplicateDetail, right: DuplicateDetail): number {
  const firstFile = left.file < right.file ? -1 : left.file > right.file ? 1 : 0;
  const secondFile = left.secondFile < right.secondFile
    ? -1 : left.secondFile > right.secondFile ? 1 : 0;
  return firstFile || left.line - right.line || secondFile || left.secondLine - right.secondLine;
}

export function jscpdFindings(ctx: CheckContext): ParsedFindings {
  const [reportFile, nativeBaselineFile] = outputPaths(ctx);
  const report = reportSchema.parse(JSON.parse(readFileSync(reportFile, "utf8")));
  const native = baselineSchema.parse(JSON.parse(readFileSync(nativeBaselineFile, "utf8")));
  if (report.statistics.total.sources === 0) return { findings: {}, details: {} };
  const findings = new FindingsBuilder();
  for (const [fingerprint, count] of Object.entries(native.fingerprints)) {
    findings.addRaw(fingerprint, count);
  }
  findings.setDuplicates(report.duplicates.map((item) => duplicateDetail(ctx, item))
    .toSorted(compareDuplicates));
  return findings.build();
}

export function jscpdAdapter(language: Language): CheckAdapter {
  return {
    id: `${language}-duplication`,
    check: "duplication",
    language,
    tool: { bin: "jscpd", version: "5.2.0" },
    applicability: () => ({ kind: "run" }),
    configFiles: (ctx) => generatedFiles(ctx, language, `${language}-duplication`),
    command: (ctx) => ({
      bin: "jscpd",
      args: [
        "--config", join(ctx.tempDir, "jscpd.json"),
        "--baseline", join(ctx.tempDir, "jscpd-current.json"),
        "--update-baseline", ...ctx.paths,
      ],
      exitCodes: [0],
    }),
    artifactOutputs: (ctx) => outputPaths(ctx),
    parse: async (ctx) => jscpdFindings(ctx),
  };
}
