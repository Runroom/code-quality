import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  dependencyCruiserAdapter,
  dependencyCruiserFindings,
} from "../../../src/checks/ts/dependency-cruiser.ts";
import { checkContext } from "../../helpers/check-context.ts";

const root = resolve("fixtures/ts-project");
const nativeFile = resolve("tests/fixtures/native/ts-architecture/stdout.json");

function report(severity: "error" | "warn" | "info" | "ignore" = "error", totalCruised = 1): unknown {
  return {
    summary: {
      totalCruised,
      violations: [{
        from: "src/ui/view.ts",
        to: "src/db/repo.ts",
        rule: { name: "no-ui-to-db", severity },
      }],
    },
  };
}

describe("dependency-cruiser synthetic parser", () => {
  it("rejects a zero-module scan", () => {
    expect(() => dependencyCruiserFindings(checkContext("/r"), report("error", 0))).toThrow();
  });

  it("ignores ignore-severity violations", () => {
    expect(dependencyCruiserFindings(checkContext("/r"), report("ignore")).findings).toEqual({});
  });

  it("rejects malformed rules", () => {
    expect(() => dependencyCruiserFindings(checkContext("/r"), {
      summary: { totalCruised: 1, violations: [{ from: "src/a.ts", to: "src/b.ts" }] },
    })).toThrow();
  });

  it("skips when no rules file is selected", () => {
    expect(dependencyCruiserAdapter.applicability(checkContext("/r").config)).toEqual({
      kind: "skip",
      reason: "no .dependency-cruiser.cjs",
    });
  });
});

describe("dependency-cruiser captured fixture", () => {
  it("finds the ui to db violation", () => {
    const { findings, details } = dependencyCruiserFindings(
      checkContext(root),
      JSON.parse(readFileSync(nativeFile, "utf8")),
    );
    expect(Object.keys(findings).some((key) => key.includes("ignored.test.ts"))).toBe(false);
    expect(findings).toEqual({ "src/ui/view.ts | no-ui-to-db | src/db/repo.ts": 1 });
    expect(details["src/ui/view.ts | no-ui-to-db | src/db/repo.ts"]).toMatchObject({
      message: "src/ui/view.ts must not import src/db/repo.ts (rule no-ui-to-db)",
    });
  });
});
