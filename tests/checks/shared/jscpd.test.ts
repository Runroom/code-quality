import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { jscpdAdapter, jscpdFindings } from "../../../src/checks/shared/jscpd.ts";
import { TEST_EXCLUSIONS } from "../../../src/core/config/exclusions.ts";
import { checkContext } from "../../helpers/check-context.ts";

const nativeDir = resolve("tests/fixtures/native/ts-duplication");
const temporary: string[] = [];

function reportFiles(version = 1, sources = 1): ReturnType<typeof checkContext> {
  const dir = mkdtempSync(join(tmpdir(), "jscpd-test-"));
  temporary.push(dir);
  const ctx = checkContext("/r");
  ctx.artifactDir = dir;
  mkdirSync(join(dir, "jscpd"));
  writeFileSync(join(dir, "jscpd", "jscpd-report.json"), JSON.stringify({
    statistics: { total: { sources } },
    duplicates: [],
  }));
  writeFileSync(join(dir, "jscpd-current.json"), JSON.stringify({
    version,
    fingerprints: { abc: 1 },
  }));
  return ctx;
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
    } as const;
    for (const language of ["ts", "php", "python"] as const) {
      const adapter = jscpdAdapter(language);
      const config = JSON.parse(adapter.configFiles(checkContext("/r", language))[0]!.content) as {
        format: string[];
        ignore: string[];
      };
      expect(adapter.id).toBe(`${language}-duplication`);
      expect(config.format).toEqual(formats[language]);
      expect(config.ignore).toEqual(expect.arrayContaining([...TEST_EXCLUSIONS]));
    }
  });

  it("rejects native baseline version 2", () => {
    expect(() => jscpdFindings(reportFiles(2))).toThrow();
  });

  it("accepts a report with zero sources", () => {
    expect(jscpdFindings(reportFiles(1, 0))).toEqual({});
  });

});

describe("jscpd captured fixture", () => {
  it("parses the exact native fingerprint map", () => {
    const ctx = reportFiles();
    const nativeReport = readFileSync(join(nativeDir, "jscpd-report.json"), "utf8");
    writeFileSync(
      join(ctx.artifactDir, "jscpd", "jscpd-report.json"),
      nativeReport,
    );
    writeFileSync(
      join(ctx.artifactDir, "jscpd-current.json"),
      readFileSync(join(nativeDir, "jscpd-current.json")),
    );
    expect(nativeReport).not.toContain("ignored.test.ts");
    expect(jscpdFindings(ctx)).toEqual({
      "52345a7776aa96cf": 1,
      f8c7fd6b65e1d3fa: 1,
    });
  });
});
