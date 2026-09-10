import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { jscpdFindings } from "../../../src/checks/shared/jscpd.ts";
import { checkContext } from "../../helpers/check-context.ts";

const nativeDir = resolve("tests/fixtures/native/web-duplication");
const nativeBaseline = join(nativeDir, "jscpd-current.json");
let temporary: string | undefined;

afterEach(() => {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
  temporary = undefined;
});

describe.skipIf(!existsSync(nativeBaseline))("web duplication captured fixture", () => {
  it("parses the native jscpd baseline", () => {
    temporary = mkdtempSync(join(tmpdir(), "web-jscpd-test-"));
    mkdirSync(join(temporary, "jscpd"));
    writeFileSync(join(temporary, "jscpd", "jscpd-report.json"),
      readFileSync(join(nativeDir, "jscpd-report.json")));
    writeFileSync(join(temporary, "jscpd-current.json"), readFileSync(nativeBaseline));
    const ctx = checkContext("/work", "web");
    ctx.artifactDir = temporary;
    ctx.tempDir = temporary;
    const parsed = jscpdFindings(ctx);
    expect(Object.keys(parsed.findings).length).toBeGreaterThan(0);
    expect(parsed.duplicates?.[0]).toEqual({
      file: "assets/other.scss", line: 1, endLine: 12,
      secondFile: "assets/styles.scss", secondLine: 1, secondEndLine: 12,
      lines: 12, tokens: 83, isNew: true,
    });
  });
});
