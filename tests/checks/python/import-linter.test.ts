import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { importLinterFindings } from "../../../src/checks/python/import-linter.ts";
import { checkContext } from "../../helpers/check-context.ts";

const root = resolve("fixtures/python-project");
const nativeFile = resolve("tests/fixtures/native/python-architecture/stdout.txt");

function output(result = "BROKEN", totals = "Contracts: 0 kept, 1 broken."): string {
  const broken = result === "BROKEN" ? ["Broken contracts", "Layers",
    "demo_app.domain.model is not allowed to import demo_app.infra.db:",
    "- demo_app.domain.model -> demo_app.infra.db (l.1)"] : [];
  return ["Import Linter", "=", "Contracts", "-", `Layers ${result}`, totals,
    ...broken, ""].join("\n");
}

describe("import-linter synthetic parser", () => {
  const ctx = checkContext(root, "python");

  it("rejects totals mismatch", () => {
    expect(() => importLinterFindings(ctx, output("BROKEN", "Contracts: 1 kept, 0 broken.")))
      .toThrow("totals mismatch");
  });

  it("rejects a stray line", () => {
    expect(() => importLinterFindings(ctx, `${output()}Traceback\n`))
      .toThrow("Unknown import-linter line: Traceback");
  });

  it("returns no findings when every contract is kept", () => {
    expect(importLinterFindings(ctx, output("KEPT", "Contracts: 1 kept, 0 broken.")))
      .toEqual({});
  });

  it("parses undeclared-module lines", () => {
    const text = `${output()}Broken contracts\nLayers\nThe following modules are not listed as layers:\n- demo_app.client\n`;
    expect(importLinterFindings(ctx, text)).toHaveProperty(
      "src/demo_app/client.py | import-linter:Layers:undeclared | demo_app.client", 1,
    );
  });

  it("uses a module identifier key when the lower module cannot be resolved", () => {
    const text = output().replaceAll("demo_app.domain.model", "missing.domain.model");
    expect(importLinterFindings(ctx, text)).toEqual({
      "missing.domain.model | import-linter:Layers:unresolved | demo_app.infra.db": 1,
    });
  });

  it("rejects broken_contract_guidance free text", () => {
    expect(() => importLinterFindings(ctx, `${output()}Explain how to fix this.\n`))
      .toThrow("Unknown import-linter line");
  });
});

describe("import-linter captured fixture", () => {
  it("finds the Layers violation", () => {
    const parsed = importLinterFindings(checkContext(root, "python"),
      readFileSync(nativeFile, "utf8"));
    expect(parsed).toEqual({
      "src/demo_app/domain/model.py | import-linter:Layers | demo_app.infra.db": 1,
    });
  });
});
