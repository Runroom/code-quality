import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { deriveCoverageRoot, resolveCoverage } from "../../src/report/coverage.ts";

const roots: string[] = [];

function exists(paths: ReadonlySet<string>): (path: string) => boolean {
  return (path) => paths.has(path);
}

function neverExists(): boolean {
  return false;
}

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "code-quality-coverage-"));
  roots.push(value);
  return value;
}

function write(path: string, value = ""): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function entry(path: string): object {
  return { path, s: {}, f: {}, fnMap: {} };
}

function coverage(rootPath: string, file: string, keys: readonly string[]): string {
  const path = join(rootPath, file);
  write(path, JSON.stringify(Object.fromEntries(keys.map((key) => [key, entry(key)]))));
  return path;
}

afterEach(() => {
  for (const value of roots) rmSync(value, { recursive: true, force: true });
  roots.length = 0;
});

describe("deriveCoverageRoot", () => {
  it("counts all-relative keys without deriving a root", () => {
    const repository = "/repo";
    expect(deriveCoverageRoot(
      ["src/index.ts", "src/missing.ts"],
      repository,
      exists(new Set([join(repository, "src/index.ts")])),
    )).toEqual({ matched: 1 });
  });

  it("uses the implicit no-root candidate for keys under the repository root", () => {
    const repository = "/repo";
    const keys = ["/repo/src/index.ts", "/repo/src/other.ts"];
    expect(deriveCoverageRoot(keys, repository, exists(new Set(keys))))
      .toEqual({ matched: 2 });
  });

  it("derives a foreign absolute prefix", () => {
    const repository = "/repo";
    expect(deriveCoverageRoot(
      ["/home/runner/work/project/project/src/index.ts"],
      repository,
      exists(new Set(["/repo/src/index.ts"])),
    )).toEqual({ root: "/home/runner/work/project/project", matched: 1 });
  });

  it.each([
    [
      "/home/runner/work/app/shared/src/lib.ts",
      "/home/runner/work/app/app/src/x.ts",
      "/home/runner/work/app/app/src/y.ts",
    ],
    [
      "/home/runner/work/app/app/src/y.ts",
      "/home/runner/work/app/app/src/x.ts",
      "/home/runner/work/app/shared/src/lib.ts",
    ],
  ])("is independent of key order", (...keys) => {
    const repository = "/repo";
    const repositoryFiles = new Set(["/repo/src/x.ts", "/repo/src/y.ts"]);
    expect(deriveCoverageRoot(keys, repository, exists(repositoryFiles)))
      .toEqual({ root: "/home/runner/work/app/app", matched: 2 });
  });
});

describe("deriveCoverageRoot selection", () => {
  it("derives a foreign prefix when it out-scores a first key under root", () => {
    const repository = "/repo";
    const local = "/repo/src/local.ts";
    expect(deriveCoverageRoot([
      local,
      "/home/runner/work/app/app/src/x.ts",
      "/home/runner/work/app/app/src/y.ts",
    ], repository, exists(new Set([local, "/repo/src/x.ts", "/repo/src/y.ts"]))))
      .toEqual({ root: "/home/runner/work/app/app", matched: 2 });
  });

  it("prefers the longest prefix when scores tie", () => {
    const repository = "/repo";
    expect(deriveCoverageRoot(
      ["/home/runner/work/app/app/src/index.ts"],
      repository,
      exists(new Set(["/repo/src/index.ts", "/repo/app/src/index.ts"])),
    )).toEqual({ root: "/home/runner/work/app/app", matched: 1 });
  });

  it("returns a soft zero-match result", () => {
    expect(deriveCoverageRoot(["/foreign/src/index.ts"], "/repo", neverExists))
      .toEqual({ matched: 0 });
  });

  it("matches candidate prefixes only at a path boundary", () => {
    expect(deriveCoverageRoot(
      [
        "/home/runner/work/app/src/missing.ts",
        "/home/runner/work/app-2/src/index.ts",
      ],
      "/repo",
      exists(new Set(["/repo/-2/src/index.ts"])),
    )).toEqual({ matched: 0 });
  });

  it.each([
    ["Windows", "C:\\repo\\src\\index.ts", "Windows-style coverage paths are not supported"],
    ["file URL", "file:///repo/src/index.ts", "file:// coverage paths are not supported"],
  ])("rejects sampled %s keys", (_label, key, message) => {
    expect(() => deriveCoverageRoot([key], "/repo", neverExists)).toThrow(message);
  });
});

describe("resolveCoverage", () => {
  it("accepts a file and resolves a directory to coverage-final.json", () => {
    const repository = root();
    const file = coverage(repository, "coverage/coverage-final.json", ["src/index.ts"]);
    write(join(repository, "src/index.ts"));
    expect(resolveCoverage(repository, "coverage/coverage-final.json")).toEqual({ file: realpathSync(file) });
    expect(resolveCoverage(repository, "coverage")).toEqual({ file: realpathSync(file) });
  });

  it("returns the first key when no repository file matches", () => {
    const repository = root();
    const file = coverage(repository, "coverage.json", ["/foreign/src/missing.ts"]);
    expect(resolveCoverage(repository, "coverage.json"))
      .toEqual({ file: realpathSync(file), unmatchedKey: "/foreign/src/missing.ts" });
  });

  it("rejects missing and non-Istanbul coverage", () => {
    const repository = root();
    expect(() => resolveCoverage(repository, "missing.json")).toThrow("does not exist");
    write(join(repository, "invalid.json"), JSON.stringify({ result: [] }));
    expect(() => resolveCoverage(repository, "invalid.json")).toThrow("not an Istanbul coverage map");
  });

  it("rejects an Istanbul entry without fnMap", () => {
    const repository = root();
    write(join(repository, "map.json"), JSON.stringify({
      "src/index.ts": { path: "src/index.ts", s: {}, f: {} },
    }));
    expect(() => resolveCoverage(repository, "map.json")).toThrow("not an Istanbul coverage map");
  });

  it("rejects a symlink that escapes the repository", () => {
    const repository = root();
    const outside = coverage(root(), "outside.json", ["src/index.ts"]);
    symlinkSync(outside, join(repository, "coverage.json"));
    expect(() => resolveCoverage(repository, "coverage.json"))
      .toThrow("resolves outside the repository");
  });

  it("rejects coverage larger than 256 MiB", () => {
    const repository = root();
    const file = join(repository, "large.json");
    write(file);
    truncateSync(file, 256 * 1024 * 1024 + 1);
    expect(() => resolveCoverage(repository, "large.json")).toThrow("is larger than 256 MiB");
  });
});
