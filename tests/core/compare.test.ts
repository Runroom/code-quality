import { describe, expect, it } from "vitest";

import { compareFindings } from "../../src/core/compare.ts";

describe("compareFindings", () => {
  it("reports a new key", () => {
    expect(compareFindings({}, { key: 5 })).toEqual({
      regressions: ["key: new (5)"],
      stale: [],
    });
  });

  it("reports an increased value", () => {
    expect(compareFindings({ existing: 5 }, { existing: 6 })).toEqual({
      regressions: ["existing: 5 → 6"],
      stale: [],
    });
  });

  it("ignores equal values", () => {
    expect(compareFindings({ existing: 5 }, { existing: 5 })).toEqual({
      regressions: [],
      stale: [],
    });
  });

  it("reports decreased and removed keys as stale", () => {
    expect(compareFindings({ first: 6, removed: 5 }, { first: 5 })).toEqual({
      regressions: [],
      stale: ["first", "removed"],
    });
  });

  it("does not fund an increase with a decrease", () => {
    expect(compareFindings({ removed: 5 }, { added: 5 })).toEqual({
      regressions: ["added: new (5)"],
      stale: ["removed"],
    });
  });

  it("sorts regression output", () => {
    expect(compareFindings({}, { b: 1, a: 1 }).regressions).toEqual([
      "a: new (1)",
      "b: new (1)",
    ]);
  });
});
