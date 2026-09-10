import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultPaths, detectLanguages, selectArchitecture } from "../../../src/core/config/detect.ts";

function withRoot(
  files: string[],
  directories: string[],
  run: (root: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "code-quality-detect-"));
  try {
    for (const directory of directories) mkdirSync(join(root, directory), { recursive: true });
    for (const file of files) {
      const path = join(root, file);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "{}", "utf8");
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("detectLanguages", () => {
  it("detects TypeScript from package.json", () => {
    withRoot(["package.json"], [], (root) => expect(detectLanguages(root)).toEqual(["ts"]));
  });

  it("detects PHP and Python from their manifests", () => {
    withRoot(["composer.json", "pyproject.toml"], [], (root) => {
      expect(detectLanguages(root)).toEqual(["php", "python"]);
    });
  });

  it("detects Python from setup.py", () => {
    withRoot(["setup.py"], [], (root) => expect(detectLanguages(root)).toEqual(["python"]));
  });

  it("returns no languages without manifests", () => {
    withRoot([], [], (root) => expect(detectLanguages(root)).toEqual([]));
  });
});

describe("defaultPaths", () => {
  it("returns existing PHP source roots in order", () => {
    withRoot([], ["src", "lib"], (root) => {
      expect(defaultPaths(root, "php")).toEqual(["src", "lib"]);
    });
  });
});

describe("selectArchitecture", () => {
  it("selects the conventional TypeScript rules file", () => {
    withRoot([".dependency-cruiser.cjs"], [], (root) => {
      expect(selectArchitecture(root, "ts")).toEqual({
        kind: "file",
        rulesFile: ".dependency-cruiser.cjs",
      });
    });
  });

  it("skips architecture when no rules file exists", () => {
    withRoot([], [], (root) => expect(selectArchitecture(root, "ts")).toEqual({ kind: "skip" }));
  });

  it("reports an explicit missing rules file", () => {
    withRoot([], [], (root) => {
      expect(selectArchitecture(root, "ts", "rules/arch.cjs")).toEqual({
        kind: "missing",
        rulesFile: "rules/arch.cjs",
      });
    });
  });

  it("selects an explicit rules file when it exists", () => {
    withRoot(["rules/arch.cjs"], [], (root) => {
      expect(selectArchitecture(root, "ts", "rules/arch.cjs")).toEqual({
        kind: "file",
        rulesFile: "rules/arch.cjs",
      });
    });
  });
});
