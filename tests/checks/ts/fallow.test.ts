import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { fallowAdapter, fallowFindings } from "../../../src/checks/ts/fallow.ts";
import { POLICY } from "../../../src/core/config/policy.ts";
import { checkContext } from "../../helpers/check-context.ts";

const root = resolve("fixtures/ts-project");
const nativeFile = resolve("tests/fixtures/native/ts-cognitive/stdout.json");
const source = "export function nested(value: number): number { return value; }\n";

function fallowReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "health",
    version: "3.23.0",
    schema_version: 11,
    summary: {
      files_analyzed: 1,
      functions_analyzed: 1,
      max_cyclomatic_threshold: 0,
      max_cognitive_threshold: 0,
    },
    findings: [{ path: "src/a.ts", name: "nested", cognitive: 16, line: 1, col: 16 }],
    ...overrides,
  };
}

describe("fallow synthetic parser", () => {
  const ctx = checkContext("/r", "ts", { "src/a.ts": source });

  it("excludes cognitive complexity at the threshold", async () => {
    const input = fallowReport({
      findings: [{ path: "src/a.ts", name: "nested", cognitive: 15, line: 1, col: 16 }],
    });
    await expect(fallowFindings(ctx, input)).resolves.toEqual({});
  });

  it("derives advisory settings from policy", () => {
    const generated = JSON.parse(fallowAdapter.configFiles(ctx)[0]!.content) as {
      health: unknown; duplicates: unknown; ignorePatterns: string[];
    };
    expect(generated.health).toEqual({
      maxCyclomatic: POLICY.complexity, maxCognitive: POLICY.cognitive,
    });
    expect(generated.duplicates).toEqual(POLICY.advisoryDuplication);
    expect(generated.ignorePatterns).toEqual(expect.arrayContaining([
      "**/*.test.*", "**/__tests__/**", "**/tests/**",
    ]));
  });

  it("skips production findings outside configured paths", async () => {
    const input = fallowReport({
      findings: [{ path: "scripts/a.ts", name: "nested", cognitive: 16, line: 1, col: 16 }],
    });
    await expect(fallowFindings(ctx, input)).resolves.toEqual({});
  });

  it("rejects a tool version mismatch", async () => {
    await expect(fallowFindings(ctx, fallowReport({ version: "3.22.0" }))).rejects.toThrow();
  });

  it("rejects an incomplete report", async () => {
    await expect(fallowFindings(ctx, fallowReport({ findings: [] })))
      .rejects.toThrow("Incomplete Fallow function report");
  });

  it("rejects a line beyond EOF", async () => {
    const input = fallowReport({
      findings: [{ path: "src/a.ts", name: "nested", cognitive: 16, line: 3, col: 0 }],
    });
    await expect(fallowFindings(ctx, input)).rejects.toThrow("beyond end of file");
  });

  it("preserves identity after a unicode line is prepended", async () => {
    const original = await fallowFindings(ctx, fallowReport());
    const shiftedSource = "// café 🎨\n" + source;
    const shifted = await fallowFindings(
      checkContext("/r", "ts", { "src/a.ts": shiftedSource }),
      fallowReport({
        findings: [{ path: "src/a.ts", name: "nested", cognitive: 16, line: 2, col: 16 }],
      }),
    );
    expect(Object.keys(shifted)).toEqual(Object.keys(original));
  });
});

it("reports the message from a fallow error document", async () => {
  const ctx = checkContext("/r", "ts", { "src/a.ts": source });
  await expect(fallowFindings(ctx, {
    error: true,
    message: "analysis failed: Configuration error: invalid plugin regex tanstack-router",
  })).rejects.toThrow(
    "analysis failed: Configuration error: invalid plugin regex tanstack-router",
  );
});

it("accepts fallow's structured-error exit code for parser handling", () => {
  const ctx = checkContext("/r", "ts", { "src/a.ts": source });
  expect(fallowAdapter.command(ctx).exitCodes).toEqual([0, 2]);
});

describe("fallow captured fixture", () => {
  it("uses zero-based col 7 for the busy function declaration", async () => {
    const input = fallowReport({
      findings: [{ path: "src/a.ts", name: "busy", cognitive: 21, line: 1, col: 7 }],
    });
    const busySource = "export function busy(): number { return 1; }\n";
    await expect(fallowFindings(
      checkContext("/r", "ts", { "src/a.ts": busySource }),
      input,
    )).resolves.toEqual({ "src/a.ts | cognitive-complexity | /function:busy": 21 });
  });

  it("contains the captured busy and nested findings above 15", async () => {
    const findings = await fallowFindings(
      checkContext(root),
      JSON.parse(readFileSync(nativeFile, "utf8")),
    );
    expect(Object.keys(findings).some((key) => key.includes("ignored.test.ts"))).toBe(false);
    expect(Object.values(findings)).toEqual([21, 21]);
    expect(Object.keys(findings)).toEqual([
      "src/cognitive.ts | cognitive-complexity | /function:nested",
      "src/complexity.ts | cognitive-complexity | /function:busy",
    ]);
  });
});
