import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";
import picomatch from "picomatch";

import {
  deptryAdapter,
  deptryExcludeRegex,
  deptryFindings,
} from "../../../src/checks/python/deptry.ts";
import { BUILTIN_EXCLUSIONS, TEST_EXCLUSIONS } from "../../../src/core/config/exclusions.ts";
import { checkContext } from "../../helpers/check-context.ts";

const root = resolve("fixtures/python-project");
const nativeFile = resolve("tests/fixtures/native/python-unused-deptry/deptry.json");

function report(code: string): unknown {
  return [{ error: { code, message: "dependency issue" }, module: "requests",
    location: { file: "pyproject.toml", line: null, column: null } }];
}

function writeDistributions(site: string, distributions: Record<string, Record<string, string>>): void {
  for (const [directory, files] of Object.entries(distributions)) {
    mkdirSync(join(site, directory), { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      writeFileSync(join(site, directory, file), content);
    }
  }
}

function writeDependencyManifest(projectRoot: string): void {
  writeFileSync(join(projectRoot, "pyproject.toml"), [
    "[project]", "dependencies = ['Pillow>=11', 'PyJWT>=2']",
    "[project.optional-dependencies]", "images = ['python-pptx>=1']",
    "[dependency-groups]", "dev = ['PyMuPDF>=1']",
    "[tool.poetry.dependencies]", "PoetryPkg = '^1'",
    "[tool.poetry.group.dev.dependencies]", "PoetryGroup = '^1'",
    "[tool.pdm.dev-dependencies]", "test = ['PdmPkg>=1']",
    "[tool.uv]", "dev-dependencies = ['UvPkg>=1']", "",
  ].join("\n"));
}

describe("deptry synthetic parser", () => {
  const ctx = checkContext("/r", "python");

  it("rejects unknown DEP009 diagnostics", () => {
    expect(() => deptryFindings(ctx, report("DEP009"))).toThrow();
  });

  it("uses the DEP002 dependency key shape", () => {
    expect(deptryFindings(ctx, report("DEP002")).findings).toEqual({
      "pyproject.toml | deptry-DEP002 | requests": 1,
    });
  });

  it("counts repeated diagnostics with the same file, code, and module", () => {
    const diagnostic = (report("DEP001") as unknown[])[0];
    expect(deptryFindings(ctx, [diagnostic, diagnostic, diagnostic]).findings).toEqual({
      "pyproject.toml | deptry-DEP001 | requests": 3,
    });
  });

  it("converts built-in exclusions to Rust-compatible regexes", () => {
    expect(BUILTIN_EXCLUSIONS.map(deptryExcludeRegex)).toEqual([
      "^(?:.*/)?node_modules(?:/.*)?$", "^(?:.*/)?vendor(?:/.*)?$",
      "^(?:.*/)?\\.venv(?:/.*)?$", "^(?:.*/)?dist(?:/.*)?$",
      "^(?:.*/)?artifacts(?:/.*)?$", "^(?:.*/)?public/build(?:/.*)?$",
      "^(?:.*/)?[^/]*\\.min\\.js$", "^(?:.*/)?[^/]*\\.min\\.css$",
      "^(?:.*/)?web/core(?:/.*)?$", "^(?:.*/)?docroot/core(?:/.*)?$",
      "^(?:.*/)?modules/contrib(?:/.*)?$", "^(?:.*/)?themes/contrib(?:/.*)?$",
      "^(?:.*/)?profiles/contrib(?:/.*)?$", "^(?:.*/)?libraries(?:/.*)?$",
      "^(?:.*/)?sites/[^/]*/files(?:/.*)?$", "^(?:.*/)?drush(?:/.*)?$",
      "^(?:.*/)?ddev\\.provision(?:/.*)?$", "^(?:.*/)?var(?:/.*)?$",
    ]);
  });

  it("matches built-in and test exclusions like picomatch for representative paths", () => {
    const paths = [
      "backend/tests/api/test_health.py", "tests/test_root.py", "backend/test/unit.py",
      "backend/test_health.py", "backend/health_test.py", "backend/conftest.py",
      "src/a.test.ts", "src/a.spec.ts", "src/__tests__/a.ts", "src/ThingTest.php",
      "node_modules/a/index.js", "app/vendor/a.php", ".venv/lib/site.py", "src/dist/a.js",
      "artifacts/a.json", "public/build/a.js", "src/a.min.js", "src/a.min.css",
      "web/core/a.php", "docroot/core/a.php", "modules/contrib/a.php",
      "themes/contrib/a.php", "profiles/contrib/a.php", "libraries/a.js",
      "sites/default/files/a.png", "drush/a.php", "ddev.provision/a.php", "var/cache/a",
      "backend/api/health.py", "src/a.ts", "vendorized/a.py",
      "src/generated/a.py", "src/a/generated/b.py", "src/a/b.py", "a/x.py", "b/y.py",
      "foo1.py", "nested/foo2.py", "foo3.py", "anything/at/all.txt",
    ];
    const globs = [...BUILTIN_EXCLUSIONS, ...TEST_EXCLUSIONS,
      "src/**/generated/**", "src/**/*.py", "**", "{a,b}/**", "**/foo[12].py"];
    for (const glob of globs) {
      const regex = new RegExp(deptryExcludeRegex(glob), "u");
      const matcher = picomatch(glob, { dot: true });
      for (const path of paths) expect(regex.test(path), `${glob}: ${path}`).toBe(matcher(path));
    }
  });

});

describe("deptry command configuration", () => {

  it("converts and escapes a consumer exclusion glob", () => {
    expect(deptryExcludeRegex("**/generated.v1/**")).toBe("^(?:.*/)?generated\\.v1(?:/.*)?$");
    expect(deptryExcludeRegex("src/generated?.py")).toBe("^src/generated[^/]\\.py$");
  });

  it("passes converted exclusions to deptry", () => {
    const configured = checkContext("/r", "python");
    configured.config.exclude.push("**/generated.v1/**");
    const args = deptryAdapter.command(configured).args;
    expect(args).toContain("^(?:.*/)?generated\\.v1(?:/.*)?$");
    expect(args.every((arg) => !arg.includes("(?="))).toBe(true);
    expect(args).toContain("--extend-exclude");
    expect(args).not.toContain("--exclude");
  });

  it("passes package directories and src-layout modules as known first party", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "deptry-first-party-"));
    try {
      mkdirSync(join(tempRoot, "backend"));
      mkdirSync(join(tempRoot, "src/domain"), { recursive: true });
      mkdirSync(join(tempRoot, "scripts"));
      writeFileSync(join(tempRoot, "__init__.py"), "");
      writeFileSync(join(tempRoot, "single.py"), "");
      writeFileSync(join(tempRoot, "backend/__init__.py"), "");
      writeFileSync(join(tempRoot, "src/domain/__init__.py"), "");
      writeFileSync(join(tempRoot, "src/service.py"), "");
      writeFileSync(join(tempRoot, "scripts/report.py"), "");
      const configured = checkContext(tempRoot, "python");
      configured.paths = [".", "backend", "src", "scripts", "single.py"];
      const args = deptryAdapter.command(configured).args;
      expect(args.filter((arg) => arg === "--known-first-party")).toHaveLength(4);
      expect(args).toEqual(expect.arrayContaining(["backend", "domain", "service", "report"]));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

});

describe("deptry consumer virtualenv mapping", () => {

  it("maps installed distributions to modules from a consumer virtualenv", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "deptry-venv-map-"));
    try {
      const site = join(tempRoot, ".venv/lib/python3.13/site-packages");
      const distributions: Record<string, Record<string, string>> = {
        "python_pptx-1.0.dist-info": {
          METADATA: "Metadata-Version: 2.4\nName: Python-PPTX\n",
          "top_level.txt": "pptx\n",
        },
        "Pillow-11.0.dist-info": {
          METADATA: "Name: pillow\n",
          RECORD: "PIL/__init__.py,,\nPIL/Image.py,,\nPillow-11.0.dist-info/METADATA,,\n",
        },
        "PyJWT-2.0.dist-info": { METADATA: "Name: PyJWT\n", RECORD: "jwt/__init__.py,,\n" },
        "PyMuPDF-1.0.dist-info": { METADATA: "Name: PyMuPDF\n", RECORD: "fitz/__init__.py,,\n" },
        "Some-Package-1.0.dist-info": {
          METADATA: "Name: some-package\n", "top_level.txt": "some\n",
        },
        "poetrypkg-1.0.dist-info": { METADATA: "Name: poetrypkg\n", "top_level.txt": "poetry_mod\n" },
        "poetrygroup-1.0.dist-info": {
          METADATA: "Name: poetrygroup\n", "top_level.txt": "poetry_group_mod\n",
        },
        "pdmpkg-1.0.dist-info": { METADATA: "Name: pdmpkg\n", "top_level.txt": "pdm_mod\n" },
        "uvpkg-1.0.dist-info": { METADATA: "Name: uvpkg\n", "top_level.txt": "uv_mod\n" },
        "evil-1.0.dist-info": { METADATA: "Name: zz,requests=os|sys\n", "top_level.txt": "os\n" },
        "a,b=c-1.0.dist-info": { "top_level.txt": "sys\n" },
      };
      writeDistributions(site, distributions);
      writeDependencyManifest(tempRoot);
      writeFileSync(join(tempRoot, "requirements-dev.txt"), "Some-Package==1\n");
      const configured = checkContext(tempRoot, "python");
      const args = deptryAdapter.command(configured).args;
      const map = args[args.indexOf("--package-module-name-map") + 1];
      expect(map).toBe(
        "PdmPkg=pdm_mod,Pillow=PIL,PoetryGroup=poetry_group_mod,PoetryPkg=poetry_mod,PyJWT=jwt,"
          + "PyMuPDF=fitz,python-pptx=pptx,Some-Package=some,UvPkg=uv_mod",
      );
      expect(map).not.toMatch(/zz|requests=os|a,b=c/u);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("omits the package-module map without a consumer virtualenv", () => {
    expect(deptryAdapter.command(checkContext("/r", "python")).args)
      .not.toContain("--package-module-name-map");
  });
});

describe.skipIf(!existsSync(nativeFile))("deptry captured fixture", () => {
  it("finds requests as an unused dependency", () => {
    const input = JSON.parse(readFileSync(nativeFile, "utf8")) as unknown;
    const parsed = deptryFindings(checkContext(root, "python"), input);
    const key = "pyproject.toml | deptry-DEP002 | requests";
    expect(parsed.findings).toHaveProperty(key, 1);
    expect(parsed.details[key]).toMatchObject({
      message: "'requests' defined as a dependency but not used in the codebase",
    });
  });
});
