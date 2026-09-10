import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { jscpdFindings } from "../../../src/checks/shared/jscpd.ts";
import { checkContext } from "../../helpers/check-context.ts";

const nativeDir = resolve("tests/fixtures/native/php-duplication");
let temporary: string | undefined;

afterEach(() => {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
  temporary = undefined;
});

describe("php duplication captured fixture", () => {
  it("parses the exact PHP fingerprint", () => {
    temporary = mkdtempSync(join(tmpdir(), "php-jscpd-test-"));
    mkdirSync(join(temporary, "jscpd"));
    writeFileSync(join(temporary, "jscpd", "jscpd-report.json"),
      readFileSync(join(nativeDir, "jscpd-report.json")));
    writeFileSync(join(temporary, "jscpd-current.json"),
      readFileSync(join(nativeDir, "jscpd-current.json")));
    const ctx = checkContext("/work", "php");
    ctx.artifactDir = temporary;
    ctx.tempDir = temporary;
    const parsed = jscpdFindings(ctx);
    expect(parsed.findings).toEqual({ "4e1f30eae51b9473": 1 });
    expect(parsed.duplicates?.[0]).toEqual({
      file: "src/Service/Complex.php", line: 55, endLine: 83,
      secondFile: "src/Service/Complex.php", secondLine: 56, secondEndLine: 84,
      lines: 29, tokens: 174, isNew: true,
    });
  });
});
