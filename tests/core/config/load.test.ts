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
import { isExcluded, nextExclusions, payloadExclusions } from "../../../src/core/config/exclusions.ts";

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

function pythonRuntimeNotices(notices: readonly string[]): string[] {
  return notices.filter((notice) => notice.startsWith("python: targeting"));
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

describe("loadConfig workspace roots", () => {
  it("detects a depth-one TypeScript package beside a Python application", () => {
    withRoot({
      "pyproject.toml": "{}",
      "src/app.py": "",
      "frontend/package.json": "{}",
      "frontend/src/index.ts": "",
    }, [], (root) => {
      const config = loadConfig(root);
      expect(config.languages).toEqual(["ts", "python"]);
      expect(config.paths.ts).toEqual(["frontend/src"]);
    });
  });

  it.each(["node_modules/vendor", "tests/frontend"])(
    "does not detect TypeScript from an excluded %s package",
    (directory) => withRoot({
      "pyproject.toml": "{}",
      "src/app.py": "",
      [`${directory}/package.json`]: "{}",
      [`${directory}/src/index.ts`]: "",
    }, [], (root) => expect(loadConfig(root).languages).toEqual(["python"])),
  );

  it("does not detect TypeScript from a consumer-excluded depth-one package", () => {
    withRoot({
      ".code-quality.yml": "exclude: [frontend/**]\n",
      "pyproject.toml": "{}",
      "src/app.py": "",
      "frontend/package.json": "{}",
      "frontend/src/index.ts": "",
    }, [], (root) => expect(loadConfig(root).languages).toEqual(["python"]));
  });

  it("does not detect TypeScript from a depth-one Cypress package", () => {
    withRoot({
      "pyproject.toml": "{}", "src/app.py": "",
      "cypress/package.json": "{}", "cypress/e2e/x.cy.ts": "",
    }, [], (root) => expect(loadConfig(root).languages).toEqual(["python"]));
  });

});

describe("loadConfig manifest workspace roots", () => {

  it("adds Composer autoload roots to conventional PHP roots", () => {
    const packageRoots = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"]
      .map((name) => `packages/${name}/src`);
    const psr4 = Object.fromEntries(
      packageRoots.map((directory) => [`Package${directory.slice(9, 10).toUpperCase()}\\\\`, `${directory}/`]),
    );
    const packageFiles = Object.fromEntries(
      Object.values(psr4).map((directory) => [`${directory}Package.php`, "<?php\n"]),
    );
    withRoot({
      "composer.json": JSON.stringify({
        autoload: { "psr-4": psr4 },
        "autoload-dev": { "psr-4": { "App\\\\": "src/" } },
      }),
      "src/App.php": "<?php\n",
      ...packageFiles,
    }, [], (root) => {
      const config = loadConfig(root);
      expect(config.paths.php).toEqual(["src", ...packageRoots]);
      expect(config.notices).toContain(
        `php: added workspace roots ${packageRoots.join(", ")}`,
      );
    });
  });

  it("resolves pnpm members instead of their container directories", () => {
    withRoot({
      "package.json": "{}",
      "pnpm-workspace.yaml": "packages: ['packages/*', 'apps/*']\n",
      "apps/web/src/index.ts": "",
      "apps/web/package.json": "{}",
      "apps/web/tests/index.ts": "",
      "packages/core/src/index.ts": "",
      "packages/core/package.json": "{}",
      "packages/core/tests/index.ts": "",
    }, [], (root) => {
      const config = loadConfig(root);
      expect(config.paths.ts).toEqual(["apps/web/src", "packages/core/src"]);
      expect(config.notices).toContain(
        "ts: added workspace roots apps/web/src, packages/core/src",
      );
    });
  });
});

describe("loadConfig workspace discovery union", () => {
  it("unions workspace roots with discovered roots when conventional roots are empty", () => {
    withRoot({
      "package.json": "{}",
      "pnpm-workspace.yaml": "packages: ['packages/*']\n",
      "packages/core/package.json": "{}",
      "packages/core/src/index.ts": "",
      "scripts/tool.ts": "",
    }, [], (root) => {
      const config = loadConfig(root);
      expect(config.paths.ts).toEqual(["packages/core/src", "scripts"]);
      expect(config.notices).toContain("ts: added workspace roots packages/core/src");
    });
  });
});

describe("loadConfig conventional and workspace roots", () => {
  it("combines a conventional root with a depth-1 package root", () => {
    withRoot({
      "package.json": "{}",
      "src/index.ts": "",
      "server/package.json": "{}",
      "server/index.ts": "",
    }, [], (root) => {
      const config = loadConfig(root);
      expect(config.paths.ts).toEqual(["src", "server"]);
      expect(config.notices).toContain("ts: added workspace roots server");
    });
  });
});

describe("loadConfig workspace root overrides", () => {
  it("does not augment explicitly configured paths", () => {
    withRoot({
      ".code-quality.yml": "paths:\n  ts: [custom]\n",
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "custom/index.ts": "",
      "packages/core/src/index.ts": "",
    }, [], (root) => expect(loadConfig(root).paths.ts).toEqual(["custom"]));
  });

  it("resolves an explicit language from workspace roots without src", () => {
    withRoot({
      ".code-quality.yml": "languages: [ts]\n",
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "packages/core/package.json": "{}",
      "packages/core/src/index.ts": "",
    }, [], (root) => expect(loadConfig(root).paths.ts).toEqual(["packages/core/src"]));
  });
});

describe("Drupal extension source detection", () => {
  it("detects Drupal module files as PHP sources", () => {
    withRoot(
      {
        "composer.json": JSON.stringify({ require: { "drupal/core-recommended": "^11" } }),
        "web/modules/custom/demo/demo.module": "<?php\nfunction demo_help() { return 1; }\n",
        ".code-quality.yml": "paths:\n  php: [web/modules/custom/demo]\n",
      },
      [],
      (root) => {
        const config = loadConfig(root);
        expect(config.paths.php).toContain("web/modules/custom/demo");
        expect(config.languages).toContain("php");
      },
    );
  });

  it("does not treat Drupal module extensions as PHP outside Drupal", () => {
    withRoot(
      {
        "composer.json": JSON.stringify({ require: { "vendor/package": "^1" } }),
        "web/modules/custom/demo/demo.module": "<?php\nfunction demo_help() { return 1; }\n",
      },
      [],
      (root) => {
        const config = loadConfig(root);
        expect(config.isDrupal).toBe(false);
        expect(config.languages).not.toContain("php");
        expect(config.paths.php).toBeUndefined();
      },
    );
  });

  it("allows explicit Drupal module paths but rejects them outside Drupal", () => {
    const files = {
      ".code-quality.yml": "paths:\n  php: [custom]\n",
      "custom/demo.module": "<?php\nfunction demo_help() { return 1; }\n",
    };
    withRoot(
      { ...files, "composer.json": JSON.stringify({ require: { "drupal/core": "^11" } }) },
      [],
      (root) => expect(loadConfig(root).paths.php).toEqual(["custom"]),
    );
    withRoot(
      { ...files, "composer.json": JSON.stringify({ require: { "vendor/package": "^1" } }) },
      [],
      (root) => expectLoadFailure(root, "php: no php source files found under custom (extensions: .php)"),
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

  it("does not augment curated Drupal PHP roots from Composer autoload", () => {
    withRoot({
      "composer.json": JSON.stringify({
        require: { "drupal/core": "^11" },
        autoload: { "psr-4": { "Domain\\\\": "domain/" } },
      }),
      "web/modules/custom/demo/demo.module": "<?php\n",
      "domain/Entity.php": "<?php\n",
    }, [], (root) => {
      expect(loadConfig(root).paths.php).toEqual(["web/modules/custom"]);
    });
  });
});

describe("Payload and Next profiles", () => {
  it("a plain Next app excludes only Next output and keeps migrations and seed in scope", () => {
    const sourceFiles = {
      "package.json": "{}",
      "src/app/page.tsx": "export default function Page() { return null; }\n",
      ".code-quality.yml": "exclude:\n  - '**/consumer-generated/**'\n",
    };
    let ordinaryHash = "";
    withRoot(sourceFiles, [], (root) => {
      ordinaryHash = loadConfig(root).configHash;
    });
    withRoot({ ...sourceFiles, "next.config.mjs": "export default {};\n" }, [], (root) => {
      const config = loadConfig(root);
      expect(config.exclude).toEqual([
        "**/consumer-generated/**",
        ...nextExclusions("."),
      ]);
      expect(config.notices).toContain(
        "Next profile: excluding Next build output",
      );
      expect(isExcluded("src/migrations/x.ts", config.exclude)).toBe(false);
      expect(isExcluded("src/seed/x.ts", config.exclude)).toBe(false);
      expect(config.configHash).not.toBe(ordinaryHash);
    });
  });

  it("activates Payload exclusions from the package dependency", () => {
    withRoot({
      "package.json": JSON.stringify({ dependencies: { payload: "3.0.0" } }),
      "src/index.ts": "",
      "src/payload-types.ts": "",
    }, [], (root) => {
      const config = loadConfig(root);
      expect(config.exclude).toEqual(payloadExclusions(["src"]));
      expect(config.notices).toContain(
        "Payload profile: excluding generated Payload types, import map, admin route group, "
          + "migrations, and seed data",
      );
    });
  });
});

describe("Payload/Next scoped exclusions", () => {
  it("records Payload exclusions only under resolved TypeScript roots", () => {
    withRoot({
      ".code-quality.yml": "paths:\n  ts: [assets]\n",
      "package.json": "{}",
      "payload.config.ts": "export default {};\n",
      "assets/index.ts": "",
      "assets/migrations/x.ts": "",
      "src/migrations/Version1.php": "<?php\n",
    }, [], (root) => {
      const config = loadConfig(root);
      expect(config.exclude).toContain("assets/**/migrations/**");
      expect(config.exclude).not.toContain("**/migrations/**");
      expect(config.exclude.join("\n")).not.toContain("src/migrations");
      expect(isExcluded("src/migrations/Version1.php", config.exclude)).toBe(false);
      expect(isExcluded("assets/migrations/x.ts", config.exclude)).toBe(true);
    });
  });

  it("does not resolve TypeScript when Payload-generated files are the only sources", () => {
    withRoot({
      "package.json": "{}",
      "payload.config.ts": "export default {};\n",
      "src/migrations/x.ts": "",
      "src/payload-types.ts": "",
    }, [], (root) => {
      const config = loadConfig(root);
      expect(config.languages).toEqual([]);
      expect(config.paths.ts).toBeUndefined();
      expect(config.exclude).toEqual([]);
      expect(config.notices).toEqual([
        "ts: package.json detected but no ts source files under src; "
          + "add paths.ts to .code-quality.yml to enable TS checks",
      ]);
    });
  });

  it("does not apply the profile when TypeScript does not resolve", () => {
    withRoot({
      "composer.json": "{}",
      "payload.config.ts": "export default {};\n",
      "src/index.php": "<?php\n",
    }, [], (root) => {
      const config = loadConfig(root);
      expect(config.languages).toEqual(["php"]);
      expect(config.exclude).toEqual([]);
      expect(config.notices).not.toContain(
        "Payload profile: excluding generated Payload types, import map, admin route group, "
          + "migrations, and seed data",
      );
    });
  });
});

describe("workspace Payload and Next profiles", () => {
  it("scopes Payload exclusions and notices to the owning workspace", () => {
    withRoot({
      "package.json": JSON.stringify({ workspaces: ["apps/*"] }),
      "apps/cms/package.json": "{}",
      "apps/cms/payload.config.ts": "export default {};\n",
      "apps/cms/src/index.ts": "",
      "apps/cms/src/types/payload-types.ts": "",
      "apps/web/package.json": "{}",
      "apps/web/next.config.mjs": "export default {};\n",
      "apps/web/src/index.ts": "",
      "apps/web/src/migrations/keep.ts": "",
    }, [], (root) => {
      const config = loadConfig(root);
      expect(isExcluded("apps/cms/src/types/payload-types.ts", config.exclude)).toBe(true);
      expect(isExcluded("apps/web/src/migrations/keep.ts", config.exclude)).toBe(false);
      expect(config.notices).toContain("Payload profile: excluding generated Payload types, import map, admin route group, migrations, and seed data (apps/cms)");
      expect(config.notices).toContain("Next profile: excluding Next build output (apps/web)");
    });
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

describe("Python runtime configuration", () => {
  it("adds one Python 3.14 runtime notice", () => {
    withRoot({
      "pyproject.toml": "[project]\nrequires-python = \">=3.14\"\n",
      "src/index.py": "",
    }, ["src"], (root) => {
      expect(pythonRuntimeNotices(loadConfig(root).notices))
        .toEqual([
          "python: targeting 3.14 (from requires-python); tools run on CPython 3.14.7",
        ]);
    });
  });

  it("omits the runtime notice without a resolved Python language", () => {
    withRoot({ ".python-version": "3.14\n", "package.json": "{}", "src/index.ts": "" }, ["src"], (root) => {
      expect(pythonRuntimeNotices(loadConfig(root).notices)).toEqual([]);
    });
  });

  it("omits the runtime notice below Python 3.14", () => {
    withRoot({ ".python-version": "3.12\n", "pyproject.toml": "[project]\n", "src/index.py": "" }, ["src"], (root) => {
      expect(pythonRuntimeNotices(loadConfig(root).notices)).toEqual([]);
    });
  });

  it("includes an added Python target in the config hash", () => {
    const files = { "pyproject.toml": "[project]\n", "src/index.py": "" };
    let hashWithout = "";
    withRoot(files, ["src"], (root) => { hashWithout = loadConfig(root).configHash; });
    withRoot({ ...files, ".python-version": "3.14\n" }, ["src"], (root) => {
      expect(loadConfig(root).configHash).not.toBe(hashWithout);
    });
  });

  it("changes the config hash when the Python target changes", () => {
    const files = { "pyproject.toml": "[project]\n", "src/index.py": "" };
    let hash312 = "";
    withRoot({ ...files, ".python-version": "3.12\n" }, ["src"], (root) => {
      hash312 = loadConfig(root).configHash;
    });
    withRoot({ ...files, ".python-version": "3.14\n" }, ["src"], (root) => {
      expect(loadConfig(root).configHash).not.toBe(hash312);
    });
  });

  it("ignores a Python target in the hash when Python is not a resolved language", () => {
    const files = { "package.json": "{}", "src/index.ts": "" };
    let hashWithout = "";
    withRoot(files, ["src"], (root) => { hashWithout = loadConfig(root).configHash; });
    withRoot({ ...files, ".python-version": "3.14\n" }, ["src"], (root) => {
      expect(loadConfig(root).configHash).toBe(hashWithout);
      expect(loadConfig(root).languages).toEqual(["ts"]);
    });
  });
});

describe("Python image compatibility notice", () => {
  it("reports when a target is newer than the image", () => {
    withRoot({
      ".python-version": "3.15\n",
      "pyproject.toml": "[project]\n",
      "src/index.py": "",
    }, ["src"], (root) => {
      expect(pythonRuntimeNotices(loadConfig(root).notices)).toEqual([
        "python: targeting 3.15 (from .python-version), newer than the image; tools run on CPython 3.14.7",
      ]);
    });
  });
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

  it("includes report only when configured and excludes it from the config hash", () => {
    const files = { "package.json": "{}", "src/index.ts": "" };
    let hashWithout = "";
    withRoot(files, ["src"], (root) => {
      const config = loadConfig(root);
      expect(config.report).toBeUndefined();
      hashWithout = config.configHash;
    });
    withRoot({
      ...files,
      ".code-quality.yml": "report:\n  coverage: coverage/coverage-final.json\n",
    }, ["src"], (root) => {
      const config = loadConfig(root);
      expect(config.report).toEqual({ coverage: "coverage/coverage-final.json" });
      expect(config.configHash).toBe(hashWithout);
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
