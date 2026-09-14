import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

function generatedConfigAt(files: Record<string, string>, paths: string[]): Record<string, unknown> {
  const tempRoot = mkdtempSync(join(tmpdir(), "knip-config-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      const path = join(tempRoot, file);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, content);
    }
    const ctx = checkContext(tempRoot, "ts");
    ctx.paths = paths;
    return JSON.parse(knipAdapter.configFiles(ctx)[0]!.content) as Record<string, unknown>;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
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

describe("knip static framework entries", () => {
  it("adds static framework config and existing Next application entries", () => {
    const generated = generatedConfigAt({
      "next.config.mjs": "export default {};\n",
      "src/payload.config.ts": "export default {};\n",
      "vitest.config.ts": "export default {};\n",
      "playwright.config.ts": "export default {};\n",
      "src/app/page.tsx": "export default function Page() { return null; }\n",
      "src/middleware.ts": "export function middleware() {}\n",
    }, ["src"]);
    const application = "src/app/**/{page,layout,template,loading,error,global-error,not-found,default,route}.{ts,tsx,js,jsx}";
    expect(generated.entry).toEqual(expect.arrayContaining([
      "next.config.mjs", "src/payload.config.ts", "vitest.config.ts",
      "playwright.config.ts", application, "src/middleware.{ts,js}",
    ]));
    expect(generated.project).toEqual(expect.arrayContaining([
      "next.config.mjs", "src/payload.config.ts", "vitest.config.ts",
      "playwright.config.ts", application, "src/middleware.{ts,js}",
    ]));
    expect(generated.entry).not.toContain("src/pages/**/*.{ts,tsx,js,jsx}");
  });
});

describe("knip workspace config", () => {
  it("creates per-member configs and ignores unused manifest workspaces", () => {
    const generated = generatedConfigAt({
      "pnpm-workspace.yaml": "packages: ['packages/*', 'apps/*']\n",
      "packages/core/package.json": "{}",
      "packages/core/src/index.ts": "",
      "apps/web/package.json": "{}",
      "apps/web/src/main.ts": "",
      "packages/unused/package.json": "{}",
    }, ["apps/web/src", "packages/core/src"]);
    const workspaces = generated.workspaces as Record<string, Record<string, unknown>>;
    expect(Object.keys(workspaces)).toEqual([".", "apps/web", "packages/core"]);
    for (const workspace of [workspaces["apps/web"]!, workspaces["packages/core"]!]) {
      expect(workspace.entry).toEqual(expect.arrayContaining([
        "src/**/{index,main,cli}.{ts,tsx,js,mjs,cjs}",
      ]));
      expect(workspace.project).toEqual([
        "src/**/*.{ts,tsx,js,jsx,mjs,cjs}",
        "tests/**/*.{ts,tsx,js,mjs,cjs}",
        "test/**/*.{ts,tsx,js,mjs,cjs}",
        "**/__tests__/**/*.{ts,tsx,js,mjs,cjs}",
        "**/*.{test,spec}.{ts,tsx,js,mjs,cjs}",
      ]);
      expect(workspace.ignore).toEqual(expect.arrayContaining([
        "**/*.test.*", "**/__tests__/**", "**/tests/**",
      ]));
      expect(workspace).not.toHaveProperty("ignoreDependencies");
    }
    expect(generated.ignoreWorkspaces).toEqual(["packages/unused"]);
    expect(generated).not.toHaveProperty("entry");
    expect(generated).not.toHaveProperty("project");
    expect(generated).not.toHaveProperty("ignore");
    expect(generated.next).toBe(false);
    expect(generated.payload).toBe(false);
  });

  it("creates root and nested workspace configs without manifest workspaces", () => {
    const generated = generatedConfigAt({
      "package.json": "{}",
      "src/index.ts": "",
      "server/package.json": "{}",
      "server/main.ts": "",
    }, ["src", "server"]);
    expect(Object.keys(generated.workspaces as object)).toEqual([".", "server"]);
    expect(generated.ignoreWorkspaces).toEqual([]);
    expect(generated).not.toHaveProperty("entry");
    expect(generated).not.toHaveProperty("project");
  });
});

describe("knip workspace framework config", () => {
  it("always emits a root workspace block when declared members own every source path", () => {
    const generated = generatedConfigAt({
      "package.json": "{}",
      "pnpm-workspace.yaml": "packages: ['packages/*']\n",
      "vitest.config.ts": "export default {};\n",
      "packages/core/package.json": "{}",
      "packages/core/src/index.ts": "",
    }, ["packages/core/src"]);
    const workspaces = generated.workspaces as Record<string, Record<string, unknown>>;
    expect(Object.keys(workspaces)).toEqual([".", "packages/core"]);
    expect(workspaces["."]?.project).toEqual(expect.arrayContaining(["vitest.config.ts"]));
    expect(workspaces["."]?.project).not.toContain("**/*.{ts,tsx,js,jsx,mjs,cjs}");
  });

  it("detects framework entries independently for each workspace owner", () => {
    const generated = generatedConfigAt({
      "package.json": "{}",
      "pnpm-workspace.yaml": "packages: ['apps/*']\n",
      "apps/web/package.json": "{}",
      "apps/web/next.config.mjs": "export default {};\n",
      "apps/web/src/app/page.tsx": "export default function Page() { return null; }\n",
      "apps/api/package.json": "{}",
      "apps/api/src/index.ts": "",
    }, ["apps/api/src", "apps/web/src"]);
    const workspaces = generated.workspaces as Record<string, Record<string, string[]>>;
    const appPattern = "src/app/**/{page,layout,template,loading,error,global-error,not-found,default,route}.{ts,tsx,js,jsx}";
    expect(workspaces["apps/web"]?.entry).toEqual(expect.arrayContaining(["next.config.mjs", appPattern]));
    expect(workspaces["apps/api"]?.entry).not.toContain(appPattern);
  });
});

describe("knip workspace safety config", () => {
  it("rebases consumer ignores to their owning workspace", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "knip-config-"));
    try {
      for (const file of ["package.json", "packages/core/package.json", "packages/core/src/index.ts"]) {
        const path = join(tempRoot, file);
        mkdirSync(join(path, ".."), { recursive: true });
        writeFileSync(path, "{}");
      }
      const ctx = checkContext(tempRoot, "ts");
      ctx.paths = ["packages/core/src"];
      ctx.config.exclude = ["packages/core/legacy/**", "docs/**", "**/x/**"];
      const generated = JSON.parse(knipAdapter.configFiles(ctx)[0]!.content) as {
        workspaces: Record<string, { ignore: string[] }>;
      };
      expect(generated.workspaces["packages/core"]?.ignore).toEqual(expect.arrayContaining([
        "legacy/**", "**/x/**",
      ]));
      expect(generated.workspaces["packages/core"]?.ignore).not.toContain("docs/**");
      expect(generated.workspaces["."]?.ignore).toEqual(expect.arrayContaining(["docs/**", "**/x/**"]));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps root and server workspace keys for the hr-platform shape", () => {
    const generated = generatedConfigAt({
      "package.json": "{}", "src/index.ts": "", "server/package.json": "{}", "server/src/index.ts": "",
    }, ["src", "server/src"]);
    expect(Object.keys(generated.workspaces as object)).toEqual([".", "server"]);
  });

  it("drops unsafe ignored member names and records a notice", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "knip-config-"));
    try {
      for (const file of ["package.json", "safe/package.json", "safe/src/index.ts", "bad*/package.json"]) {
        const path = join(tempRoot, file);
        mkdirSync(join(path, ".."), { recursive: true });
        writeFileSync(path, "{}");
      }
      writeFileSync(join(tempRoot, "package.json"), JSON.stringify({ workspaces: ["*"] }));
      const ctx = checkContext(tempRoot, "ts");
      ctx.paths = ["safe/src"];
      const generated = JSON.parse(knipAdapter.configFiles(ctx)[0]!.content) as { ignoreWorkspaces: string[] };
      expect(generated.ignoreWorkspaces).not.toContain("bad*");
      expect(ctx.config.notices).toContain("ts-unused: ignored unsafe workspace member bad*");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("fails loudly when a resolved path has an unsafe owner", () => {
    expect(() => generatedConfigAt({
      "bad*/package.json": "{}", "bad*/src/index.ts": "",
    }, ["bad*/src"])).toThrow("ts-unused: unsafe workspace owner bad*");
  });

});

describe("knip workspace manifest ownership", () => {
  it("does not treat a symlinked package manifest as a workspace owner", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "knip-config-"));
    try {
      mkdirSync(join(workspaceRoot, "server/src"), { recursive: true });
      writeFileSync(join(workspaceRoot, "package.json"), "{}");
      writeFileSync(join(workspaceRoot, "manifest.json"), "{}");
      symlinkSync("../manifest.json", join(workspaceRoot, "server/package.json"));
      const ctx = checkContext(workspaceRoot, "ts");
      ctx.paths = ["server/src"];
      const generated = JSON.parse(knipAdapter.configFiles(ctx)[0]!.content) as {
        workspaces?: Record<string, unknown>;
      };
      expect(generated).not.toHaveProperty("workspaces");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
