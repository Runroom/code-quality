import { describe, expect, it } from "vitest";

import { decide, type Decision } from "../../../src/core/gate/state.ts";

const current = {
  version: 1 as const,
  tool: "node@1.0.0",
  configHash: "b".repeat(64),
  findings: { key: 2 },
};
const baseline = { ...current, findings: { key: 1 } };
const equal = { regressions: [], stale: [] };
const regression = { regressions: ["key: 1 → 2"], stale: [] };
const stale = { regressions: [], stale: ["key"] };

function expectFailure(decision: Decision, message: string): void {
  expect(decision.action).toBe("fail");
  if (decision.action === "fail") expect(decision.message).toContain(message);
}

describe("decide initialization", () => {
  it("fails when initialize would replace an existing baseline", () => {
    expectFailure(
      decide({ mode: "initialize", exists: true, baseline, current, comparison: undefined, id: "ts-fake" }),
      "already exists; initialization cannot replace",
    );
  });

  it("writes a missing baseline during initialize", () => {
    expect(decide({ mode: "initialize", exists: false, baseline: undefined, current, comparison: undefined, id: "ts-fake" })).toEqual({
      action: "write",
      reason: "initialize",
    });
  });

  it("fails check when the baseline is missing", () => {
    expectFailure(
      decide({ mode: "check", exists: false, baseline: undefined, current, comparison: undefined, id: "ts-fake" }),
      "quality/ts-fake-baseline.json is missing",
    );
  });

  it("fails update when the baseline is missing", () => {
    expectFailure(
      decide({ mode: "update", exists: false, baseline: undefined, current, comparison: undefined, id: "ts-fake" }),
      "Run code-quality check ts-fake --initialize",
    );
  });
});

describe("decide comparison", () => {
  it("fails when the tool changes", () => {
    const changed = { ...baseline, tool: "node@0.9.0" };
    expectFailure(
      decide({ mode: "check", exists: true, baseline: changed, current, comparison: equal, id: "ts-fake" }),
      "tool/config changed (baseline node@0.9.0/bbbbbbbb, current node@1.0.0/bbbbbbbb)",
    );
  });

  it("fails when the config hash changes", () => {
    const changed = { ...baseline, configHash: "c".repeat(64) };
    expectFailure(
      decide({ mode: "check", exists: true, baseline: changed, current, comparison: equal, id: "ts-fake" }),
      "tool/config changed (baseline node@1.0.0/cccccccc, current node@1.0.0/bbbbbbbb)",
    );
  });

  it("fails on regressions", () => {
    expectFailure(
      decide({ mode: "check", exists: true, baseline, current, comparison: regression, id: "ts-fake" }),
      "ts-fake regressions:\nkey: 1 → 2",
    );
  });

  it("writes an update without regressions", () => {
    expect(decide({ mode: "update", exists: true, baseline, current, comparison: equal, id: "ts-fake" })).toEqual({
      action: "write",
      reason: "update",
    });
  });

  it("fails check when entries are stale", () => {
    expectFailure(
      decide({ mode: "check", exists: true, baseline, current, comparison: stale, id: "ts-fake" }),
      "cleanup detected (1 stale entries)",
    );
  });

  it("passes an equal check", () => {
    expect(decide({ mode: "check", exists: true, baseline: current, current, comparison: equal, id: "ts-fake" })).toEqual({ action: "pass" });
  });
});
