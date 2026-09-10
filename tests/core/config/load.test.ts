import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { QualityError } from "../../../src/core/errors.ts";
import { loadConfig } from "../../../src/core/config/load.ts";

const fixtureRoot = join(process.cwd(), "tests/fixtures/config");

function withRoot(
  files: Record<string, string>,
  directories: string[],
  run: (root: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "code-quality-load-"));
  try {
    for (const directory of directories) mkdirSync(join(root, directory), { recursive: true });
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

function withFixture(
  fixture: string,
  files: Record<string, string>,
  directories: string[],
  run: (root: string) => void,
): void {
  const config = join(fixtureRoot, fixture);
  withRoot({ ...files, ".code-quality.yml": "" }, directories, (root) => {
    copyFileSync(config, join(root, ".code-quality.yml"));
    run(root);
  });
}

function expectLoadFailure(root: string, message: string | RegExp): void {
  expect(() => loadConfig(root)).toThrow(message);
}

function expectQualityFailure(root: string): void {
  expect(() => loadConfig(root)).toThrow(QualityError);
}

describe("loadConfig", () => {
  it("detects TypeScript and defaults to src without YAML", () => {
    withRoot({ "package.json": "{}", "src/index.ts": "" }, ["src"], (root) => {
      const config = loadConfig(root);
      expect(config.languages).toEqual(["ts"]);
      expect(config.paths).toEqual({ ts: ["src"] });
    });
  });

  it("uses configured languages as an authoritative override", () => {
    withFixture("php.yml", {
      "package.json": "{}", "composer.json": "{}", "src/index.php": "",
    }, ["src"], (root) => {
      expect(loadConfig(root).languages).toEqual(["php"]);
    });
  });

  it("allows an explicitly configured language without its manifest", () => {
    withFixture("python.yml", { "src/index.py": "" }, ["src"], (root) => {
      expect(loadConfig(root).languages).toEqual(["python"]);
    });
  });

  it("fails when an overridden language has no usable default path", () => {
    withFixture("python.yml", {}, [], (root) => {
      expectLoadFailure(
        root,
        "python: no usable source path (src). Create .code-quality.yml with "
          + "paths.python listing your source roots, e.g. paths: { python: [app, lib] }",
      );
    });
  });

  it("reports the configuration file for malformed YAML", () => {
    withFixture("malformed.yml", {}, ["src"], (root) => {
      expectLoadFailure(root, /\.code-quality\.yml/);
    });
  });

  it("rejects a configured path that does not exist", () => {
    withRoot(
      { ".code-quality.yml": "languages: [ts]\npaths:\n  ts: [missing]\n" },
      [],
      (root) => expectLoadFailure(root, "ts: path missing does not exist"),
    );
  });

  it("reports zod path issues with their configuration path", () => {
    withRoot(
      { ".code-quality.yml": "languages: [ts]\npaths:\n  ts: [src, -generated]\n" },
      ["src"],
      (root) => expectLoadFailure(
        root,
        "paths.ts.1: must be repository-relative and must not start with -",
      ),
    );
  });

  it("rejects an explicitly missing architecture rules file", () => {
    withFixture("missing-architecture.yml", { "package.json": "{}", "src/index.ts": "" }, ["src"], (root) => {
      expectLoadFailure(root, "architecture.ts.rulesFile rules/arch.cjs does not exist");
    });
  });

});

it.each([
  ["ts", "src"],
  ["php", "src, lib, app"],
  ["python", "src"],
] as const)("suggests configured roots when %s has no default path", (language, candidates) => {
  withRoot(
    { ".code-quality.yml": `languages: [${language}]\n` },
    [],
    (root) => expectLoadFailure(
      root,
      `${language}: no usable source path (${candidates}). Create .code-quality.yml with `
        + `paths.${language} listing your source roots, e.g. paths: { ${language}: [app, lib] }`,
    ),
  );
});

describe("resolved consumer config", () => {
  it("copies disabled checks and consumer exclusions", () => {
    withFixture("disabled-exclude.yml", { "package.json": "{}", "src/index.ts": "" }, ["src"], (root) => {
      const config = loadConfig(root);
      expect(config.disabled).toEqual([
        { id: "architecture", reason: "No approved dependency-layer rules yet." },
      ]);
      expect(config.exclude).toEqual(["**/generated/**", "custom/**"]);
    });
  });
});

describe("loadConfig source validation", () => {
  it.each([
    ["ts", ".ts .tsx .js .jsx .mjs .cjs"],
    ["php", ".php"],
    ["python", ".py"],
  ] as const)("fails when %s has no source files", (language, extensions) => {
    withRoot(
      {
        ".code-quality.yml": `languages: [${language}]\npaths:\n  ${language}: [empty]\n`,
      },
      ["empty"],
      (root) => expectLoadFailure(
        root,
        `${language}: no ${language} source files found under empty (extensions: ${extensions})`,
      ),
    );
  });

  it("respects exclusions when checking for source files", () => {
    withRoot(
      {
        ".code-quality.yml": "languages: [ts]\npaths:\n  ts: [src]\nexclude:\n  - '**/generated/**'\n",
        "src/generated/index.ts": "",
      },
      ["src/generated"],
      (root) => expectLoadFailure(
        root,
        "ts: no ts source files found under src (extensions: .ts .tsx .js .jsx .mjs .cjs)",
      ),
    );
  });
});

describe("loadConfig failures", () => {
  it("uses QualityError for configuration failures", () => {
    withRoot({}, [], expectQualityFailure);
  });
});
