import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ruffConfig, ruffFindings } from "../../../src/checks/python/ruff.ts";
import { POLICY } from "../../../src/core/config/policy.ts";
import { checkContext } from "../../helpers/check-context.ts";

const root = resolve("fixtures/python-project");
const nativeFile = resolve("tests/fixtures/native/python-complexity/stdout.json");
const source = "def busy(a, b, c, d, e):\n    return 1\n";

function report(code: string | null, message: string): unknown {
  return [{ code, message, filename: "src/a.py", location: { row: 1, column: 5 } }];
}

describe("ruff config and synthetic parser", () => {
  it("generates thresholds 10, 4, 60, and 3", () => {
    expect(ruffConfig()).toContain(`max-complexity = ${POLICY.complexity}`);
    expect(ruffConfig()).toContain(`max-args = ${POLICY.maxParams}`);
    expect(ruffConfig()).toContain(`max-statements = ${POLICY.maxLinesPerFunction}`);
    expect(ruffConfig()).toContain(`max-nested-blocks = ${POLICY.maxDepth}`);
  });

  it.each(["3.10", "3.11", "3.12", "3.13", "3.14"])(
    "adds supported Python target version %s",
    (version) => expect(ruffConfig(version)).toContain(`target-version = "py${version.replace(".", "")}"`),
  );

  it("omits unsupported and absent Python target versions", () => {
    expect(ruffConfig()).not.toContain("target-version");
    expect(ruffConfig("3.9")).not.toContain("target-version");
    expect(ruffConfig("3.15")).not.toContain("target-version");
  });

  it("reports null-code syntax errors with actionable examples", async () => {
    await expect(ruffFindings(
      checkContext("/r", "python", { "src/a.py": source }),
      [
        ...(report(null, "Expected an expression") as unknown[]),
        { code: null, message: "Unexpected indentation", filename: "src/b.py",
          location: { row: 2, column: 1 } },
      ],
    )).rejects.toThrow(
      "src/a.py:1 Expected an expression; src/b.py:2 Unexpected indentation. Hint: set .python-version or requires-python so Ruff targets the right Python version",
    );
  });

  it("rejects unknown E501 diagnostics", async () => {
    await expect(ruffFindings(
      checkContext("/r", "python", { "src/a.py": source }), report("E501", "too long"),
    )).rejects.toThrow("Unbaselined Ruff code E501");
  });

  it("rejects threshold drift in messages", async () => {
    await expect(ruffFindings(
      checkContext("/r", "python", { "src/a.py": source }),
      report("C901", "busy is too complex (21 > 20)"),
    )).rejects.toThrow("Unparsable metric message");
  });
});

describe("ruff captured fixture", () => {
  it("finds the captured complexity and parameter metrics", async () => {
    const input = JSON.parse(readFileSync(nativeFile, "utf8")) as unknown;
    const parsed = await ruffFindings(checkContext(root, "python"), input);
    expect(parsed.findings).toEqual({
      "src/demo_app/complex.py | C901 | /function:busy": 12,
      "src/demo_app/complex.py | PLR0913 | /function:busy": 5,
    });
    const detail = parsed.details["src/demo_app/complex.py | C901 | /function:busy"];
    expect(detail).toMatchObject({
        line: 1, column: 5, message: "`busy` is too complex (12 > 10)",
      });
    expect(detail).not.toHaveProperty("threshold");
  });
});
