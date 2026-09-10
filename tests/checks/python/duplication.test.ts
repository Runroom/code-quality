import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { jscpdFindings } from "../../../src/checks/shared/jscpd.ts";
import { checkContext } from "../../helpers/check-context.ts";

const nativeDir = resolve("tests/fixtures/native/python-duplication");
let temporary: string | undefined;

afterEach(() => {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
  temporary = undefined;
});

describe("Python duplication captured fixture", () => {
  it("parses the native jscpd baseline", () => {
    temporary = mkdtempSync(join(tmpdir(), "python-jscpd-test-"));
    mkdirSync(join(temporary, "jscpd"));
    writeFileSync(join(temporary, "jscpd", "jscpd-report.json"),
      readFileSync(join(nativeDir, "jscpd-report.json")));
    writeFileSync(join(temporary, "jscpd-current.json"),
      readFileSync(join(nativeDir, "jscpd-current.json")));
    const ctx = checkContext("/work", "python");
    ctx.artifactDir = temporary;
    ctx.tempDir = temporary;
    const parsed = jscpdFindings(ctx);
    expect(parsed.findings).toEqual({ "534ad38acbaa6ef4": 1 });
    expect(parsed.duplicates?.[0]).toEqual({
      file: "src/demo_app/complex.py", line: 21, endLine: 59,
      secondFile: "src/demo_app/complex.py", secondLine: 22, secondEndLine: 60,
      lines: 39, tokens: 156, isNew: true,
    });
  });
});
