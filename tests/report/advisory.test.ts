import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ADVISORY_REPORTS, coverageIgnorePattern } from "../../src/report/advisory.ts";
import { reportCommand } from "../../src/cli/commands/report.ts";
import { runCli } from "../../src/cli/program.ts";
import type { CheckContext, ToolInvocation, ToolResult } from "../../src/core/types.ts";
import { fakeDeps } from "../helpers/fake-adapter.ts";
import { createStyle } from "../../src/cli/style.ts";

const style = createStyle(false);

const roots: string[] = [];

function configRoot(language: "ts" | "php" | "python"): string {
  const root = mkdtempSync(join(tmpdir(), "code-quality-report-"));
  roots.push(root);
  mkdirSync(join(root, "src"));
  const source = language === "python" ? "src/index.py" : language === "php" ? "src/index.php" : "src/index.ts";
  const manifest = language === "ts"
    ? "package.json"
    : language === "php" ? "composer.json" : "pyproject.toml";
  writeFileSync(join(root, manifest), "{}", "utf8");
  writeFileSync(join(root, source), "", "utf8");
  return root;
}

function context(root: string, language: "ts" | "php" | "python"): CheckContext {
  return {
    root,
    language,
    paths: ["src"],
    tempDir: join(root, "tmp"),
    artifactDir: join(root, "artifacts"),
    config: {
      root,
      isDrupal: false,
      languages: [language],
      paths: { [language]: ["src"] },
      exclude: [],
      disabled: [],
      architecture: {},
      notices: [],
      configHash: "a".repeat(64),
    },
    readSource: () => "",
    anchor: { anchor: async () => "/" },
    notice: () => {},
  };
}

function result(stdout = "{}"): ToolResult {
  return { stdout, stderr: "", exitCode: 0 };
}

function writeHtmlOutput(invocation: ToolInvocation): void {
  const outputFlag = invocation.args.indexOf("--output");
  if (outputFlag < 0) return;
  const output = invocation.args[outputFlag + 1]!;
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "index.html"), "ok", "utf8");
}

function reportMessages(output: string): string[] {
  const ids = ["fallow-health", "fallow-dupes", "jscpd-html"];
  const idWidth = Math.max(...ids.map((id) => id.length), 0);
  return ids.map((id) => ` ✔ ${id.padEnd(idWidth)}  ${join(output, id)}\n`);
}

function writeCoverage(root: string, file: string, key = "src/index.ts"): string {
  const path = join(root, file);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify({ [key]: { path: key, s: {}, f: {}, fnMap: {} } }), "utf8");
  return path;
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

describe("advisory reports", () => {
  it("selects the documented reports by language", () => {
    expect(ADVISORY_REPORTS.filter((report) => report.languages.includes("ts")).map((report) => report.id)).toEqual([
      "fallow-health", "fallow-dupes", "jscpd-html",
    ]);
    expect(ADVISORY_REPORTS.filter((report) => report.languages.includes("python")).map((report) => report.id)).toEqual([
      "jscpd-html", "complexipy-json",
    ]);
    expect(ADVISORY_REPORTS.filter((report) => report.languages.includes("php")).map((report) => report.id)).toEqual([
      "jscpd-html",
    ]);
  });

  it("validates JSON reports and generated HTML output", () => {
    const root = configRoot("ts");
    const ctx = context(root, "ts");
    const health = ADVISORY_REPORTS.find((report) => report.id === "fallow-health")!;
    const dupes = ADVISORY_REPORTS.find((report) => report.id === "fallow-dupes")!;
    const html = ADVISORY_REPORTS.find((report) => report.id === "jscpd-html")!;
    expect(() => health.validate(ctx, result("not-json"))).toThrow("Invalid");
    expect(() => dupes.validate(ctx, result("not-json"))).toThrow("Invalid");
    expect(() => html.validate(ctx, result())).toThrow("Missing");
    mkdirSync(join(ctx.artifactDir, "jscpd-html"), { recursive: true });
    writeFileSync(join(ctx.artifactDir, "jscpd-html", "index.html"), "ok", "utf8");
    expect(() => html.validate(ctx, result())).not.toThrow();
  });

  it("runs valid reports and returns one when a tool fails", async () => {
    const root = configRoot("ts");
    const run = fakeDeps();
    const messages: string[] = [];
    run.verify = () => {};
    run.spawn = (invocation) => {
      writeHtmlOutput(invocation);
      return result();
    };
    const deps = {
      registry: [], run, env: {}, cwd: root, style,
      stdout: (value: string) => messages.push(value), stderr: () => {},
    };
    expect(await reportCommand(deps)).toBe(0);
    const defaultOutput = join(root, "artifacts/quality");
    expect(readFileSync(join(defaultOutput, "fallow-health/fallow-health.json"), "utf8")).toBe("{}");
    expect(messages).toEqual(reportMessages(defaultOutput));
    messages.length = 0;
    expect(await runCli(["node", "code-quality", "report", "--output", "reports"], deps)).toBe(0);
    const customOutput = join(root, "reports");
    expect(readFileSync(join(customOutput, "fallow-health/fallow-health.json"), "utf8")).toBe("{}");
    expect(messages).toEqual(reportMessages(customOutput));
    run.spawn = () => { throw new Error("tool failed"); };
    expect(await reportCommand({ ...deps, run })).toBe(1);
  });
});

describe("fallow advisory invocations", () => {
  it("passes exact option-only invocations to fallow", () => {
    const ctx = context(configRoot("ts"), "ts");
    const health = ADVISORY_REPORTS.find((report) => report.id === "fallow-health")!.command(ctx);
    expect(health.args).toEqual([
      "health", "--production", "--complexity", "--report-only", "--no-cache", "--quiet",
      "--format", "json", "--config", join(ctx.tempDir, "fallowrc.json"),
    ]);
    expect(health.exitCodes).toEqual([0]);
    expect(health.env).toBeUndefined();
    const dupes = ADVISORY_REPORTS.find((report) => report.id === "fallow-dupes")!.command(ctx);
    expect(dupes.args).toEqual([
      "dupes", "--mode", "semantic", "--threshold", "0", "--format", "json", "--quiet", "--no-cache",
      "--config", join(ctx.tempDir, "fallowrc.json"),
    ]);
    expect(dupes.env).toBeUndefined();
    const html = ADVISORY_REPORTS.find((report) => report.id === "jscpd-html")!.command(ctx);
    expect(html.args.at(-1)).toBe("src");
  });

  it("passes coverage and a derived root to health with exit code 2 allowed", () => {
    const ctx = context(configRoot("ts"), "ts");
    const health = ADVISORY_REPORTS.find((report) => report.id === "fallow-health")!.command(ctx, {
      coverage: { file: "/repo/coverage/coverage-final.json", root: "/home/runner/work/app/app" },
    });
    expect(health.args).toEqual([
      "health", "--production", "--complexity", "--report-only", "--no-cache", "--quiet",
      "--format", "json", "--config", join(ctx.tempDir, "fallowrc.json"),
      "--coverage", "/repo/coverage/coverage-final.json",
      "--coverage-root", "/home/runner/work/app/app",
    ]);
    expect(health.exitCodes).toEqual([0, 2]);
  });
});

describe("fallow advisory validation", () => {
  it("rejects fallow error envelopes and accepts valid JSON", () => {
    const ctx = context(configRoot("ts"), "ts");
    for (const id of ["fallow-health", "fallow-dupes"]) {
      const report = ADVISORY_REPORTS.find((candidate) => candidate.id === id)!;
      expect(() => report.validate(ctx, result('{"error":true,"message":"boom"}'))).toThrow("boom");
      expect(() => report.validate(ctx, result("{}"))).not.toThrow();
    }
  });

  it("adds an Istanbul hint to coverage errors", () => {
    const ctx = context(configRoot("ts"), "ts");
    const health = ADVISORY_REPORTS.find((report) => report.id === "fallow-health")!;
    expect(() => health.validate(ctx, result(JSON.stringify({
      error: true,
      message: "coverage: failed to parse coverage data",
    })))).toThrow(/fallow needs an Istanbul coverage map.*raw V8 output is not supported/u);
  });
});

describe("fallow advisory configuration", () => {
  it("writes the fallow config before both reports run", async () => {
    const root = configRoot("ts");
    const run = fakeDeps();
    const reportsWithConfig = new Set<string>();
    run.verify = () => {};
    run.spawn = (invocation) => {
      if (invocation.bin === "fallow") {
        const configPath = invocation.args[invocation.args.indexOf("--config") + 1]!;
        expect(existsSync(configPath)).toBe(true);
        const config = JSON.parse(readFileSync(configPath, "utf8")) as { ignorePatterns: unknown };
        expect(Array.isArray(config.ignorePatterns)).toBe(true);
        expect(config.ignorePatterns).toContain("artifacts/**");
        reportsWithConfig.add(invocation.args[0] === "health" ? "fallow-health" : "fallow-dupes");
      }
      writeHtmlOutput(invocation);
      return result();
    };
    const deps = {
      registry: [], run, env: {}, cwd: root, style,
      stdout: () => {}, stderr: () => {},
    };
    expect(await reportCommand(deps)).toBe(0);
    expect(reportsWithConfig).toEqual(new Set(["fallow-health", "fallow-dupes"]));
  });

  it("lets the flag beat config and excludes the coverage directory", async () => {
    const root = configRoot("ts");
    writeFileSync(join(root, ".code-quality.yml"), "report:\n  coverage: configured/map.json\n", "utf8");
    writeCoverage(root, "configured/map.json");
    const flagged = writeCoverage(root, "flagged/map.json");
    const run = fakeDeps();
    let health: ToolInvocation | undefined;
    run.verify = () => {};
    run.spawn = (invocation) => {
      if (invocation.bin === "fallow") {
        const configPath = invocation.args[invocation.args.indexOf("--config") + 1]!;
        const config = JSON.parse(readFileSync(configPath, "utf8")) as { ignorePatterns: string[] };
        expect(config.ignorePatterns).toContain("flagged/**");
        if (invocation.args[0] === "health") health = invocation;
      }
      writeHtmlOutput(invocation);
      return result();
    };
    const command = {
      registry: [], run, env: {}, cwd: root, style,
      stdout: () => {}, stderr: () => {},
    };
    expect(await reportCommand(command, { coverage: "flagged/map.json" })).toBe(0);
    expect(health?.args).toContain(realpathSync(flagged));
    expect(health?.args).not.toContain(join(root, "configured/map.json"));
    expect(health?.exitCodes).toEqual([0, 2]);
  });
});

describe("fallow coverage exclusion", () => {
  it("selects a directory or file pattern based on scan-path overlap", () => {
    expect(coverageIgnorePattern("/repo", "/repo/src/coverage.json", ["src"]))
      .toBe("src/coverage.json");
    expect(coverageIgnorePattern("/repo", "/repo/coverage/coverage-final.json", ["src"]))
      .toBe("coverage/**");
    expect(coverageIgnorePattern("/repo", "/repo/coverage-final.json", ["src"]))
      .toBe("coverage-final.json");
  });

  it("excludes the coverage file itself when placed at the repository root", async () => {
    const root = configRoot("ts");
    writeCoverage(root, "coverage-final.json");
    const run = fakeDeps();
    run.verify = () => {};
    run.spawn = (invocation) => {
      if (invocation.bin === "fallow") {
        const configPath = invocation.args[invocation.args.indexOf("--config") + 1]!;
        const config = JSON.parse(readFileSync(configPath, "utf8")) as { ignorePatterns: string[] };
        expect(config.ignorePatterns).toContain("coverage-final.json");
        expect(config.ignorePatterns).not.toContain("./**");
      }
      writeHtmlOutput(invocation);
      return result();
    };
    const command = {
      registry: [], run, env: {}, cwd: root, style,
      stdout: () => {}, stderr: () => {},
    };
    expect(await reportCommand(command, { coverage: "coverage-final.json" })).toBe(0);
  });
});

describe("coverage notices", () => {
  it.each([
    ["zero", 0],
    ["absent", undefined],
  ] as const)("prints a notice for a %s match count before report rows", async (_label, matched) => {
    const root = configRoot("ts");
    writeCoverage(root, "coverage/coverage-final.json");
    const run = fakeDeps();
    const messages: string[] = [];
    run.verify = () => {};
    run.spawn = (invocation) => {
      writeHtmlOutput(invocation);
      if (invocation.bin === "fallow" && invocation.args[0] === "health") {
        const summary = matched === undefined ? {} : { istanbul_files_matched: matched };
        return result(JSON.stringify({ findings: [], summary }));
      }
      return result();
    };
    const command = {
      registry: [], run, env: {}, cwd: root, style,
      stdout: (value: string) => messages.push(value), stderr: () => {},
    };
    expect(await reportCommand(command, { coverage: "coverage/coverage-final.json" })).toBe(0);
    expect(messages[0]).toBe(" ● Notice: coverage matched no repository file; CRAP stays estimated\n");
    expect(messages.slice(1)).toEqual(reportMessages(join(root, "artifacts/quality")));
  });

  it("soft-fails unmatched paths without passing a coverage root", async () => {
    const root = configRoot("ts");
    const key = "/foreign/project/src/missing.ts";
    const file = writeCoverage(root, "coverage/coverage-final.json", key);
    const run = fakeDeps();
    const messages: string[] = [];
    let health: ToolInvocation | undefined;
    run.verify = () => {};
    run.spawn = (invocation) => {
      writeHtmlOutput(invocation);
      if (invocation.bin === "fallow" && invocation.args[0] === "health") health = invocation;
      return result();
    };
    const command = {
      registry: [], run, env: {}, cwd: root, style,
      stdout: (value: string) => messages.push(value), stderr: () => {},
    };
    expect(await reportCommand(command, { coverage: "coverage/coverage-final.json" })).toBe(0);
    expect(health?.args).toContain(realpathSync(file));
    expect(health?.args).not.toContain("--coverage-root");
    expect(messages.filter((message) => message.includes("CRAP stays estimated"))).toEqual([
      ` ● Notice: coverage paths such as ${key} do not match files under ${root}; CRAP stays estimated\n`,
    ]);
    expect(messages[0]).toContain("coverage paths such as");
  });
});

describe("coverage applicability notices", () => {
  it("reports when no selected language has a fallow-health report", async () => {
    const root = configRoot("php");
    writeCoverage(root, "coverage/coverage-final.json", "src/index.php");
    const run = fakeDeps();
    const messages: string[] = [];
    run.verify = () => {};
    run.spawn = (invocation) => {
      writeHtmlOutput(invocation);
      return result();
    };
    const command = {
      registry: [], run, env: {}, cwd: root, style,
      stdout: (value: string) => messages.push(value), stderr: () => {},
    };
    expect(await reportCommand(command, { coverage: "coverage/coverage-final.json" })).toBe(0);
    expect(messages[0]).toBe(
      " ● Notice: coverage ignored: no fallow-health report for the detected languages\n",
    );
  });
});

describe("coverage root resolution", () => {
  it("passes a root derived by reportCommand to fallow health", async () => {
    const root = configRoot("ts");
    const coverageRoot = "/home/runner/work/app/app";
    const file = writeCoverage(
      root,
      "coverage/coverage-final.json",
      `${coverageRoot}/src/index.ts`,
    );
    const run = fakeDeps();
    let health: ToolInvocation | undefined;
    run.verify = () => {};
    run.spawn = (invocation) => {
      writeHtmlOutput(invocation);
      if (invocation.bin === "fallow" && invocation.args[0] === "health") health = invocation;
      return result();
    };
    const command = {
      registry: [], run, env: {}, cwd: root, style,
      stdout: () => {}, stderr: () => {},
    };
    expect(await reportCommand(command, { coverage: "coverage/coverage-final.json" })).toBe(0);
    expect(health?.args).toEqual(expect.arrayContaining([
      "--coverage", realpathSync(file), "--coverage-root", coverageRoot,
    ]));
  });
});

describe("fallow advisory scope", () => {
  it("scopes fallow artifacts and preserves error output", async () => {
    const root = configRoot("ts");
    const run = fakeDeps();
    run.verify = () => {};
    run.spawn = (invocation) => {
      if (invocation.bin === "fallow" && invocation.args[0] === "health") {
        return result(JSON.stringify({
          kind: "health",
          findings: [
            { path: "src/a.ts", name: "a" }, { path: "fixtures/x.ts", name: "x" },
          ],
          summary: { files_analyzed: 2 },
        }));
      }
      if (invocation.bin === "fallow") {
        return result(JSON.stringify({
          kind: "dupes",
          clone_groups: [
            { instances: [{ file: "src/a.ts" }, { file: "src/b.ts" }] },
            { instances: [{ file: "fixtures/x.ts" }, { file: "fixtures/y.ts" }] },
            { instances: [{ file: "src/a.ts" }, { file: "fixtures/x.ts" }] },
          ],
          clone_families: [
            { files: ["src/a.ts", "src/b.ts"] }, { files: ["fixtures/x.ts"] },
          ],
        }));
      }
      writeHtmlOutput(invocation);
      return result();
    };
    const deps = {
      registry: [], run, env: {}, cwd: root, style,
      stdout: () => {}, stderr: () => {},
    };
    expect(await reportCommand(deps)).toBe(0);
    const output = join(root, "artifacts/quality");
    const health = JSON.parse(readFileSync(join(output, "fallow-health/fallow-health.json"), "utf8")) as {
      findings: { path: string }[]; summary: { files_analyzed: number };
    };
    expect(health.findings.map((finding) => finding.path)).toEqual(["src/a.ts"]);
    expect(health.summary.files_analyzed).toBe(2);
    const dupesPath = join(output, "fallow-dupes/fallow-dupes.json");
    const dupes = JSON.parse(readFileSync(dupesPath, "utf8")) as {
      clone_groups: unknown[]; clone_families: unknown[];
    };
    expect(dupes.clone_groups).toHaveLength(2);
    expect(dupes.clone_families).toHaveLength(1);
    expect(readFileSync(join(output, "fallow-dupes/stdout.log"), "utf8"))
      .toBe(readFileSync(dupesPath, "utf8"));
    const error = '{"error":true,"message":"boom"}';
    run.spawn = (invocation) => invocation.bin === "fallow" ? result(error) : result();
    expect(await reportCommand(deps)).toBe(1);
    expect(readFileSync(join(output, "fallow-health/fallow-health.json"), "utf8")).toBe(error);
  });
});

describe("fallow advisory passthrough", () => {
  it("writes invalid and unknown health output verbatim", async () => {
    const root = configRoot("ts");
    const run = fakeDeps();
    let healthOutput = "not-json";
    run.verify = () => {};
    run.spawn = (invocation) => {
      if (invocation.bin === "fallow" && invocation.args[0] === "health") return result(healthOutput);
      writeHtmlOutput(invocation);
      return result();
    };
    const deps = {
      registry: [], run, env: {}, cwd: root, style,
      stdout: () => {}, stderr: () => {},
    };
    const healthPath = join(root, "artifacts/quality/fallow-health/fallow-health.json");
    expect(await reportCommand(deps)).toBe(1);
    expect(readFileSync(healthPath, "utf8")).toBe(healthOutput);
    healthOutput = '{"kind":"other"}';
    expect(await reportCommand(deps)).toBe(0);
    expect(readFileSync(healthPath, "utf8")).toBe(healthOutput);
    expect(readFileSync(join(root, "artifacts/quality/fallow-health/stdout.log"), "utf8"))
      .toBe(healthOutput);
  });
});
