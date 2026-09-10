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

  it("explains the missing node_modules prerequisite", () => {
    const bare = mkdtempSync(join(tmpdir(), "knip-bare-"));
    writeFileSync(join(bare, "package.json"), '{"name":"bare","private":true}\n');
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

describe("knip captured fixture", () => {
  it("returns all nine captured findings", async () => {
    const findings = await knipFindings(
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
  });
});

describe("knip generated config", () => {
  it("disables the config-executing vite and vitest plugins", () => {
    expect(generatedConfig()).toMatchObject({ vite: false, vitest: false });
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
