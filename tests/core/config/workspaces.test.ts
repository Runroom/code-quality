import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BUILTIN_EXCLUSIONS, TEST_EXCLUSIONS } from "../../../src/core/config/exclusions.ts";
import type { Language } from "../../../src/core/config/schema.ts";
import type { SourceSelection } from "../../../src/core/config/sources.ts";
import { workspaceRoots } from "../../../src/core/config/workspaces.ts";
import { workspaceMemberDirectories } from "../../../src/core/config/workspaces.ts";

function withRoot(files: Record<string, string>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "code-quality-workspaces-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      const path = join(root, file);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, content, "utf8");
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const selection: SourceSelection = {
  excludes: [...BUILTIN_EXCLUSIONS, ...TEST_EXCLUSIONS],
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
};

function roots(root: string, language: Language): string[] {
  return workspaceRoots(root, language, {
    ...selection,
    extensions: language === "php" ? [".php"] : language === "python" ? [".py"] : selection.extensions,
  });
}

describe("workspaceRoots TypeScript manifests", () => {
  it("expands pnpm member globs and maps members to their src directories", () => {
    withRoot({
      "pnpm-workspace.yaml": "packages:\n  - packages/*\n  - apps/*\n",
      "packages/core/package.json": "{}",
      "packages/core/src/index.ts": "",
      "apps/web/package.json": "{}",
      "apps/web/src/index.tsx": "",
    }, (root) => expect(roots(root, "ts")).toEqual([
      "apps/web/src", "packages/core/src",
    ]));
  });

  it.each([
    JSON.stringify({ workspaces: ["packages/*"] }),
    JSON.stringify({ workspaces: { packages: ["packages/*"] } }),
  ])("supports package.json workspace shapes", (manifest) => {
    withRoot({
      "package.json": manifest,
      "packages/core/package.json": "{}",
      "packages/core/index.ts": "",
    }, (root) => expect(roots(root, "ts")).toEqual(["packages/core"]));
  });

  it("applies negated globs and skips a dot member", () => {
    withRoot({
      "pnpm-workspace.yaml": "packages: ['.', 'packages/*', '!packages/private-*']\n",
      "index.ts": "",
      "packages/shared/package.json": "{}",
      "packages/shared/src/index.ts": "",
      "packages/private-core/package.json": "{}",
      "packages/private-core/src/index.ts": "",
    }, (root) => expect(roots(root, "ts")).toEqual(["packages/shared/src"]));
  });

  it("adds depth-1 directories containing package.json", () => {
    withRoot({
      "server/package.json": "{}",
      "server/main.ts": "",
      "plain/package.json": "{}",
      "plain/readme.md": "",
      "nested/child/package.json": "{}",
      "nested/child/main.ts": "",
    }, (root) => expect(roots(root, "ts")).toEqual(["server"]));
  });
});

describe("workspace TypeScript root layout", () => {
  it("keeps a member root when it has source files outside src", () => {
    withRoot({
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "packages/core/package.json": "{}",
      "packages/core/src/index.ts": "",
      "packages/cli/package.json": "{}",
      "packages/cli/src/lib.ts": "",
      "packages/cli/cli.ts": "",
    }, (root) => expect(roots(root, "ts")).toEqual([
      "packages/cli", "packages/core/src",
    ]));
  });
});

describe("workspace TypeScript exclusions", () => {
  it("drops members excluded as tests", () => {
    withRoot({
      "pnpm-workspace.yaml": "packages: ['packages/*', 'packages/core/plugins/*', 'tests/*']\n",
      "packages/core/package.json": "{}",
      "packages/core/index.ts": "",
      "packages/core/plugins/demo/package.json": "{}",
      "packages/core/plugins/demo/index.ts": "",
      "tests/demo/package.json": "{}",
      "tests/demo/src/index.ts": "",
    }, (root) => expect(roots(root, "ts")).toEqual(["packages/core"]));
  });
});

describe("workspace pattern normalization", () => {
  it.each(["./packages/*", "packages//*"])("normalizes %s and its negation", (pattern) => {
    withRoot({
      "pnpm-workspace.yaml": `packages: ['${pattern}', '!./packages/legacy']\n`,
      "packages/core/package.json": "{}",
      "packages/core/src/index.ts": "",
      "packages/legacy/package.json": "{}",
      "packages/legacy/src/index.ts": "",
    }, (root) => {
      expect(workspaceMemberDirectories(root)).toEqual(["packages/core"]);
      expect(roots(root, "ts")).toEqual(["packages/core/src"]);
    });
  });
});

describe("workspace member validation", () => {
  it("matches recursive members to depth three and requires package manifests", () => {
    withRoot({
      "package.json": JSON.stringify({ workspaces: ["packages/**"] }),
      "packages/container/src/index.ts": "",
      "packages/group/sub/package.json": "{}",
      "packages/group/sub/src/index.ts": "",
    }, (root) => {
      expect(workspaceMemberDirectories(root)).toEqual(["packages/group/sub"]);
      expect(roots(root, "ts")).toEqual(["packages/group/sub/src"]);
    });
  });

  it("keeps explicitly declared members with conventional names", () => {
    withRoot({
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "packages/docs/package.json": "{}",
    }, (root) => {
      expect(workspaceMemberDirectories(root)).toEqual(["packages/docs"]);
      expect(roots(root, "ts")).toEqual([]);
    });
  });

  it("ignores invalid and pathological workspace patterns", () => {
    const longPattern = `packages/${"a".repeat(201)}`;
    withRoot({
      "package.json": JSON.stringify({ workspaces: [
        "packages/?", "packages/[abc]", "packages/*a*a*b", longPattern, "packages/*",
      ] }),
      "packages/core/package.json": "{}",
      "packages/core/src/index.ts": "",
    }, (root) => expect(workspaceMemberDirectories(root)).toEqual(["packages/core"]));
  });

  it("ignores manifests larger than one MiB", () => {
    withRoot({
      "package.json": `${" ".repeat(1024 * 1024)}{}`,
      "packages/core/package.json": "{}",
      "packages/core/src/index.ts": "",
    }, (root) => expect(workspaceMemberDirectories(root)).toEqual([]));
  });

  it("caps includes and excludes independently", () => {
    const includes = ["packages/*", ...Array.from({ length: 200 }, (_, index) => `packages/unused-${index}`)];
    withRoot({
      "pnpm-workspace.yaml": `packages: [${[...includes.map((pattern) => `'${pattern}'`), "'!packages/legacy'"].join(", ")}]\n`,
      "packages/core/package.json": "{}",
      "packages/core/src/index.ts": "",
      "packages/legacy/package.json": "{}",
      "packages/legacy/src/index.ts": "",
    }, (root) => {
      expect(workspaceMemberDirectories(root)).toEqual(["packages/core"]);
    });
  });
});

describe("workspaceRoots Composer manifests", () => {
  it("reads autoload directory values and ignores unsupported entries", () => {
    withRoot({
      "composer.json": JSON.stringify({
        autoload: {
          "psr-4": { "App\\\\": "./src/", "": ["packages/a/src/", "packages/b/src"] },
          "psr-0": { "Legacy\\\\": ["legacy/", "fallback/"] },
          classmap: ["classmap/", "bootstrap.php"],
          files: ["helpers.php"],
        },
        "autoload-dev": { "psr-4": { "Tests\\\\": "tests/" } },
      }),
      "src/App.php": "<?php\n",
      "packages/a/src/A.php": "<?php\n",
      "packages/b/src/B.php": "<?php\n",
      "legacy/Legacy.php": "<?php\n",
      "fallback/Fallback.php": "<?php\n",
      "classmap/ClassMap.php": "<?php\n",
      "bootstrap.php": "<?php\n",
      "helpers.php": "<?php\n",
      "tests/Test.php": "<?php\n",
    }, (root) => expect(roots(root, "php")).toEqual([
      "classmap", "fallback", "legacy", "packages/a/src", "packages/b/src", "src",
    ]));
  });

  it("drops a source root nested under another selected root", () => {
    withRoot({
      "composer.json": JSON.stringify({
        autoload: { "psr-4": { "Domain\\\\": "domain/", "Nested\\\\": "domain/nested/" } },
      }),
      "domain/nested/Entity.php": "<?php\n",
    }, (root) => expect(roots(root, "php")).toEqual(["domain"]));
  });
});

describe("workspaceRoots Python manifests", () => {
  it("expands uv members minus excludes and maps members to src", () => {
    withRoot({
      "pyproject.toml": [
        "[tool.uv.workspace]",
        "members = [\"packages/*\"]",
        "exclude = [\"packages/private-*\"]",
      ].join("\n"),
      "packages/core/src/core.py": "",
      "packages/core/pyproject.toml": "",
      "packages/private-api/src/api.py": "",
      "packages/private-api/pyproject.toml": "",
    }, (root) => expect(roots(root, "python")).toEqual(["packages/core/src"]));
  });

  it("reads setuptools package find where directories", () => {
    withRoot({
      "pyproject.toml": [
        "[tool.setuptools.packages.find]",
        "where = [\"python/\", \"lib\", \"missing\"]",
      ].join("\n"),
      "python/app.py": "",
      "lib/pkg.py": "",
    }, (root) => expect(roots(root, "python")).toEqual(["lib", "python"]));
  });
});

describe("workspaceRoots validation", () => {
  it("returns no roots for web", () => {
    withRoot({ "package.json": "{}", "app/src/index.ts": "" }, (root) => {
      expect(roots(root, "web")).toEqual([]);
    });
  });

  it.each([
    ["ts", { "package.json": "{", "pnpm-workspace.yaml": "packages: [" }],
    ["php", { "composer.json": "{" }],
    ["python", { "pyproject.toml": "[tool.uv.workspace\nmembers = [" }],
  ] as const)("treats malformed %s manifests as empty", (language, files) => {
    withRoot(files, (root) => expect(roots(root, language)).toEqual([]));
  });
});
