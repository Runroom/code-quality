import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { runCli } from "../../src/cli/program.ts";
import type { CliDeps } from "../../src/cli/deps.ts";
import { fakeAdapter, fakeDeps } from "../helpers/fake-adapter.ts";
import { TOOL_PINS } from "../../src/registry.ts";

const roots: string[] = [];

function consumer(): string {
  const root = mkdtempSync(join(tmpdir(), "code-quality-cli-"));
  roots.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/index.ts"), "", "utf8");
  writeFileSync(join(root, "package.json"), "{}", "utf8");
  return root;
}

function deps(root: string, registry = defaultRegistry()): CliDeps {
  return {
    registry,
    run: fakeDeps(),
    env: {},
    cwd: root,
    stdout: (value) => outputs.push(value),
    stderr: (value) => errors.push(value),
  };
}

function defaultRegistry() {
  return [
    fakeAdapter({ id: "ts-alpha", check: "complexity" }),
    fakeAdapter({ id: "ts-beta", check: "complexity" }),
    fakeAdapter({ id: "ts-gamma", check: "unused" }),
  ];
}

let outputs: string[] = [];
let errors: string[] = [];

afterEach(() => {
  outputs = [];
  errors = [];
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

describe("CLI program", () => {
  it("initializes and checks all fake adapters", async () => {
    const root = consumer();
    const command = deps(root);

    expect(await runCli(["node", "code-quality", "check", "--initialize"], command)).toBe(0);
    expect(readdirSync(join(root, "quality"))).toHaveLength(3);
    expect(await runCli(["node", "code-quality", "check"], command)).toBe(0);
    expect(outputs.at(-1)).toBe("code-quality: PASS\n");
  });

  it("reports unknown IDs and incompatible or guarded modes", async () => {
    const root = consumer();
    const command = deps(root);

    expect(await runCli(["node", "code-quality", "check", "lint"], command)).toBe(1);
    expect(errors.join(" ")).toContain("Unknown check id 'lint'");
    errors = [];
    expect(await runCli(["node", "code-quality", "check", "--update", "--initialize"], command)).toBe(1);
    expect(errors.join(" ")).toContain("mutually exclusive");
    errors = [];
    command.env = { GITHUB_ACTIONS: "true" };
    expect(await runCli(["node", "code-quality", "baseline"], command)).toBe(1);
    expect(errors.join(" ")).toContain("Refusing `baseline`");
  });

  it.each([
    ["check --update", ["check", "--update"]],
    ["check --initialize", ["check", "--initialize"]],
    ["init", ["init"]],
  ])("refuses %s when GITHUB_ACTIONS is true", async (_label, args) => {
    const command = deps(consumer());
    command.env = { GITHUB_ACTIONS: "true" };
    expect(await runCli(["node", "code-quality", ...args], command)).toBe(1);
    expect(errors.join(" ")).toContain("Refusing");
  });

  it("summarizes an earlier adapter when a later adapter regresses", async () => {
    const root = consumer();
    const first = deps(root);
    expect(await runCli(["node", "code-quality", "check", "--initialize"], first)).toBe(0);
    const second = deps(root, [
      fakeAdapter({ id: "ts-alpha", check: "complexity" }),
      fakeAdapter({ id: "ts-beta", check: "complexity", findings: { regression: 2 } }),
      fakeAdapter({ id: "ts-gamma", check: "unused" }),
    ]);
    expect(await runCli(["node", "code-quality", "check"], second)).toBe(1);
    expect(outputs.join(" ")).toContain("### ts-alpha");
    expect(errors.join(" ")).toContain("ts-beta regressions");
  });

});

describe("CLI parser and summary failures", () => {
  it("formats adapter parser zod errors with the adapter id", async () => {
    const root = consumer();
    const invalid = fakeAdapter({ id: "ts-invalid" });
    invalid.parse = async () => {
      z.object({ statistics: z.object({ total: z.object({ sources: z.number() }) }) })
        .parse({ statistics: { total: { sources: "nope" } } });
      return {};
    };

    expect(await runCli(["node", "code-quality", "check", "--initialize"], deps(root, [invalid]))).toBe(1);
    expect(errors.join(" ")).toContain(
      "ts-invalid: unexpected native output: statistics.total.sources",
    );
    expect(errors.join(" ")).not.toContain('"issues"');
  });

  it("omits summaries when a baseline is missing", async () => {
    const root = consumer();
    expect(await runCli(["node", "code-quality", "check"], deps(root))).toBe(1);
    expect(outputs.join(" ")).not.toContain("Remaining:");
    expect(errors.join(" ")).toContain("quality/ts-alpha-baseline.json is missing");
  });
});

describe("CLI gate aggregation", () => {
  it("records an adapter exception and continues with remaining adapters", async () => {
    const root = consumer();
    const broken = fakeAdapter({ id: "ts-broken" });
    broken.parse = async () => { throw new Error("invalid JSON"); };
    const command = deps(root, [broken, fakeAdapter({ id: "ts-after" })]);

    expect(await runCli(["node", "code-quality", "check", "--initialize"], command)).toBe(1);
    expect(errors.join(" ")).toContain("ts-broken: invalid JSON");
    expect(outputs.join(" ")).toContain("ts-after");
    expect(existsSync(join(root, "quality/ts-after-baseline.json"))).toBe(true);
  });

  it("keeps every update baseline unchanged when a later adapter regresses", async () => {
    const root = consumer();
    const initial = deps(root, [
      fakeAdapter({ id: "ts-alpha", findings: { clean: 2 } }),
      fakeAdapter({ id: "ts-beta", findings: { risk: 1 } }),
    ]);
    expect(await runCli(["node", "code-quality", "check", "--initialize"], initial)).toBe(0);
    const firstFile = join(root, "quality/ts-alpha-baseline.json");
    const before = readFileSync(firstFile, "utf8");
    const update = deps(root, [
      fakeAdapter({ id: "ts-alpha", findings: { clean: 1 } }),
      fakeAdapter({ id: "ts-beta", findings: { risk: 2 } }),
    ]);

    expect(await runCli(["node", "code-quality", "check", "--update"], update)).toBe(1);
    expect(readFileSync(firstFile, "utf8")).toBe(before);
  });

  it("reports applicability failures while running applicable adapters", async () => {
    const root = consumer();
    const command = deps(root, [
      fakeAdapter({ id: "ts-broken", applicability: () => ({
        kind: "error", message: "prerequisite failed",
      }) }),
      fakeAdapter({ id: "ts-alpha" }),
    ]);

    expect(await runCli(["node", "code-quality", "check", "--initialize"], command)).toBe(1);
    expect(outputs.join(" ")).toContain("ts-broken");
    expect(outputs.join(" ")).toContain("ts-alpha");
    expect(errors.join(" ")).toContain("prerequisite failed");
  });
});

describe("CLI auxiliary commands", () => {
  it("supports selection, help, versions, and the injected step summary", async () => {
    const root = consumer();
    const summary = join(root, "summary.md");
    const command = deps(root);
    command.env = { GITHUB_STEP_SUMMARY: summary };
    expect(await runCli(["node", "code-quality", "check", "--initialize"], command)).toBe(0);
    outputs = [];
    expect(await runCli(["node", "code-quality", "check", "complexity"], command)).toBe(0);
    expect(outputs.join(" ")).not.toContain("ts-gamma");
    expect(readFileSync(summary, "utf8")).toContain("### ts-alpha");
    outputs = [];
    expect(await runCli(["node", "code-quality", "versions"], command)).toBe(0);
    expect(outputs.join(" ")).toContain("oxlint");
    expect(await runCli(["node", "code-quality", "--help"], command)).toBe(0);
  });

  it("returns one for unknown commands and unknown configuration keys", async () => {
    const root = consumer();
    const command = deps(root);
    expect(await runCli(["node", "code-quality", "nosuchcommand"], command)).toBe(1);
    writeFileSync(join(root, ".code-quality.yml"), "thresholds:\n  complexity: 20\n", "utf8");
    errors = [];
    expect(await runCli(["node", "code-quality", "check"], command)).toBe(1);
    expect(errors.join(" ")).toContain("Unrecognized key");
  });

  it("returns the doctor and report command exit codes", async () => {
    const root = consumer();
    const doctor = deps(root);
    doctor.env = { CODE_QUALITY_ASSETS_DIR: "/missing/code-quality-assets" };
    doctor.run.spawn = (invocation) => ({
      stdout: `${invocation.bin} ${TOOL_PINS.find((pin) => pin.bin === invocation.bin)?.version}`,
      stderr: "", exitCode: 0,
    });
    expect(await runCli(["node", "code-quality", "doctor"], doctor)).toBe(1);
    expect(outputs.join(" ")).toContain("FAIL");

    const report = deps(root);
    report.run.spawn = () => { throw new Error("report tool failed"); };
    expect(await runCli(["node", "code-quality", "report"], report)).toBe(1);
    expect(errors.join(" ")).toContain("report tool failed");
  });
});

it("refuses baseline changes when the generic CI flag is true", async () => {
  const command = deps(consumer());
  command.env = { CI: "true" };

  expect(await runCli(["node", "code-quality", "baseline"], command)).toBe(1);
  expect(errors.join(" ")).toContain("Refusing baseline in CI (CI=true)");
});
