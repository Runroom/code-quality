import {
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
      stdout: () => {}, stderr: () => {},
    };
    expect(await reportCommand(deps)).toBe(0);
    expect(readFileSync(join(root, "artifacts/quality/fallow-health/fallow-health.json"), "utf8")).toBe("{}");
    run.spawn = () => { throw new Error("tool failed"); };
    expect(await reportCommand({ ...deps, run })).toBe(1);
  });
});
