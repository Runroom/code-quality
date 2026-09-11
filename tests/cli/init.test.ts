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
import { MAKEFILE_SNIPPET } from "../../src/cli/scaffold.ts";
import type { CliDeps } from "../../src/cli/deps.ts";
import { fakeAdapter, fakeDeps } from "../helpers/fake-adapter.ts";
import { createStyle } from "../../src/cli/style.ts";

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
    style: createStyle(false),
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
    expect(output.filter((line) => line.startsWith(" ● Notice: "))).toEqual([
      " ● Notice: ts: package.json detected but no ts source files under src; "
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
    expect(output.join("")).toContain("Updated .gitignore (artifacts/quality/)\n");

    expect(await runCli(
      ["node", "code-quality", "init"],
      command(root, errors, output, [fakeAdapter({ id: "ts-alpha" }), fakeAdapter({ id: "ts-beta" })]),
    )).toBe(0);
    expect(readFileSync(join(root, ".code-quality.yml"), "utf8")).toBe(config);
    expect(readFileSync(join(root, "quality/ts-alpha-baseline.json"), "utf8")).toBe(baseline);
    expect(existsSync(join(root, "quality/ts-beta-baseline.json"))).toBe(true);
    expect(readFileSync(join(root, "Makefile"), "utf8")).toBe(MAKEFILE_SNIPPET);
    expect(output.join("")).toContain("Kept Makefile\n");
    expect(output.join("")).toContain(" ● Kept existing quality/ts-alpha-baseline.json\n");
    expect(errors.join(" ")).not.toContain("already exists");
  });

  it("keeps init artifacts in the requested directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-init-artifacts-"));
    roots.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/index.ts"), "", "utf8");
    writeFileSync(join(root, "package.json"), "{}", "utf8");
    const errors: string[] = [];

    expect(await runCli(
      ["node", "code-quality", "init", "--artifacts", "evidence"],
      command(root, errors),
    )).toBe(0);
    expect(existsSync(join(root, "evidence", "ts-alpha", "stdout.log"))).toBe(true);
  });
});

describe("init Makefile output", () => {
  it("echoes manual Makefile recipes with their leading tabs", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-init-makefile-"));
    roots.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/index.ts"), "", "utf8");
    writeFileSync(join(root, "package.json"), "{}", "utf8");
    writeFileSync(join(root, "Makefile"), "quality:\n\t@echo custom\n", "utf8");
    const output: string[] = [];

    expect(await runCli(["node", "code-quality", "init"], command(root, [], output))).toBe(0);
    const echoed = output.join("").split("\n");
    const recipes = MAKEFILE_SNIPPET.split("\n").filter((line) => line.startsWith("\t"));
    expect(recipes).not.toHaveLength(0);
    for (const recipe of recipes) expect(echoed).toContain(recipe);
  });
});

describe("init with no supported sources", () => {
  it("fails when no supported sources resolve", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-init-empty-"));
    roots.push(root);
    const errors: string[] = [];
    expect(await runCli(["node", "code-quality", "init"], command(root, errors))).toBe(1);
    expect(errors.join(" ")).toContain(
      "Nothing to check: no supported sources found. Declare languages and paths in .code-quality.yml.",
    );
  });

});

describe("init source discovery", () => {
  it.each(["init", "check"])("notices when an auto-detected language has no default sources for %s", async (name) => {
    const root = mkdtempSync(join(tmpdir(), `code-quality-${name}-missing-src-`));
    roots.push(root);
    mkdirSync(join(root, "app"));
    writeFileSync(join(root, "app/index.ts"), "", "utf8");
    writeFileSync(join(root, "package.json"), "{}", "utf8");
    const errors: string[] = [];

    const output: string[] = [];
    expect(await runCli(["node", "code-quality", name], command(root, errors, output)))
      .toBe(name === "init" ? 0 : 1);
    expect(output.join(" ")).toContain(
      "Notice: ts: no ts sources under src; using detected roots app",
    );
    if (name === "init") expect(errors).toEqual([]);
    else expect(errors.join(" ")).toContain("quality/ts-alpha-baseline.json is missing");
  });

});

describe("init with excluded sources", () => {
  it.each(["init", "check"])(
    "fails when an auto-detected language has no sources for %s",
    async (name) => {
      const root = mkdtempSync(join(tmpdir(), "code-quality-" + name + "-no-sources-"));
      roots.push(root);
      mkdirSync(join(root, "tests"));
      mkdirSync(join(root, "dist"));
      writeFileSync(join(root, "tests/x.test.ts"), "", "utf8");
      writeFileSync(join(root, "dist/bundle.js"), "", "utf8");
      writeFileSync(join(root, "package.json"), "{}", "utf8");
      const errors: string[] = [];
      const output: string[] = [];

      expect(await runCli(["node", "code-quality", name], command(root, errors, output))).toBe(1);
      expect(output.join(" ")).toContain(
        "Notice: ts: package.json detected but no ts source files under src, assets; "
          + "add paths.ts to .code-quality.yml to enable TS checks",
      );
      expect(errors.join(" ")).toContain(
        "Nothing to check: no supported sources found. Declare languages and paths in .code-quality.yml.",
      );
      expect(output.join(" ")).not.toContain(" Result   PASS");
      expect(output.join(" ")).not.toContain(" Next     ");
    },
  );

});

describe("init discovered configuration", () => {
  it("writes discovered TypeScript roots to the generated configuration", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-init-discovery-"));
    roots.push(root);
    for (const directory of ["common", "plugin-src", "ui-src", "tests", "dist"]) {
      mkdirSync(join(root, directory));
    }
    writeFileSync(join(root, "common/types.ts"), "", "utf8");
    writeFileSync(join(root, "plugin-src/a.ts"), "", "utf8");
    writeFileSync(join(root, "ui-src/b.tsx"), "", "utf8");
    writeFileSync(join(root, "tests/x.test.ts"), "", "utf8");
    writeFileSync(join(root, "dist/c.js"), "", "utf8");
    writeFileSync(join(root, "package.json"), "{}", "utf8");
    const errors: string[] = [];
    const output: string[] = [];

    expect(await runCli(["node", "code-quality", "init"], command(root, errors, output))).toBe(0);
    const config = parse(readFileSync(join(root, ".code-quality.yml"), "utf8")) as {
      languages: string[];
      paths: Record<string, string[]>;
    };
    expect(config).toEqual({
      languages: ["ts"],
      paths: { ts: ["common", "plugin-src", "ui-src"] },
    });
    expect(output.join(" ")).toContain(
      "Notice: ts: no ts sources under src; using detected roots common, plugin-src, ui-src",
    );
    expect(output.at(-1)).toBe(
      " Next     review .code-quality.yml, run make quality, commit quality/\n",
    );
    expect(output.filter((line) => line.includes("code-quality 1.1.7"))).toEqual([
      " code-quality 1.1.7 · init · ts\n",
    ]);
    expect(errors).toEqual([]);
  });
});
