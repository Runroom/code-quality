import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { knipAdapter, knipFindings } from "../../../src/checks/ts/knip.ts";
import { checkContext } from "../../helpers/check-context.ts";

const root = resolve("fixtures/ts-project");
const nativeFile = resolve("tests/fixtures/native/ts-unused/stdout.json");

function generatedConfig(paths = ["src"]): Record<string, unknown> {
  const ctx = checkContext("/r", "ts");
  ctx.paths = paths;
  return JSON.parse(knipAdapter.configFiles(ctx)[0]!.content) as Record<string, unknown>;
}

describe("knip synthetic parser", () => {
  const ctx = checkContext("/r", "ts", { "src/exports.ts": "export const orphan = 1;\n" });

  it.each([
    ["missing dependency fields", { name: "bare", private: true }],
    [
      "empty dependency fields",
      {
        name: "bare",
        private: true,
        dependencies: {},
        devDependencies: {},
        peerDependencies: {},
        optionalDependencies: {},
      },
    ],
  ])("does not require node_modules for %s", (_description, manifest) => {
    const bare = mkdtempSync(join(tmpdir(), "knip-bare-"));
    writeFileSync(join(bare, "package.json"), `${JSON.stringify(manifest)}\n`);
    expect(knipAdapter.applicability(checkContext(bare).config)).toEqual({ kind: "run" });
  });

  it("explains the missing node_modules prerequisite when dependencies are declared", () => {
    const bare = mkdtempSync(join(tmpdir(), "knip-bare-"));
    writeFileSync(join(bare, "package.json"), '{"name":"bare","private":true,"dependencies":{"left-pad":"1.3.0"}}\n');
    expect(knipAdapter.applicability(checkContext(bare).config)).toEqual({
      kind: "error",
      message: "ts-unused (knip) needs installed dependencies: run your package manager install "
        + "(workflow input `setup: pnpm install --frozen-lockfile` or npm ci) and retry.",
    });
  });

  it("rejects an unknown non-empty issue type", async () => {
    const input = { issues: [{ file: "src/exports.ts", unlisted: [{ name: "x" }] }] };
    await expect(knipFindings(ctx, input))
      .rejects.toThrow("Unknown knip issue type unlisted in src/exports.ts");
  });

  it("ignores known non-issue metadata keys", async () => {
    const input = { issues: [{
      file: "package.json", owners: ["team"], ignored: { dependencies: ["x"] }, catalog: {},
    }] };
    expect((await knipFindings(ctx, input)).findings).toEqual({});
  });

  it("rejects the same export twice as ambiguous", async () => {
    const item = { name: "orphan" };
    const input = { issues: [{ file: "src/exports.ts", exports: [item, item] }] };
    await expect(knipFindings(ctx, input)).rejects.toThrow("Ambiguous duplicate diagnostic");
  });

  it("propagates grammar parse errors", async () => {
    const broken = checkContext("/r", "ts", { "src/exports.ts": "export const orphan = 1;\n" });
    broken.anchor.anchor = () => Promise.reject(new Error("grammar parse failed"));
    const input = { issues: [{ file: "src/exports.ts", exports: [{
      name: "orphan", line: 1, col: 14,
    }] }] };
    await expect(knipFindings(broken, input)).rejects.toThrow("grammar parse failed");
  });

});

it("accepts unused dependencies from workspace package manifests", async () => {
  const input = { issues: [{
    file: "packages/cli/package.json",
    dependencies: [{ name: "left-pad" }],
  }] };
  expect((await knipFindings(checkContext("/r", "ts"), input)).findings).toEqual({
    "packages/cli/package.json | unused-dependency | left-pad": 1,
  });
});

describe("knip captured fixture", () => {
  it("returns all nine captured findings", async () => {
    const { findings, details } = await knipFindings(
      checkContext(root),
      JSON.parse(readFileSync(nativeFile, "utf8")),
    );
    expect(Object.keys(findings).some((key) => key.includes("ignored.test.ts"))).toBe(false);
    expect(findings).toEqual({
      "package.json | unused-dependency | left-pad": 1,
      "src/cognitive.ts | unused-file | src/cognitive.ts": 1,
      "src/complexity.ts | unused-file | src/complexity.ts": 1,
      "src/db/repo.ts | unused-file | src/db/repo.ts": 1,
      "src/dup-a.ts | unused-file | src/dup-a.ts": 1,
      "src/dup-b.ts | unused-file | src/dup-b.ts": 1,
      "src/exports.ts | unused-export | /#orphan": 1,
      "src/ui/view.ts | unused-file | src/ui/view.ts": 1,
      "src/unused-file.ts | unused-file | src/unused-file.ts": 1,
    });
    expect(details["src/complexity.ts | unused-file | src/complexity.ts"]).toMatchObject({
      message: "unused file",
    });
    expect(details["src/exports.ts | unused-export | /#orphan"]).toMatchObject({
      line: 2,
      column: 14,
      message: "unused export 'orphan'",
    });
    expect(details["package.json | unused-dependency | left-pad"]).toMatchObject({
      message: "unused dependency 'left-pad'",
    });
  });
});

describe("knip generated config", () => {
  it("disables every config-executing plugin", () => {
    expect(generatedConfig()).toMatchObject({
      webpack: false,
      vite: false,
      vitest: false,
      jest: false,
      eslint: false,
      babel: false,
      postcss: false,
      prettier: false,
      stylelint: false,
      rollup: false,
      next: false,
      nuxt: false,
      storybook: false,
      playwright: false,
      cypress: false,
      tailwind: false,
      commitlint: false,
      husky: false,
      "lint-staged": false,
      tsup: false,
      typedoc: false,
      payload: false,
    });
  });

  it("uses conventional source-root and repository-level test entries and project files", () => {
    const generated = generatedConfig(["src", "scripts"]);
    const tests = [
      "tests/**/*.{ts,tsx,js,mjs,cjs}",
      "test/**/*.{ts,tsx,js,mjs,cjs}",
      "**/__tests__/**/*.{ts,tsx,js,mjs,cjs}",
      "**/*.{test,spec}.{ts,tsx,js,mjs,cjs}",
    ];
    expect(generated.entry).toEqual([
      "src/**/{index,main,cli}.{ts,tsx,js,mjs,cjs}",
      "src/**/bin/**/*.{ts,js,mjs,cjs}",
      "scripts/**/{index,main,cli}.{ts,tsx,js,mjs,cjs}",
      "scripts/**/bin/**/*.{ts,js,mjs,cjs}",
      ...tests,
    ]);
    expect(generated.project).toEqual([
      "src/**/*.{ts,tsx,js,jsx,mjs,cjs}",
      "scripts/**/*.{ts,tsx,js,jsx,mjs,cjs}",
      ...tests,
    ]);
    expect(generated.ignore).toEqual(expect.arrayContaining([
      "**/*.test.*", "**/__tests__/**", "**/tests/**",
    ]));
    expect(generated).not.toHaveProperty("includeEntryExports");
  });
});
