import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
import { sanitizeLine } from "../cli/render.ts";

export interface AdvisoryReport {
  id: string;
  languages: Language[];
  command(ctx: CheckContext): ToolInvocation;
  validate(ctx: CheckContext, result: ToolResult): void;
}

type FallowReportId = "fallow-health" | "fallow-dupes";

const FALLOW_ARTIFACTS: Record<FallowReportId, string> = {
  "fallow-health": "fallow-health.json",
  "fallow-dupes": "fallow-dupes.json",
};

const fallowHealthReportSchema = z.looseObject({
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
  if (error.success) return fail(`${name} failed: ${error.data.message}`);
}

function fallowReportId(id: string): FallowReportId | undefined {
  if (id === "fallow-health" || id === "fallow-dupes") return id;
  return undefined;
}

function scopedFallowReport(
  ctx: CheckContext,
  stdout: string,
  reportId: FallowReportId,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return stdout;
  }
  if (fallowErrorSchema.safeParse(parsed).success) return stdout;
  // Summary counters stay project-wide on purpose; only per-item arrays are scoped.
  if (reportId === "fallow-health") {
    const report = fallowHealthReportSchema.safeParse(parsed);
    if (!report.success) return stdout;
    try {
      report.data.findings = report.data.findings.filter((finding) =>
        isInScope(relativize(ctx.root, finding.path), ctx.paths),
      );
      return JSON.stringify(report.data);
    } catch {
      return stdout;
    }
  }
  const report = fallowDupesReportSchema.safeParse(parsed);
  if (!report.success) return stdout;
  try {
    report.data.clone_groups = report.data.clone_groups.filter((group) =>
      group.instances.some((instance) => isInScope(relativize(ctx.root, instance.file), ctx.paths)),
    );
    if (report.data.clone_families !== undefined) {
      report.data.clone_families = report.data.clone_families.filter((family) =>
        family.files.some((file) => isInScope(relativize(ctx.root, file), ctx.paths)),
      );
    }
    return JSON.stringify(report.data);
  } catch {
    return stdout;
  }
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

function fallowHealthCommand(ctx: CheckContext): ToolInvocation {
  // The gate uses CLI thresholds 0 and isInScope; reports use config thresholds 10/15 and filter the artifact likewise.
  return {
    bin: "fallow",
    args: [
      "health", "--production", "--complexity", "--report-only", "--no-cache", "--quiet",
      "--format", "json", "--config", join(ctx.tempDir, "fallowrc.json"),
    ],
    exitCodes: [0],
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

function runReport(report: AdvisoryReport, config: ResolvedConfig, deps: ReportDeps): string {
  let directory = "";
  withTempDir((tempDir) => {
    const language = report.languages.find((candidate) => config.languages.includes(candidate));
    if (language === undefined) return fail(`No selected language for report '${report.id}'`);
    const context = reportContext({
      config, language, tempDir, output: deps.output, report, anchor: deps.run.anchor,
    });
    directory = context.artifactDir;
    if (report.id.startsWith("fallow-")) {
      writeGenerated(tempDir, [{ path: "fallowrc.json", content: fallowConfig(context) }]);
    }
    const invocation = report.command(context);
    deps.run.verify(reportTool(invocation));
    const result = deps.run.spawn(invocation, config.root);
    const id = fallowReportId(report.id);
    const scoped = id === undefined
      ? result.stdout
      : scopedFallowReport(context, result.stdout, id);
    writeFileSync(join(context.artifactDir, "stdout.log"), scoped, "utf8");
    writeFileSync(join(context.artifactDir, "stderr.log"), result.stderr, "utf8");
    if (id !== undefined) {
      writeFileSync(outputPath(context, FALLOW_ARTIFACTS[id]), scoped, "utf8");
    }
    report.validate(context, result);
  });
  return directory;
}

export async function reportCommand(deps: ReportDeps): Promise<number> {
  try {
    const config = loadConfig(deps.cwd);
    const reports = selectedReports(config);
    const completed = reports.map((report) => ({ id: report.id, directory: runReport(report, config, deps) }));
    const idWidth = Math.max(...completed.map((report) => report.id.length), 0);
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
