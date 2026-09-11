import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ADVISORY_REPORTS } from "../../src/report/advisory.ts";
import { reportCommand } from "../../src/cli/commands/report.ts";
import { runCli } from "../../src/cli/program.ts";
import type { CheckContext, ToolResult } from "../../src/core/types.ts";
import { fakeDeps } from "../helpers/fake-adapter.ts";

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

function reportMessages(output: string): string[] {
  return ["fallow-health", "fallow-dupes", "jscpd-html"]
    .map((id) => `Report ${id}: ${join(output, id)}\n`);
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
      const outputFlag = invocation.args.indexOf("--output");
      const output = outputFlag >= 0 ? invocation.args[outputFlag + 1] : undefined;
      if (output !== undefined) {
        mkdirSync(output, { recursive: true });
        writeFileSync(join(output, "index.html"), "ok", "utf8");
      }
      return result();
    };
    const deps = {
      registry: [], run, env: {}, cwd: root,
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
      const outputFlag = invocation.args.indexOf("--output");
      const output = outputFlag >= 0 ? invocation.args[outputFlag + 1] : undefined;
      if (output !== undefined) {
        mkdirSync(output, { recursive: true });
        writeFileSync(join(output, "index.html"), "ok", "utf8");
      }
      return result();
    };
    const deps = {
      registry: [], run, env: {}, cwd: root,
      stdout: () => {}, stderr: () => {},
    };
    expect(await reportCommand(deps)).toBe(0);
    expect(reportsWithConfig).toEqual(new Set(["fallow-health", "fallow-dupes"]));
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
      const output = invocation.args[invocation.args.indexOf("--output") + 1];
      if (output !== undefined) {
        mkdirSync(output, { recursive: true });
        writeFileSync(join(output, "index.html"), "ok", "utf8");
      }
      return result();
    };
    const deps = {
      registry: [], run, env: {}, cwd: root,
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
      const output = invocation.args[invocation.args.indexOf("--output") + 1];
      if (output !== undefined) {
        mkdirSync(output, { recursive: true });
        writeFileSync(join(output, "index.html"), "ok", "utf8");
      }
      return result();
    };
    const deps = {
      registry: [], run, env: {}, cwd: root,
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
