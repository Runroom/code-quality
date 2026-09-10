import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { oxlintAdapter, oxlintConfig, oxlintFindings } from "../../../src/checks/ts/oxlint.ts";
import { checkContext } from "../../helpers/check-context.ts";

const root = resolve("fixtures/ts-project");
const nativeFile = resolve("tests/fixtures/native/ts-complexity/stdout.json");

function report(code: string, message: string, offset = 16, severity = "warning"): unknown {
  return {
    number_of_files: 1,
    diagnostics: [{ code, message, filename: "src/a.ts", severity, labels: [{ span: { offset } }] }],
  };
}

describe("oxlint config and command", () => {
  it("locks all complexity thresholds", () => {
    const config = JSON.parse(oxlintConfig(checkContext(root).config)) as {
      categories: Record<string, unknown>;
      rules: Record<string, unknown>;
    };
    expect(config.categories).toEqual({
      correctness: "off", suspicious: "off", pedantic: "off", perf: "off",
      style: "off", restriction: "off", nursery: "off",
    });
    expect(config.rules).toMatchObject({
      complexity: ["warn", 10],
      "max-lines-per-function": ["warn", { max: 60 }],
      "max-params": ["warn", 4],
      "max-depth": ["warn", 3],
      "max-nested-callbacks": ["warn", 3],
    });
    expect(oxlintAdapter.command(checkContext(root)).args).toContain("--format");
  });
});

describe("oxlint synthetic parser", () => {
  const source = "export function named(): number { return 1; }\n";
  const ctx = checkContext("/r", "ts", { "src/a.ts": source });

  it("rejects an unknown code", async () => {
    await expect(oxlintFindings(ctx, report("eslint(new-rule)", "value 1")))
      .rejects.toThrow("Unbaselined diagnostic");
  });

  it("rejects error severity", async () => {
    await expect(oxlintFindings(ctx, report("eslint(complexity)", "complexity of 11.", 0, "error")))
      .rejects.toThrow("Unbaselined diagnostic");
  });

  it("rejects an unparsable metric message", async () => {
    await expect(oxlintFindings(ctx, report("eslint(complexity)", "changed")))
      .rejects.toThrow("Unparsable metric message");
  });

  it("rejects an empty scan", async () => {
    await expect(oxlintFindings(ctx, { number_of_files: 0, diagnostics: [] }))
      .rejects.toThrow("oxlint scanned no files");
  });

  it("rejects out-of-scope files", async () => {
    const input = report("eslint(complexity)", "complexity of 11.") as {
      diagnostics: Array<{ filename: string }>;
    };
    input.diagnostics[0]!.filename = "scripts/x.ts";
    await expect(oxlintFindings(ctx, input)).rejects.toThrow("outside configured paths");
  });

  it("rejects ambiguous duplicate diagnostics", async () => {
    const diagnostic = (report("eslint(complexity)", "complexity of 11.") as {
      diagnostics: unknown[];
    }).diagnostics[0];
    await expect(oxlintFindings(ctx, { number_of_files: 1, diagnostics: [diagnostic, diagnostic] }))
      .rejects.toThrow("Ambiguous duplicate diagnostic");
  });

  it("preserves named arrow identity across unicode line shifts", async () => {
    const first = "export const named = (): number => 1;\n";
    const shifted = "// café 🎨\n" + first;
    const firstResult = await oxlintFindings(
      checkContext("/r", "ts", { "src/a.ts": first }),
      report("eslint(complexity)", "complexity of 11.", Buffer.byteLength("export const named = ")),
    );
    const shiftedResult = await oxlintFindings(
      checkContext("/r", "ts", { "src/a.ts": shifted }),
      report("eslint(complexity)", "complexity of 11.", Buffer.byteLength("// café 🎨\nexport const named = ")),
    );
    expect(Object.keys(shiftedResult)).toEqual(Object.keys(firstResult));
  });

  it("preserves named function identity across unicode line shifts", async () => {
    const shifted = "// café 🎨\n" + source;
    const original = await oxlintFindings(ctx, report("eslint(complexity)", "complexity of 11."));
    const moved = await oxlintFindings(
      checkContext("/r", "ts", { "src/a.ts": shifted }),
      report("eslint(complexity)", "complexity of 11.", Buffer.byteLength("// café 🎨\nexport function ")),
    );
    expect(Object.keys(moved)).toEqual(Object.keys(original));
  });
});

describe("oxlint captured fixture", () => {
  it("contains findings for exactly all five configured rules", async () => {
    const reportInput = JSON.parse(readFileSync(nativeFile, "utf8")) as {
      diagnostics: Array<{ code: string; message: string }>;
    };
    const parsed = await oxlintFindings(checkContext(root), reportInput);
    const rules = new Set(Object.keys(parsed).map((key) => key.split(" | ")[1]));
    expect(rules).toEqual(new Set([
      "eslint(complexity)", "eslint(max-params)", "eslint(max-lines-per-function)",
      "eslint(max-depth)", "eslint(max-nested-callbacks)",
    ]));
    for (const [key, value] of Object.entries(parsed)) {
      const code = key.split(" | ")[1];
      const diagnostics = reportInput.diagnostics.filter((entry) => entry.code === code);
      expect(diagnostics.some((entry) => entry.message.includes(String(value)))).toBe(true);
    }
  });
});
