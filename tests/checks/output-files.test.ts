import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { deptracAdapter } from "../../src/checks/php/deptrac.ts";
import { complexipyAdapter } from "../../src/checks/python/complexipy.ts";
import { deptryAdapter } from "../../src/checks/python/deptry.ts";
import { checkContext } from "../helpers/check-context.ts";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe.each([
  { adapter: deptracAdapter, message: "deptrac did not write deptrac.json" },
  { adapter: complexipyAdapter, message: "complexipy did not write" },
  { adapter: deptryAdapter, message: "deptry did not write" },
])("$adapter.id output lifecycle", ({ adapter, message }) => {
  it("removes stale output before execution and rejects a missing replacement", async () => {
    const artifactDir = mkdtempSync(join(tmpdir(), "code-quality-output-"));
    temporary.push(artifactDir);
    const ctx = checkContext("/r", adapter.language);
    ctx.artifactDir = artifactDir;
    const output = adapter.artifactOutputs!(ctx)[0]!;
    writeFileSync(output, "stale", "utf8");

    adapter.configFiles(ctx);

    expect(existsSync(output)).toBe(false);
    expect(() => adapter.parse(ctx, { stdout: "", stderr: "", exitCode: 0 }))
      .toThrow(message);
  });
});
