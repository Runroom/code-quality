import { describe, expect, it } from "vitest";

import { compareFindings } from "../../src/core/compare.ts";

describe("compareFindings", () => {
  it("reports a new key", () => {
    expect(compareFindings({}, { key: 5 })).toEqual({
      regressions: [{ key: "key", kind: "new", value: 5 }],
      stale: [],
    });
  });

  it("reports an increased value", () => {
    expect(compareFindings({ existing: 5 }, { existing: 6 })).toEqual({
      regressions: [{ key: "existing", kind: "worsened", previous: 5, value: 6 }],
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
      stale: [
        { key: "first", previous: 6, value: 5 },
        { key: "removed", previous: 5 },
      ],
    });
  });

  it("does not fund an increase with a decrease", () => {
    expect(compareFindings({ removed: 5 }, { added: 5 })).toEqual({
      regressions: [{ key: "added", kind: "new", value: 5 }],
      stale: [{ key: "removed", previous: 5 }],
    });
  });

  it("sorts regression output", () => {
    expect(compareFindings({}, { b: 1, a: 1, B: 1 }).regressions).toEqual([
      { key: "B", kind: "new", value: 1 },
      { key: "a", kind: "new", value: 1 },
      { key: "b", kind: "new", value: 1 },
    ]);
  });
});
