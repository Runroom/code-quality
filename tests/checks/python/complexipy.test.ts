import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { complexipyAdapter, complexipyFindings } from "../../../src/checks/python/complexipy.ts";
import { POLICY } from "../../../src/core/config/policy.ts";
import { checkContext } from "../../helpers/check-context.ts";

const root = resolve("fixtures/python-project");
const nativeFile = resolve("tests/fixtures/native/python-cognitive/complexipy.sarif");
const source = "def busy(a, b, c, d, e):\n    return 1\n";

function sarif(ruleId = "CC001", count = 1): unknown {
  const result = {
    ruleId, message: { text: "Function 'busy' has a cognitive complexity of 16, too high." },
    locations: [{ physicalLocation: {
      artifactLocation: { uri: "src/a.py" }, region: { startLine: 1 },
    } }],
  };
  return { version: "2.1.0", runs: [{ tool: { driver: { name: "complexipy",
    version: "8.0.1" } }, results: Array.from({ length: count }, () => result) }] };
}

describe("complexipy synthetic parser", () => {
  const ctx = checkContext("/r", "python", { "src/a.py": source });

  it("rejects refactor rule C007", async () => {
    await expect(complexipyFindings(ctx, sarif("C007")))
      .rejects.toThrow("Unbaselined complexipy rule C007");
  });

  it("passes the policy cognitive threshold to complexipy", () => {
    const args = complexipyAdapter.command(ctx).args;
    expect(args[args.indexOf("--max-complexity-allowed") + 1]).toBe(String(POLICY.cognitive));
  });

  it("rejects two results for the same function as ambiguous", async () => {
    await expect(complexipyFindings(ctx, sarif(undefined, 2))).rejects.toThrow("Ambiguous");
  });
});

describe("complexipy captured fixture", () => {
  it("finds busy cognitive complexity", async () => {
    const input = JSON.parse(readFileSync(nativeFile, "utf8")) as unknown;
    const parsed = await complexipyFindings(checkContext(root, "python"), input);
    expect(parsed).toEqual({
      "src/demo_app/complex.py | cognitive-complexity | /function:busy": 20,
    });
  });
});
