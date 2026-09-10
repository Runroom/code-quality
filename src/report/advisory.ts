import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fail } from "../core/errors.ts";
import { loadConfig } from "../core/config/load.ts";
import { artifactDir } from "../core/runner/artifacts.ts";
import { withTempDir, writeGenerated } from "../core/runner/temp.ts";
import { TOOL_PINS } from "../registry.ts";
import { POLICY } from "../core/config/policy.ts";
import type { CheckContext, Language, ToolInvocation, ToolResult } from "../core/types.ts";
import type { ResolvedConfig } from "../core/config/types.ts";
import type { ReportDeps } from "./types.ts";

export interface AdvisoryReport {
  id: string;
  languages: Language[];
  command(ctx: CheckContext): ToolInvocation;
  validate(ctx: CheckContext, result: ToolResult): void;
}

const FALLBACK_CONFIG = JSON.stringify({
  health: { maxCyclomatic: POLICY.complexity, maxCognitive: POLICY.cognitive },
  duplicates: POLICY.advisoryDuplication,
}, null, 2);

function jsonValue(value: string, name: string): void {
  try {
    JSON.parse(value);
  } catch {
    return fail(`Invalid ${name} report JSON`);
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
  return {
    bin: "fallow",
    args: [
      "health", "--production", "--complexity", "--report-only", "--no-cache", "--quiet",
      "--format", "json", "--config", join(ctx.tempDir, "fallowrc.json"), ...reportPaths(ctx),
    ],
    exitCodes: [0],
  };
}

function reportJson(ctx: CheckContext, result: ToolResult, name: string): string {
  const file = outputPath(ctx, name);
  return existsSync(file) ? readFileSync(file, "utf8") : result.stdout;
}

function fallowHealthValidate(ctx: CheckContext, result: ToolResult): void {
  jsonValue(reportJson(ctx, result, "fallow-health.json"), "fallow health");
}

function fallowDupesCommand(ctx: CheckContext): ToolInvocation {
  return {
    bin: "fallow",
    args: ["dupes", "--mode", POLICY.advisoryDuplication.mode,
      "--format", "json", ...reportPaths(ctx)],
    exitCodes: [0],
  };
}

function fallowDupesValidate(ctx: CheckContext, result: ToolResult): void {
  jsonValue(reportJson(ctx, result, "fallow-dupes.json"), "fallow dupes");
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
  report: AdvisoryReport;
  anchor: CheckContext["anchor"];
}

function reportContext(input: ContextInput): CheckContext {
  const { config, language, tempDir, report, anchor } = input;
  return {
    root: config.root,
    config,
    language,
    paths: configPaths(config),
    tempDir,
    artifactDir: artifactDir(config.root, report.id),
    readSource: (file) => readFileSync(join(config.root, file), "utf8"),
    anchor,
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

function runReport(report: AdvisoryReport, config: ResolvedConfig, deps: ReportDeps): void {
  withTempDir((tempDir) => {
    const language = report.languages.find((candidate) => config.languages.includes(candidate));
    if (language === undefined) return fail(`No selected language for report '${report.id}'`);
    const context = reportContext({ config, language, tempDir, report, anchor: deps.run.anchor });
    if (report.id === "fallow-health") {
      writeGenerated(tempDir, [{ path: "fallowrc.json", content: FALLBACK_CONFIG }]);
    }
    const invocation = report.command(context);
    deps.run.verify(reportTool(invocation));
    const result = deps.run.spawn(invocation, config.root);
    writeFileSync(join(context.artifactDir, "stdout.log"), result.stdout, "utf8");
    writeFileSync(join(context.artifactDir, "stderr.log"), result.stderr, "utf8");
    if (report.id === "fallow-health") {
      writeFileSync(outputPath(context, "fallow-health.json"), result.stdout, "utf8");
    }
    if (report.id === "fallow-dupes") {
      writeFileSync(outputPath(context, "fallow-dupes.json"), result.stdout, "utf8");
    }
    report.validate(context, result);
  });
}

export async function reportCommand(deps: ReportDeps): Promise<number> {
  try {
    const config = loadConfig(deps.cwd);
    const reports = selectedReports(config);
    for (const report of reports) runReport(report, config, deps);
    return 0;
  } catch (error) {
    deps.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
