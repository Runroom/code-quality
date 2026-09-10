import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/program.ts";
import type { CliDeps } from "../../src/cli/deps.ts";
import { fakeAdapter, fakeDeps } from "../helpers/fake-adapter.ts";

const roots: string[] = [];

function command(
  root: string,
  errors: string[],
  output: string[] = [],
  registry = [fakeAdapter({ id: "ts-alpha" })],
): CliDeps {
  return {
    registry,
    run: fakeDeps(),
    env: {},
    cwd: root,
    stdout: (value) => output.push(value),
    stderr: (value) => errors.push(value),
  };
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

describe("init auto-detection notices", () => {
  it("prints notices once and scaffolds only resolved languages", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-init-notice-"));
    roots.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/index.php"), "", "utf8");
    writeFileSync(join(root, "package.json"), "{}", "utf8");
    writeFileSync(join(root, "composer.json"), "{}", "utf8");
    const errors: string[] = [];
    const output: string[] = [];

    expect(await runCli(["node", "code-quality", "init"], command(root, errors, output))).toBe(0);
    const config = parse(readFileSync(join(root, ".code-quality.yml"), "utf8")) as {
      languages: string[];
      paths: Record<string, string[]>;
    };
    expect(config).toEqual({ languages: ["php"], paths: { php: ["src"] } });
    expect(output.filter((line) => line.startsWith("Notice: "))).toEqual([
      "Notice: ts: package.json detected but no ts source files under src; "
        + "add paths.ts to .code-quality.yml to enable TS checks\n",
    ]);
  });
});

describe("init command", () => {
  it("initializes a web-only repository without a manifest", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-init-web-"));
    roots.push(root);
    mkdirSync(join(root, "templates"));
    writeFileSync(join(root, "templates/page.twig"), "<main>Page</main>", "utf8");
    const errors: string[] = [];

    expect(await runCli(["node", "code-quality", "init"], command(root, errors))).toBe(0);
    const config = parse(readFileSync(join(root, ".code-quality.yml"), "utf8"));
    expect(config).toEqual({ languages: ["web"], paths: { web: ["templates"] } });
    expect(errors).toEqual([]);
  });

  it("scaffolds a consumer, keeps existing baselines, and creates missing ones", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-init-"));
    roots.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/index.ts"), "", "utf8");
    writeFileSync(join(root, "package.json"), "{}", "utf8");
    const errors: string[] = [];
    const output: string[] = [];

    expect(await runCli(["node", "code-quality", "init"], command(root, errors, output))).toBe(0);
    const config = readFileSync(join(root, ".code-quality.yml"), "utf8");
    const baseline = readFileSync(join(root, "quality/ts-alpha-baseline.json"), "utf8");
    expect(existsSync(join(root, "quality/ts-alpha-baseline.json"))).toBe(true);
    expect(existsSync(join(root, ".github/workflows/quality.yml"))).toBe(true);
    expect(existsSync(join(root, "Makefile"))).toBe(true);

    expect(await runCli(
      ["node", "code-quality", "init"],
      command(root, errors, output, [fakeAdapter({ id: "ts-alpha" }), fakeAdapter({ id: "ts-beta" })]),
    )).toBe(0);
    expect(readFileSync(join(root, ".code-quality.yml"), "utf8")).toBe(config);
    expect(readFileSync(join(root, "quality/ts-alpha-baseline.json"), "utf8")).toBe(baseline);
    expect(existsSync(join(root, "quality/ts-beta-baseline.json"))).toBe(true);
    expect(output.join(" ")).toContain("Kept existing: quality/ts-alpha-baseline.json");
    expect(errors.join(" ")).not.toContain("already exists");
  });

  it("requires a supported manifest", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-init-empty-"));
    roots.push(root);
    const errors: string[] = [];
    expect(await runCli(["node", "code-quality", "init"], command(root, errors))).toBe(1);
    expect(errors.join(" ")).toContain("No supported manifest");
  });

  it.each(["init", "check"])("notices when an auto-detected language has no default sources for %s", async (name) => {
    const root = mkdtempSync(join(tmpdir(), `code-quality-${name}-missing-src-`));
    roots.push(root);
    mkdirSync(join(root, "app"));
    writeFileSync(join(root, "app/index.ts"), "", "utf8");
    writeFileSync(join(root, "package.json"), "{}", "utf8");
    const errors: string[] = [];

    const output: string[] = [];
    expect(await runCli(["node", "code-quality", name], command(root, errors, output))).toBe(0);
    expect(output.join(" ")).toContain(
      "Notice: ts: package.json detected but no ts source files under src, assets; "
        + "add paths.ts to .code-quality.yml to enable TS checks",
    );
    expect(errors).toEqual([]);
  });
});
