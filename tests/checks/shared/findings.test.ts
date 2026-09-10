import { describe, expect, it } from "vitest";

import { FindingsBuilder } from "../../../src/checks/shared/findings.ts";
import { buildFindingKey, parseFindingKey } from "../../../src/core/types.ts";

describe("FindingsBuilder", () => {
  it("sorts findings", () => {
    const findings = new FindingsBuilder();
    findings.addRaw("z", 2);
    findings.add({ file: "a.ts", rule: "rule", anchor: "/fn", value: 1 });
    expect(findings.build()).toEqual({
      findings: { "a.ts | rule | /fn": 1, z: 2 },
      details: {
        "a.ts | rule | /fn": { file: "a.ts", rule: "rule", anchor: "/fn", value: 1 },
        z: { file: "z", rule: "duplication", anchor: "z", value: 2 },
      },
    });
  });

  it("records detail fields for add and addRaw", () => {
    const findings = new FindingsBuilder();
    findings.add({
      file: "a.ts", rule: "rule", anchor: "/fn", value: 2,
      line: 3, message: "native", threshold: 1,
    });
    findings.addRaw("raw", 1, { file: "b.ts", rule: "custom", anchor: "~key", column: 4 });
    expect(findings.build().details).toEqual({
      "a.ts | rule | /fn": {
        file: "a.ts", rule: "rule", anchor: "/fn", value: 2,
        line: 3, message: "native", threshold: 1,
      },
      raw: { file: "b.ts", rule: "custom", anchor: "~key", value: 1, column: 4 },
    });
  });

  it("attaches duplicates only when set", () => {
    const findings = new FindingsBuilder();
    expect(findings.build()).not.toHaveProperty("duplicates");
    const duplicate = {
      file: "a.ts", line: 1, endLine: 2, secondFile: "b.ts", secondLine: 3,
      secondEndLine: 4, lines: 2, tokens: 50, isNew: true,
    };
    findings.setDuplicates([duplicate]);
    expect(findings.build().duplicates).toEqual([duplicate]);
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

describe("finding keys", () => {
  it.each(["/fn#name", "symbol:name", "part | nested | anchor"])(
    "round-trips anchor %s",
    (anchor) => {
      const input = { file: "src/a.ts", rule: "rule:name", anchor };
      expect(parseFindingKey(buildFindingKey(input))).toEqual(input);
    },
  );

  it("does not parse jscpd fingerprints", () => {
    expect(parseFindingKey("52345a7776aa96cf")).toBeUndefined();
  });
});
