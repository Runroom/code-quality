import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { jscpdFindings } from "../../../src/checks/shared/jscpd.ts";
import { checkContext } from "../../helpers/check-context.ts";

const root = resolve("fixtures/python-project");
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
    const ctx = checkContext(root, "python");
    ctx.artifactDir = temporary;
    expect(jscpdFindings(ctx)).toEqual({ "534ad38acbaa6ef4": 1 });
  });
});
