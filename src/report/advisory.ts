import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { z } from "zod";

import { isInScope, relativize } from "../checks/shared/paths.ts";
import { fail } from "../core/errors.ts";
import { loadConfig } from "../core/config/load.ts";
import { artifactDir } from "../core/runner/artifacts.ts";
import { withTempDir, writeGenerated } from "../core/runner/temp.ts";
import { fallowConfig, fallowErrorSchema } from "../checks/ts/fallow.ts";
import { TOOL_PINS } from "../registry.ts";
import { POLICY } from "../core/config/policy.ts";
import type { CheckContext, Language, ToolInvocation, ToolResult } from "../core/types.ts";
import type { ResolvedConfig } from "../core/config/types.ts";
import type { ReportDeps } from "./types.ts";
import { GLYPH } from "../cli/style.ts";
import { renderNotice, sanitizeLine } from "../cli/render.ts";
import { resolveCoverage } from "./coverage.ts";

type CoverageInput = ReturnType<typeof resolveCoverage>;

interface ReportRunOptions {
  coverage?: CoverageInput;
}

export interface AdvisoryReport {
  id: string;
  languages: Language[];
  command(ctx: CheckContext, options?: ReportRunOptions): ToolInvocation;
  validate(ctx: CheckContext, result: ToolResult): void;
}

type FallowReportId = "fallow-health" | "fallow-dupes";

const FALLOW_ARTIFACTS: Record<FallowReportId, string> = {
  "fallow-health": "fallow-health.json",
  "fallow-dupes": "fallow-dupes.json",
};

const fallowHealthReportSchema = z.looseObject({
  summary: z.looseObject({
    istanbul_files_matched: z.number().int().nonnegative().optional(),
  }).optional(),
  findings: z.array(z.looseObject({ path: z.string() })),
});

const fallowDupesReportSchema = z.looseObject({
  clone_groups: z.array(z.looseObject({
    instances: z.array(z.looseObject({ file: z.string() })),
  })),
  clone_families: z.array(z.looseObject({
    files: z.array(z.string()),
  })).optional(),
});

function jsonValue(value: string, name: string): void {
  try {
    JSON.parse(value);
  } catch {
    return fail(`Invalid ${name} report JSON`);
  }
}

function fallowJsonValue(value: string, name: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return fail(`Invalid ${name} report JSON`);
  }
  const error = fallowErrorSchema.safeParse(parsed);
  if (error.success) {
    const hint = error.data.message.startsWith("coverage:")
      ? " - fallow needs an Istanbul coverage map (the coverage-final.json written by the vitest "
        + "or jest json reporter, v8 or istanbul provider); raw V8 output is not supported"
      : "";
    return fail(`${name} failed: ${error.data.message}${hint}`);
  }
}

function fallowReportId(id: string): FallowReportId | undefined {
  if (id === "fallow-health" || id === "fallow-dupes") return id;
  return undefined;
}

interface ScopedFallowReport {
  body: string;
  istanbulFilesMatched?: number;
}

function scopedHealthReport(ctx: CheckContext, parsed: unknown, stdout: string): ScopedFallowReport {
  const report = fallowHealthReportSchema.safeParse(parsed);
  if (!report.success) return { body: stdout };
  try {
    report.data.findings = report.data.findings.filter((finding) =>
      isInScope(relativize(ctx.root, finding.path), ctx.paths),
    );
    const matched = report.data.summary?.istanbul_files_matched;
    return {
      body: JSON.stringify(report.data),
      ...(matched === undefined ? {} : { istanbulFilesMatched: matched }),
    };
  } catch {
    return { body: stdout };
  }
}

function scopedDupesReport(ctx: CheckContext, parsed: unknown, stdout: string): ScopedFallowReport {
  const report = fallowDupesReportSchema.safeParse(parsed);
  if (!report.success) return { body: stdout };
  try {
    report.data.clone_groups = report.data.clone_groups.filter((group) =>
      group.instances.some((instance) => isInScope(relativize(ctx.root, instance.file), ctx.paths)),
    );
    if (report.data.clone_families !== undefined) {
      report.data.clone_families = report.data.clone_families.filter((family) =>
        family.files.some((file) => isInScope(relativize(ctx.root, file), ctx.paths)),
      );
    }
    return { body: JSON.stringify(report.data) };
  } catch {
    return { body: stdout };
  }
}

function scopedFallowReport(
  ctx: CheckContext,
  stdout: string,
  reportId: FallowReportId,
): ScopedFallowReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { body: stdout };
  }
  if (fallowErrorSchema.safeParse(parsed).success) return { body: stdout };
  // Summary counters stay project-wide on purpose; only per-item arrays are scoped.
  return reportId === "fallow-health"
    ? scopedHealthReport(ctx, parsed, stdout)
    : scopedDupesReport(ctx, parsed, stdout);
}

function outputPath(ctx: CheckContext, name: string): string {
  return join(ctx.artifactDir, name);
}

function configPaths(config: ResolvedConfig): string[] {
  return config.languages.flatMap((language) => config.paths[language] ?? []);
}

function reportPaths(ctx: CheckContext): string[] {
  return configPaths(ctx.config);
}

function fallowHealthCommand(ctx: CheckContext, options: ReportRunOptions = {}): ToolInvocation {
  // The gate uses CLI thresholds 0 and isInScope; reports use config thresholds 10/15 and filter the artifact likewise.
  return {
    bin: "fallow",
    args: [
      "health", "--production", "--complexity", "--report-only", "--no-cache", "--quiet",
      "--format", "json", "--config", join(ctx.tempDir, "fallowrc.json"),
      ...(options.coverage === undefined ? [] : ["--coverage", options.coverage.file]),
      ...(options.coverage?.root === undefined ? [] : ["--coverage-root", options.coverage.root]),
    ],
    exitCodes: options.coverage === undefined ? [0] : [0, 2],
  };
}

function reportJson(ctx: CheckContext, result: ToolResult, name: string): string {
  const file = outputPath(ctx, name);
  return existsSync(file) ? readFileSync(file, "utf8") : result.stdout;
}

function fallowHealthValidate(ctx: CheckContext, result: ToolResult): void {
  fallowJsonValue(reportJson(ctx, result, "fallow-health.json"), "fallow health");
}

function fallowDupesCommand(ctx: CheckContext): ToolInvocation {
  return {
    bin: "fallow",
    // fallow health/dupes take no positional paths; they scan the project root.
    args: [
      "dupes", "--mode", POLICY.advisoryDuplication.mode, "--threshold", "0", "--format", "json", "--quiet",
      "--no-cache", "--config", join(ctx.tempDir, "fallowrc.json"),
    ],
    exitCodes: [0],
  };
}

function fallowDupesValidate(ctx: CheckContext, result: ToolResult): void {
  fallowJsonValue(reportJson(ctx, result, "fallow-dupes.json"), "fallow dupes");
}

function jscpdHtmlCommand(ctx: CheckContext): ToolInvocation {
  return {
    bin: "jscpd",
    args: [
      "--mode", POLICY.duplication.mode, "--min-tokens", String(POLICY.duplication.minTokens),
      "--min-lines", String(POLICY.duplication.minLines), "--reporters", "html",
      "--output", outputPath(ctx, "jscpd-html"), ...reportPaths(ctx),
    ],
    exitCodes: [0],
  };
}

function jscpdHtmlValidate(ctx: CheckContext, _result: ToolResult): void {
  const file = outputPath(ctx, "jscpd-html");
  if (!existsSync(file)) return fail(`Missing jscpd HTML report '${file}'`);
}

function complexipyJsonCommand(ctx: CheckContext): ToolInvocation {
  return {
    bin: "complexipy",
    args: [
      "--output-format", "json", "--output", outputPath(ctx, "complexipy.json"), ...reportPaths(ctx),
    ],
    exitCodes: [0, 1],
  };
}

function complexipyJsonValidate(ctx: CheckContext, _result: ToolResult): void {
  const file = outputPath(ctx, "complexipy.json");
  if (!existsSync(file)) return fail(`Missing complexipy JSON report '${file}'`);
  jsonValue(readFileSync(file, "utf8"), "complexipy");
}

export const ADVISORY_REPORTS: readonly AdvisoryReport[] = [
  { id: "fallow-health", languages: ["ts"], command: fallowHealthCommand, validate: fallowHealthValidate },
  { id: "fallow-dupes", languages: ["ts"], command: fallowDupesCommand, validate: fallowDupesValidate },
  { id: "jscpd-html", languages: ["ts", "php", "python"], command: jscpdHtmlCommand, validate: jscpdHtmlValidate },
  { id: "complexipy-json", languages: ["python"], command: complexipyJsonCommand, validate: complexipyJsonValidate },
];

interface ContextInput {
  config: ResolvedConfig;
  language: Language;
  tempDir: string;
  output: string;
  report: AdvisoryReport;
  anchor: CheckContext["anchor"];
}

function reportContext(input: ContextInput): CheckContext {
  const { config, language, tempDir, output, report, anchor } = input;
  return {
    root: config.root,
    config,
    language,
    paths: configPaths(config),
    tempDir,
    artifactDir: artifactDir(output, report.id),
    readSource: (file) => readFileSync(join(config.root, file), "utf8"),
    anchor,
    notice: () => {},
  };
}

function reportTool(invocation: ToolInvocation): { bin: string; version: string } {
  const pin = TOOL_PINS.find((candidate) => candidate.bin === invocation.bin);
  if (pin === undefined) return fail(`No pinned version for advisory tool '${invocation.bin}'`);
  return pin;
}

function selectedReports(config: ResolvedConfig): AdvisoryReport[] {
  return ADVISORY_REPORTS.filter((report) =>
    report.languages.some((language) => config.languages.includes(language)),
  );
}

function portable(path: string): string {
  return path.replaceAll("\\", "/");
}

export function coverageIgnorePattern(
  root: string,
  file: string,
  scanPaths: readonly string[],
): string {
  const relativeFile = portable(relative(root, file));
  const directory = portable(relative(root, dirname(file)));
  const overlaps = scanPaths.some((path) => {
    const scanPath = portable(path);
    return scanPath === "." || directory === scanPath || directory.startsWith(`${scanPath}/`) ||
      scanPath.startsWith(`${directory}/`);
  });
  return directory === "" || overlaps ? relativeFile : `${directory}/**`;
}

function writeReportConfig(
  report: AdvisoryReport,
  context: CheckContext,
  options: ReportRunOptions,
): void {
  if (!report.id.startsWith("fallow-")) return;
  const extraIgnorePatterns = options.coverage === undefined
    ? []
    : [coverageIgnorePattern(realpathSync(context.root), options.coverage.file, context.paths)];
  writeGenerated(context.tempDir, [{
    path: "fallowrc.json",
    content: fallowConfig(context, extraIgnorePatterns),
  }]);
}

function writeFallowArtifact(context: CheckContext, id: FallowReportId | undefined, value: string): void {
  if (id !== undefined) writeFileSync(outputPath(context, FALLOW_ARTIFACTS[id]), value, "utf8");
}

function runReport(
  report: AdvisoryReport,
  config: ResolvedConfig,
  deps: ReportDeps,
  options: ReportRunOptions,
): { directory: string; coverageUnmatched: boolean } {
  let directory = "";
  let coverageUnmatched = false;
  withTempDir((tempDir) => {
    const language = report.languages.find((candidate) => config.languages.includes(candidate));
    if (language === undefined) return fail(`No selected language for report '${report.id}'`);
    const context = reportContext({
      config, language, tempDir, output: deps.output, report, anchor: deps.run.anchor,
    });
    directory = context.artifactDir;
    writeReportConfig(report, context, options);
    const invocation = report.command(context, options);
    deps.run.verify(reportTool(invocation));
    const result = deps.run.spawn(invocation, config.root);
    const id = fallowReportId(report.id);
    const scoped = id === undefined
      ? { body: result.stdout }
      : scopedFallowReport(context, result.stdout, id);
    writeFileSync(join(context.artifactDir, "stdout.log"), scoped.body, "utf8");
    writeFileSync(join(context.artifactDir, "stderr.log"), result.stderr, "utf8");
    writeFallowArtifact(context, id, scoped.body);
    report.validate(context, result);
    coverageUnmatched = report.id === "fallow-health" && options.coverage !== undefined &&
      (scoped.istanbulFilesMatched ?? 0) === 0;
  });
  return { directory, coverageUnmatched };
}

function resolveReportCoverage(config: ResolvedConfig, deps: ReportDeps): CoverageInput | undefined {
  const coverageValue = deps.coverage ?? config.report?.coverage;
  if (coverageValue === undefined) return undefined;
  return resolveCoverage(config.root, coverageValue);
}

function coverageNotice(
  coverage: CoverageInput | undefined,
  reports: readonly AdvisoryReport[],
  completed: readonly { coverageUnmatched: boolean }[],
  root: string,
): string | undefined {
  if (coverage === undefined) return undefined;
  if (!reports.some((report) => report.id === "fallow-health")) {
    return "coverage ignored: no fallow-health report for the detected languages";
  }
  if (coverage.unmatchedKey !== undefined) {
    return `coverage paths such as ${coverage.unmatchedKey} do not match files under ${root}; CRAP stays estimated`;
  }
  return completed.some((report) => report.coverageUnmatched)
    ? "coverage matched no repository file; CRAP stays estimated"
    : undefined;
}

export async function reportCommand(deps: ReportDeps): Promise<number> {
  try {
    const config = loadConfig(deps.cwd);
    const coverage = resolveReportCoverage(config, deps);
    const reports = selectedReports(config);
    const options = coverage === undefined ? {} : { coverage };
    const completed = reports.map((report) => ({ id: report.id, ...runReport(report, config, deps, options) }));
    const idWidth = Math.max(...completed.map((report) => report.id.length), 0);
    const notice = coverageNotice(coverage, reports, completed, config.root);
    if (notice !== undefined) deps.stdout(`${renderNotice(notice, deps.style)}\n`);
    for (const report of completed) {
      deps.stdout(` ${deps.style.green(GLYPH.pass)} ${sanitizeLine(report.id).padEnd(idWidth)}  `
        + `${deps.style.dim(sanitizeLine(report.directory))}\n`);
    }
    return 0;
  } catch (error) {
    deps.stderr(`${sanitizeLine(error instanceof Error ? error.message : String(error))}\n`);
    return 1;
  }
}
