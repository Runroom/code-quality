import { describe, expect, it } from "vitest";

import { QualityError } from "../../../src/core/errors.ts";
import { parseVersion, verifyTool } from "../../../src/core/runner/verify.ts";

function unexpectedVersion(): void {
  verifyTool({ bin: "x", version: "1.0.0" }, () => "x 1.0.1");
}

describe("parseVersion", () => {
  it.each([
    ["oxlint 1.82.0", "1.82.0"],
    ["PHP_CodeSniffer version 4.0.4 (stable) by Squiz and PHPCSStandards", "4.0.4"],
    ["Import Linter, version 2.15", "2.15"],
    ["PHPStan - PHP Static Analysis Tool 2.2.13", "2.2.13"],
    ["vulture 2.16", "2.16"],
    ["ruff 0.16.6", "0.16.6"],
  ])("reads %s", (output, expected) => expect(parseVersion(output)).toBe(expected));
});

describe("verifyTool", () => {
  it("rejects an unexpected version with both versions", () => {
    expect(unexpectedVersion).toThrow(
      new QualityError(
        "Expected x 1.0.0, received 1.0.1; review the tool upgrade and baselines together.",
      ),
    );
  });
});
