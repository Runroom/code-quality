import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { vultureAdapter, vultureFindings } from "../../../src/checks/python/vulture.ts";
import { spawnTool } from "../../../src/core/runner/spawn.ts";
import { checkContext } from "../../helpers/check-context.ts";

const root = resolve("fixtures/python-project");
const nativeFile = resolve("tests/fixtures/native/python-unused-vulture/stdout.txt");
const source = "import os\ndef unused_fn():\n    return 1\n";

describe("vulture synthetic parser", () => {
  const ctx = checkContext("/r", "python", { "src/a.py": source });

  it("rejects stray Traceback output", async () => {
    await expect(vultureFindings(ctx, "Traceback (most recent call last):\n"))
      .rejects.toThrow("Unknown vulture line");
  });

  it("accepts every documented category", async () => {
    const categories = ["attribute", "class", "function", "import", "method", "property", "variable"];
    const unused = categories.map((category) =>
      `src/a.py:1: unused ${category} '${category}' (60% confidence)`);
    const special = [
      "src/a.py:2: unreachable code after 'return' (100% confidence)",
      "src/a.py:2: unsatisfiable 'False' condition (100% confidence)",
    ];
    const { findings: parsed } = await vultureFindings(ctx, [...unused, ...special].join("\n"));
    const rules = Object.keys(parsed).map((key) => key.split(" | ")[1]);
    expect(new Set(rules)).toEqual(new Set([...categories.map((value) => `vulture-${value}`),
      "vulture-unreachable_code", "vulture-unsatisfiable_condition"]));
  });

  it("anchors module-level unused imports and variables at the file root without a notice", async () => {
    const moduleContext = checkContext("/r", "python", {
      "src/a.py": "import os\nunused = 1\n",
    });
    const parsed = await vultureFindings(moduleContext, [
      "src/a.py:1: unused import 'os' (90% confidence)",
      "src/a.py:2: unused variable 'unused' (60% confidence)",
    ].join("\n"));
    expect(parsed.findings).toEqual({
      "src/a.py | vulture-import | /#os": 1,
      "src/a.py | vulture-variable | /#unused": 1,
    });
    expect(moduleContext.config.notices).toEqual([]);
  });

  it("keeps the fallback notice for a diagnostic in an unparseable module region", async () => {
    const broken = checkContext("/r", "python", { "src/a.py": "import (\n" });
    const parsed = await vultureFindings(
      broken,
      "src/a.py:1: unused import 'broken' (90% confidence)",
    );
    expect(parsed.findings).toEqual({ "src/a.py | vulture-import | /#broken": 1 });
    expect(broken.config.notices).toEqual([
      "anchors for src/a.py fall back to symbol/line keys (grammar could not parse the file)",
    ]);
  });

  it("runner rejects vulture exit code 1", () => {
    const invocation = vultureAdapter.command(ctx);
    expect(() => spawnTool({ ...invocation, bin: process.execPath,
      args: ["-e", "process.exit(1)"] }, process.cwd())).toThrow("exited with 1");
  });
});

describe("vulture captured fixture", () => {
  it("finds all five captured unused symbols", async () => {
    const parsed = await vultureFindings(
      checkContext(root, "python"), readFileSync(nativeFile, "utf8"),
    );
    expect(parsed.findings).toEqual({
      "src/demo_app/client.py | vulture-function | /function:get_client#get_client": 1,
      "src/demo_app/complex.py | vulture-function | /function:busy#busy": 1,
      "src/demo_app/dead.py | vulture-import | /#os": 1,
      "src/demo_app/dead.py | vulture-function | /function:unused_fn#unused_fn": 1,
      "src/demo_app/domain/model.py | vulture-function | /function:load_model#load_model": 1,
    });
    const key = "src/demo_app/client.py | vulture-function | /function:get_client#get_client";
    expect(parsed.details[key]).toMatchObject({
      line: 4, message: "unused function 'get_client' (60% confidence)",
    });
  });
});
