import { describe, expect, it } from "vitest";

import { FindingsBuilder } from "../../../src/checks/shared/findings.ts";

describe("FindingsBuilder", () => {
  it("sorts findings", () => {
    const findings = new FindingsBuilder();
    findings.addRaw("z", 2);
    findings.add("a.ts", "rule", "/fn", 1);
    expect(findings.build()).toEqual({ "a.ts | rule | /fn": 1, z: 2 });
  });

  it("rejects a duplicate key", () => {
    const findings = new FindingsBuilder();
    findings.addRaw("same", 1);
    expect(() => findings.addRaw("same", 2)).toThrow("Ambiguous duplicate diagnostic: same");
  });

  it.each([0, -1, 1.5])("rejects non-positive integer value %s", (value) => {
    expect(() => new FindingsBuilder().addRaw("key", value)).toThrow("positive integer");
  });
});
