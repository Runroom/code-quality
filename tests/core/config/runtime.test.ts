import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compareMajorMinor, isAtLeast, pythonTarget } from "../../../src/core/config/runtime.ts";

function withRoot(files: Record<string, string>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "code-quality-runtime-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      const path = join(root, file);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, content);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("pythonTarget", () => {
  it.each([
    ["3.14", "3.14"],
    ["3.14.2", "3.14"],
    ["cpython@3.14", "3.14"],
    ["cpython-3.14", "3.14"],
    ["cpython-3.14.7-linux-x86_64-gnu", "3.14"],
    ["3.14.0b1", "3.14"],
    ["3.14.0a2", "3.14"],
    ["3.14rc1", "3.14"],
  ])("reads .python-version form %s", (value, version) => {
    withRoot({ ".python-version": `\n${value}\n` }, (root) => {
      expect(pythonTarget(root)).toEqual({ version, source: ".python-version" });
    });
  });

  it("skips blank and comment lines with CRLF endings", () => {
    withRoot({ ".python-version": "\r\n# managed by uv\r\ncpython@3.14\r\n" }, (root) => {
      expect(pythonTarget(root)?.version).toBe("3.14");
    });
  });

  it.each([
    [">=3.12", "3.12"],
    [">3.11", "3.11"],
    ["~=3.10.4", "3.10"],
    ["==3.13.*", "3.13"],
    ["==3.14.1", "3.14"],
    [">=3.12, !=3.13.*, <4", "3.12"],
    [">=3.12, >=3.10", "3.12"],
    [">=3.9, ~=3.14", "3.14"],
    [">= 3.14", "3.14"],
  ])("reads requires-python constraint %s", (constraint, version) => {
    withRoot({ "pyproject.toml": `[project]\nrequires-python = "${constraint}"\n` }, (root) => {
      expect(pythonTarget(root)).toEqual({ version, source: "requires-python" });
    });
  });

  it.each(["<4", "!=3.12.*", "^3.12", "3.12", ">=3.12, nope"])(
    "rejects requires-python constraint %s",
    (constraint) => {
      withRoot({ "pyproject.toml": `[project]\nrequires-python = "${constraint}"\n` }, (root) => {
        expect(pythonTarget(root)).toBeUndefined();
      });
    },
  );

  it("uses the highest target from uv workspace members when the root has none", () => {
    withRoot({
      "pyproject.toml": "[tool.uv.workspace]\nmembers = [\"packages/*\"]\n",
      "packages/api/pyproject.toml": "[project]\nrequires-python = \">=3.13\"\n",
      "packages/svc/pyproject.toml": "[project]\nrequires-python = \">=3.14\"\n",
      "packages/svc/.python-version": "3.15\n",
    }, (root) => expect(pythonTarget(root)).toEqual({
      version: "3.15", source: "packages/svc/.python-version",
    }));
  });
});

describe("pythonTarget fallback and safe reads", () => {
  it("returns undefined for malformed TOML", () => {
    withRoot({ "pyproject.toml": "[project\n" }, (root) => expect(pythonTarget(root)).toBeUndefined());
  });

  it("prefers .python-version over requires-python", () => {
    withRoot({
      ".python-version": "3.14\n",
      "pyproject.toml": "[project]\nrequires-python = \">=3.10\"\n",
    }, (root) => expect(pythonTarget(root)?.version).toBe("3.14"));
  });

  it.each(["pypy@3.10", "pypy3.10", "graalpy@3.11"])(
    "ignores %s and falls back to requires-python",
    (value) => {
      withRoot({
        ".python-version": `${value}\n`,
        "pyproject.toml": "[project]\nrequires-python = \">=3.12\"\n",
      }, (root) => expect(pythonTarget(root)?.version).toBe("3.12"));
    },
  );

  it("returns undefined when no target exists", () => {
    withRoot({}, (root) => expect(pythonTarget(root)).toBeUndefined());
  });

  it.each([".python-version", "pyproject.toml"])("ignores a directory named %s", (name) => {
    withRoot({}, (root) => {
      mkdirSync(join(root, name));
      expect(pythonTarget(root)).toBeUndefined();
    });
  });

  it("ignores an oversized .python-version", () => {
    withRoot({ ".python-version": `3.14\n${"#".repeat(4096)}` }, (root) => {
      expect(pythonTarget(root)).toBeUndefined();
    });
  });

  it("ignores an oversized pyproject.toml", () => {
    withRoot({
      "pyproject.toml": `[project]\nrequires-python = ">=3.14"\n#${"x".repeat(1024 * 1024)}`,
    }, (root) => expect(pythonTarget(root)).toBeUndefined());
  });
});

describe("major/minor comparison", () => {
  it("compares major and minor versions numerically", () => {
    expect(compareMajorMinor("3.14", "3.14")).toBe(0);
    expect(compareMajorMinor("3.15", "3.14")).toBeGreaterThan(0);
    expect(compareMajorMinor("3.9", "3.14")).toBeLessThan(0);
    expect(isAtLeast("3.14", "3.14")).toBe(true);
    expect(isAtLeast("3.15", "3.14")).toBe(true);
    expect(isAtLeast("4.0", "3.14")).toBe(true);
    expect(isAtLeast("3.9", "3.14")).toBe(false);
  });
});
