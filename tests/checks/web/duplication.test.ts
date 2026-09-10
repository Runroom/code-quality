import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { jscpdFindings } from "../../../src/checks/shared/jscpd.ts";
import { checkContext } from "../../helpers/check-context.ts";

const root = resolve("fixtures/web-project");
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
    const ctx = checkContext(root, "web");
    ctx.artifactDir = temporary;
    expect(Object.keys(jscpdFindings(ctx)).length).toBeGreaterThan(0);
  });
});
