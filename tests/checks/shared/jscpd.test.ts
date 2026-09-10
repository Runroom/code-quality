import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { jscpdAdapter, jscpdFindings } from "../../../src/checks/shared/jscpd.ts";
import { TEST_EXCLUSIONS } from "../../../src/core/config/exclusions.ts";
import { checkContext } from "../../helpers/check-context.ts";

const nativeDir = resolve("tests/fixtures/native/ts-duplication");
const temporary: string[] = [];

function reportFiles(version = 1, sources = 1, duplicates: unknown[] = [], root = "/r"): ReturnType<typeof checkContext> {
  const dir = mkdtempSync(join(tmpdir(), "jscpd-test-"));
  temporary.push(dir);
  const ctx = checkContext(root);
  ctx.artifactDir = dir;
  ctx.tempDir = dir;
  mkdirSync(join(dir, "jscpd"));
  writeFileSync(join(dir, "jscpd", "jscpd-report.json"), JSON.stringify({
    statistics: { total: { sources } },
    duplicates,
  }));
  writeFileSync(join(dir, "jscpd-current.json"), JSON.stringify({
    version,
    fingerprints: { abc: 1 },
  }));
  return ctx;
}

function duplicate(firstName: string, secondName: string): unknown {
  return {
    firstFile: {
      name: firstName, startLoc: { line: 4, column: 2 }, endLoc: { line: 12 },
    },
    secondFile: {
      name: secondName, startLoc: { line: 8, column: 3 }, endLoc: { line: 16 },
    },
    lines: 9, tokens: 51, isNew: false,
  };
}

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("jscpd adapter", () => {
  it("creates ids and formats for every language", () => {
    const formats = {
      ts: ["typescript", "tsx", "javascript", "jsx"],
      php: ["php"],
      python: ["python"],
      web: ["twig", "html", "css", "scss", "less"],
    } as const;
    for (const language of ["ts", "php", "python", "web"] as const) {
      const adapter = jscpdAdapter(language);
      const config = JSON.parse(adapter.configFiles(checkContext("/r", language))[0]!.content) as {
        absolute: boolean;
        format: string[];
        ignore: string[];
      };
      expect(adapter.id).toBe(`${language}-duplication`);
      expect(config.format).toEqual(formats[language]);
      expect(config.ignore).toEqual(expect.arrayContaining([...TEST_EXCLUSIONS]));
      expect(config.absolute).toBe(true);
    }
  });

  it("uses the temp baseline for commands, parsing, and captured artifacts", () => {
    const ctx = checkContext("/r");
    const adapter = jscpdAdapter("ts");
    expect(adapter.command(ctx).args).toContain("/tmp/quality/jscpd-current.json");
    expect(adapter.artifactOutputs?.(ctx)).toEqual([
      "/tmp/artifacts/jscpd/jscpd-report.json",
      "/tmp/quality/jscpd-current.json",
    ]);
  });
});

describe("jscpd baseline and parser", () => {
  it("returns the native baseline from the committed snapshot", () => {
    const root = mkdtempSync(join(tmpdir(), "jscpd-root-"));
    temporary.push(root);
    mkdirSync(join(root, "quality"));
    writeFileSync(join(root, "quality", "ts-duplication-baseline.json"), JSON.stringify({
      version: 1, tool: "jscpd@5.2.0", configHash: "a".repeat(64), findings: { xyz: 2 },
    }));
    const ctx = checkContext(root);
    ctx.artifactDir = join(root, "artifacts");
    const files = jscpdAdapter("ts").configFiles(ctx);
    expect(files.map((file) => file.path)).toEqual(["jscpd.json", "jscpd-current.json"]);
    expect(JSON.parse(files[1]!.content)).toEqual({ version: 1, fingerprints: { xyz: 2 } });
  });

  it("returns only jscpd.json when the snapshot is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "jscpd-root-"));
    temporary.push(root);
    const ctx = checkContext(root);
    ctx.artifactDir = join(root, "artifacts");
    expect(jscpdAdapter("ts").configFiles(ctx).map((file) => file.path))
      .toEqual(["jscpd.json"]);
  });

  it("ignores an invalid committed snapshot while seeding", () => {
    const root = mkdtempSync(join(tmpdir(), "jscpd-root-"));
    temporary.push(root);
    mkdirSync(join(root, "quality"));
    writeFileSync(join(root, "quality", "ts-duplication-baseline.json"), "not json");
    const ctx = checkContext(root);
    ctx.artifactDir = join(root, "artifacts");
    expect(jscpdAdapter("ts").configFiles(ctx).map((file) => file.path))
      .toEqual(["jscpd.json"]);
  });

  it("relativizes absolute report names under the repository root", () => {
    const root = mkdtempSync(join(tmpdir(), "jscpd-root-"));
    temporary.push(root);
    const parsed = jscpdFindings(reportFiles(1, 1, [
      duplicate(join(root, "src", "a.ts"), join(root, "src", "b.ts")),
    ], root));
    expect(parsed.duplicates?.[0]).toMatchObject({
      file: "src/a.ts", secondFile: "src/b.ts", isNew: false,
    });
  });

  it("rejects native baseline version 2", () => {
    expect(() => jscpdFindings(reportFiles(2))).toThrow();
  });

  it("accepts a report with zero sources", () => {
    expect(jscpdFindings(reportFiles(1, 0)).findings).toEqual({});
  });

});

describe("jscpd captured fixture", () => {
  it("parses the exact native fingerprint map", () => {
    const ctx = reportFiles(1, 4, [], "/work");
    const nativeReport = readFileSync(join(nativeDir, "jscpd-report.json"), "utf8");
    writeFileSync(
      join(ctx.artifactDir, "jscpd", "jscpd-report.json"),
      nativeReport,
    );
    writeFileSync(
      join(ctx.tempDir, "jscpd-current.json"),
      readFileSync(join(nativeDir, "jscpd-current.json")),
    );
    expect(nativeReport).not.toContain("ignored.test.ts");
    const parsed = jscpdFindings(ctx);
    expect(parsed.findings).toEqual({
      "52345a7776aa96cf": 1,
      f8c7fd6b65e1d3fa: 1,
    });
    expect(parsed.duplicates).toEqual([
      {
        file: "src/complexity.ts", line: 27, endLine: 86,
        secondFile: "src/complexity.ts", secondLine: 28, secondEndLine: 87,
        lines: 60, tokens: 237, isNew: true,
      },
      {
        file: "src/dup-a.ts", line: 1, endLine: 14,
        secondFile: "src/dup-b.ts", secondLine: 1, secondEndLine: 14,
        lines: 14, tokens: 68, isNew: true,
      },
    ]);
  });
});
