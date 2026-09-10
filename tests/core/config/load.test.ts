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

describe("loadConfig", () => {
  it("detects TypeScript and defaults to src without YAML", () => {
    withRoot({ "package.json": "{}", "src/index.ts": "" }, ["src"], (root) => {
      const config = loadConfig(root);
      expect(config.isDrupal).toBe(false);
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

describe("web and assets configuration", () => {
  it("includes assets in the TypeScript default roots", () => {
    withRoot({ "package.json": "{}", "assets/index.ts": "" }, ["src"], (root) => {
      const config = loadConfig(root);
      expect(config.languages).toEqual(["ts"]);
      expect(config.paths).toEqual({ ts: ["src", "assets"] });
    });
  });

  it("detects web sources without a manifest", () => {
    withRoot({ "templates/page.twig": "" }, [], (root) => {
      const config = loadConfig(root);
      expect(config.languages).toEqual(["web"]);
      expect(config.paths).toEqual({ web: ["templates"] });
    });
  });

  it("requires files for explicitly configured web", () => {
    withRoot({ ".code-quality.yml": "languages: [web]\n" }, ["templates"], (root) => {
      expectLoadFailure(
        root,
        "web: no web source files found under templates (extensions: .twig .html .css .scss .less)",
      );
    });
  });
});

describe("loadConfig auto-detection notices", () => {
  it("drops a language with no source files and records a notice", () => {
    withRoot(
      { "package.json": "{}", "composer.json": "{}", "src/index.php": "" },
      ["src"],
      (root) => {
        const config = loadConfig(root);
        expect(config.languages).toEqual(["php"]);
        expect(config.paths).toEqual({ php: ["src"] });
        expect(config.notices).toEqual([
          "ts: package.json detected but no ts source files under src; "
            + "add paths.ts to .code-quality.yml to enable TS checks",
        ]);
      },
    );
  });

  it("discovers TypeScript roots outside conventional directories", () => {
    withRoot(
      {
        "package.json": "{}",
        "common/types.ts": "",
        "plugin-src/a.ts": "",
        "ui-src/b.tsx": "",
        "tests/x.test.ts": "",
        "dist/c.js": "",
      },
      ["common", "plugin-src", "ui-src", "tests", "dist"],
      (root) => {
        const config = loadConfig(root);
        expect(config.languages).toEqual(["ts"]);
        expect(config.paths).toEqual({ ts: ["common", "plugin-src", "ui-src"] });
        expect(config.notices).toEqual([
          "ts: no ts sources under src; using detected roots common, plugin-src, ui-src",
        ]);
      },
    );
  });

  it("discovers PHP roots outside conventional directories", () => {
    withRoot(
      {
        "composer.json": "{}",
        "domain/Entity.php": "",
        "framework/Kernel.php": "",
        "tests/EntityTest.php": "",
        "dist/generated.php": "",
      },
      ["domain", "framework", "tests", "dist"],
      (root) => {
        const config = loadConfig(root);
        expect(config.languages).toEqual(["php"]);
        expect(config.paths).toEqual({ php: ["domain", "framework"] });
        expect(config.notices).toEqual([
          "php: no php sources under src; using detected roots domain, framework",
        ]);
      },
    );
  });
});

describe("Drupal and vendored-source profiles", () => {
  it("uses Drupal custom-code roots and reports the profile", () => {
    withRoot(
      {
        "composer.json": JSON.stringify({ require: { "drupal/core-recommended": "^11" } }),
        "web/core/Core.php": "<?php\n",
        "web/modules/custom/site/src/Site.php": "<?php\n",
        "web/modules/contrib/views/src/View.php": "<?php\n",
        "web/themes/custom/site/templates/page.html": "<main></main>\n",
        "web/themes/custom/site/js/site.js": "export const site = true;\n",
        "web/profiles/custom/site/SiteProfile.php": "<?php\n",
        "drush/Commands.php": "<?php\n",
        "ddev.provision/Provision.php": "<?php\n",
      },
      [],
      (root) => {
        const config = loadConfig(root);
        expect(config.isDrupal).toBe(true);
        expect(config.languages).toEqual(["ts", "php", "web"]);
        expect(config.paths).toEqual({
          ts: ["web/themes/custom"],
          php: ["web/modules/custom", "web/themes/custom", "web/profiles/custom"],
          web: ["web/themes/custom"],
        });
        expect(config.notices).toContain(
          "Drupal profile: using custom module, theme, and profile roots while excluding core, "
            + "contrib, generated, and runtime paths",
        );
      },
    );
  });

  it("falls back to ordinary discovery when Drupal has no custom roots", () => {
    withRoot(
      {
        "composer.json": JSON.stringify({ require: { "drupal/core": "^11" } }),
        "domain/Entity.php": "<?php\n",
      },
      [],
      (root) => expect(loadConfig(root).paths.php).toEqual(["domain"]),
    );
  });
});

describe("minified source discovery", () => {
  it("excludes and reports minified and versioned bundles under source roots", () => {
    withRoot(
      {
        "package.json": "{}",
        "src/index.ts": "export const value = 1;\n",
        "src/app.min.js": "minified();\n",
        "src/theme.min.css": "body{}\n",
        "src/swagger-ui-4.18.3.js": "vendored();\n",
        "src/generated.js": "x".repeat(1001),
        "src/library-1.2.3.js": "vendored();\n",
        "src/vendor-2.0.0.js": "vendored();\n",
      },
      [],
      (root) => {
        const config = loadConfig(root);
        expect(config.exclude).toEqual([
          "src/app.min.js", "src/generated.js", "src/library-1.2.3.js",
          "src/swagger-ui-4.18.3.js", "src/theme.min.css", "src/vendor-2.0.0.js",
        ]);
        expect(config.notices).toContain(
          "skipping minified/vendored files: src/app.min.js, src/generated.js, "
            + "src/library-1.2.3.js, src/swagger-ui-4.18.3.js, src/theme.min.css (+1 more)",
        );
      },
    );
  });
});

it.each([
  ["ts", "src, assets"],
  ["php", "src, lib, app"],
  ["python", "src"],
  ["web", "templates, assets"],
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
  it("treats explicit paths as an explicit language configuration", () => {
    withRoot(
      { ".code-quality.yml": "paths:\n  ts: [src]\n", "package.json": "{}" },
      ["src"],
      (root) => expectLoadFailure(
        root,
        "ts: no ts source files found under src (extensions: .ts .tsx .js .jsx .mjs .cjs)",
      ),
    );
  });

  it("fails when an explicitly configured language has no source files", () => {
    withRoot({ ".code-quality.yml": "languages: [ts]\n" }, ["src"], (root) => {
      expectLoadFailure(
        root,
        "ts: no ts source files found under src (extensions: .ts .tsx .js .jsx .mjs .cjs)",
      );
    });
  });

  it.each([
    ["ts", ".ts .tsx .js .jsx .mjs .cjs"],
    ["php", ".php"],
    ["python", ".py"],
    ["web", ".twig .html .css .scss .less"],
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
  it("returns an empty resolved configuration when no language is detected", () => {
    withRoot({}, [], (root) => {
      expect(loadConfig(root)).toMatchObject({ languages: [], paths: {}, notices: [] });
    });
  });
});
