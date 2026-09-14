import { describe, expect, it } from "vitest";

import {
  renderCheck,
  renderHeader,
  renderSummary,
  sanitizeLine,
  type OutcomeRow,
} from "../../src/cli/render.ts";
import { createStyle } from "../../src/cli/style.ts";
import type { GateOutcome } from "../../src/core/gate/types.ts";
import type { FindingDetail } from "../../src/core/types.ts";

const style = createStyle(false);

function renderOutcome(
  value: OutcomeRow,
  options: { all?: boolean; githubActions?: boolean } = {},
): string[] {
  return renderCheck(value, {
    all: options.all === true,
    githubActions: options.githubActions === true,
    idWidth: value.outcome.id.length,
    toolWidth: value.outcome.tool.length,
  }, style).slice(1);
}

function detail(overrides: Partial<FindingDetail> = {}): FindingDetail {
  return {
    file: "src/example.ts",
    rule: "eslint(complexity)",
    anchor: "function:run",
    value: 14,
    ...overrides,
  };
}

function outcome(overrides: Partial<GateOutcome> = {}): GateOutcome {
  return {
    id: "ts-complexity",
    ok: true,
    count: 0,
    regressions: [],
    stale: [],
    details: {},
    tool: "oxlint 1.82.0",
    ...overrides,
  };
}

function row(value: GateOutcome, check: OutcomeRow["check"] = "complexity"): OutcomeRow {
  return { outcome: value, check };
}

describe("finding rendering", () => {
  it.each([
    [{ line: 4, column: 2 }, "src/example.ts:4:2"],
    [{ line: 4 }, "src/example.ts:4"],
    [{}, "src/example.ts"],
  ])("renders location variants", (location, expected) => {
    const finding = detail(location);
    const value = outcome({
      regressions: [{ key: "key", kind: "new", value: 14 }],
      details: { key: finding },
    });
    expect(renderOutcome(row(value))).toEqual([
      `   └ ${expected}  eslint(complexity)  eslint(complexity) function:run  new`,
    ]);
  });

  it("uses native messages without threshold suffixes and renders finding tags", () => {
    const value = outcome({
      regressions: [{ key: "new", kind: "new", value: 14 }, {
        key: "worse", kind: "worsened", previous: 10, value: 12,
      }],
      details: {
        new: detail({ line: 8, message: "Function is complex", threshold: 10 }),
        worse: detail({ file: "src/worse.ts", value: 12 }),
        old: detail({ file: "src/old.ts", rule: "unused-file", anchor: "src/old.ts", value: 3 }),
      },
    });
    expect(renderOutcome(row(value), { all: true })).toEqual([
      "   └ src/example.ts:8  eslint(complexity)  Function is complex  new",
      "   └ src/old.ts  unused-file  unused-file src/old.ts  baselined",
      "   └ src/worse.ts  eslint(complexity)  eslint(complexity) function:run  worsened 10 → 12",
    ]);
  });

  it("parses stale keys and treats fingerprints as duplication", () => {
    const value = outcome({ stale: [
      { key: "src/old.ts | unused-export | symbol:old | nested", previous: 2 },
      { key: "ab12fingerprint", previous: 3 },
    ] });
    expect(renderOutcome(row(value))).toEqual([
      "   └ ab12fingerprint  duplication  stale (was 3)",
      "   └ src/old.ts  unused-export  symbol:old | nested  stale (was 2)",
    ]);
  });
});

describe("finding rendering edge cases", () => {
  it("renders improvements once under --all", () => {
    const key = "src/a.ts | complexity | /fn";
    const value = outcome({
      stale: [{ key, previous: 4, value: 2 }],
      details: { [key]: detail({ file: "src/a.ts", anchor: "/fn", value: 2 }) },
    });
    expect(renderOutcome(row(value), { all: true })).toEqual([
      "   └ src/a.ts  complexity  /fn  improved 4 → 2",
    ]);
  });

  it("renders a parsed regression key when detail is unexpectedly absent", () => {
    const value = outcome({
      regressions: [{
        key: "src/missing.ts | missing-rule | /fn#value", kind: "new", value: 1,
      }],
    });
    expect(renderOutcome(row(value))).toEqual([
      "   └ src/missing.ts  missing-rule  /fn#value  new",
    ]);
  });

  it("sanitizes control characters in finding lines but preserves annotations", () => {
    const key = "unsafe";
    const value = outcome({
      regressions: [{ key, kind: "new", value: 1 }],
      details: { [key]: detail({
        file: "src/a\n::stop-commands::x.ts",
        message: "a\n::error file=b::c",
      }) },
    });
    const lines = renderOutcome(row(value), { githubActions: true });
    expect(lines[0]).toBe(
      "   └ src/a ::stop-commands::x.ts  eslint(complexity)  a ::error file=b::c  new",
    );
    expect(lines[0]).not.toContain("\n");
    expect(lines[0]!.trimStart()).not.toMatch(/^::/u);
    expect(lines[1]).toBe(
      "::error file=src/a%0A%3A%3Astop-commands%3A%3Ax.ts,title="
        + "ts-complexity eslint(complexity)::a%0A::error file=b::c",
    );
  });
});

describe("unsafe finding rendering", () => {
  it("neutralizes V1 commands and strips C1 and bidi controls", () => {
    const key = "unsafe";
    const value = outcome({
      regressions: [{ key, kind: "new", value: 1 }],
      details: { [key]: detail({
        message: "before ##[stop-commands]x \u202Ehidden\u009B after",
      }) },
    });
    const lines = renderOutcome(row(value), { githubActions: true });
    expect(lines[0]).toContain("before %23%23[stop-commands]x hidden after");
    expect(lines[1]).toContain("before %23%23[stop-commands]x hidden after");
    expect(lines.join("")).not.toContain("\u202E");
    expect(lines.join("")).not.toContain("\u009B");
  });

  it("keeps a trailing message space separate from the colored tag", () => {
    const key = "trailing";
    const value = outcome({
      regressions: [{ key, kind: "new", value: 1 }],
      details: { [key]: detail({ message: "trailing " }) },
    });
    const lines = renderCheck(row(value), {
      all: false, githubActions: false, idWidth: 13, toolWidth: 13,
    }, createStyle(true));
    expect(lines[1]).toContain("trailing   \u001B[1m\u001B[31mnew\u001B[39m\u001B[22m");
  });
});

describe("finding ordering", () => {
  it("sorts regressions, stale entries, and baselined findings by source position", () => {
    const value = outcome({
      regressions: [{ key: "z-key", kind: "new", value: 2 }],
      stale: [{ key: "src/a.ts | z-rule | stale", previous: 1 }],
      details: {
        "z-key": detail({ file: "src/b.ts", line: 1, column: 2, rule: "b-rule" }),
        "a-key": detail({ file: "src/a.ts", line: 3, rule: "z-rule", anchor: "later" }),
        "b-key": detail({ file: "src/a.ts", line: 3, column: 4, rule: "a-rule", anchor: "first" }),
      },
    });
    expect(renderOutcome(row(value), { all: true })).toEqual([
      "   └ src/a.ts:3:4  a-rule  a-rule first  baselined",
      "   └ src/a.ts:3  z-rule  z-rule later  baselined",
      "   └ src/a.ts  z-rule  stale  stale (was 1)",
      "   └ src/b.ts:1:2  b-rule  b-rule function:run  new",
    ]);
  });

  it("sorts line-less findings by rule", () => {
    const value = outcome({ details: {
      z: detail({ file: "src/a.ts", rule: "z-rule", anchor: "z" }),
      a: detail({ file: "src/a.ts", rule: "a-rule", anchor: "a" }),
    } });
    expect(renderOutcome(row(value), { all: true })).toEqual([
      "   └ src/a.ts  a-rule  a-rule a  baselined",
      "   └ src/a.ts  z-rule  z-rule z  baselined",
    ]);
  });
});

describe("duplication rendering", () => {
  const duplicate = {
    file: "src/a.ts", line: 3, endLine: 14,
    secondFile: "src/b.ts", secondLine: 5, secondEndLine: 16,
    lines: 12, tokens: 61, isNew: true,
  };

  it("renders new, worsened, and baselined clones", () => {
    const value = outcome({
      regressions: [
        { key: "fresh", kind: "new", value: 1 },
        { key: "fingerprint", kind: "worsened", previous: 1, value: 2 },
      ],
      duplicates: [duplicate, { ...duplicate, file: "src/c.ts", isNew: false }],
    });
    expect(renderOutcome(row(value, "duplication"), { all: true })).toEqual([
      "   └ src/a.ts:3-14 ↔ src/b.ts:5-16  duplication  12 lines, 61 tokens duplicated  new",
      "   └ fingerprint  duplication  clone occurrences 1 → 2  worsened 1 → 2",
      "   └ src/c.ts:3-14 ↔ src/b.ts:5-16  duplication  12 lines, 61 tokens duplicated  baselined",
    ]);
  });

  it("labels every pair uncertain when jscpd marks none new", () => {
    const value = outcome({
      regressions: [{ key: "fresh", kind: "new", value: 1 }],
      duplicates: [{ ...duplicate, isNew: false }],
    });
    expect(renderOutcome(row(value, "duplication"))).toEqual([
      "   └ src/a.ts:3-14 ↔ src/b.ts:5-16  duplication  12 lines, 61 tokens duplicated  new?",
    ]);
  });
});

describe("GitHub annotations", () => {
  it("escapes command data and optional location properties", () => {
    const value = outcome({
      id: "ts:complexity",
      regressions: [{ key: "key", kind: "new", value: 14 }],
      details: { key: detail({
        file: "src/a,b.ts", line: 4, column: 2, rule: "rule:test",
        message: "bad%\r\nthing",
      }) },
    });
    expect(renderOutcome(row(value), { githubActions: true }).at(-1)).toBe(
      "::error file=src/a%2Cb.ts,line=4,col=2,title=ts%3Acomplexity rule%3Atest::bad%25%0D%0Athing",
    );
  });

  it("uses the first clone location for duplication annotations", () => {
    const value = outcome({
      regressions: [{ key: "clone", kind: "new", value: 1 }],
      duplicates: [{
        file: "src/a.ts", line: 3, endLine: 14,
        secondFile: "src/b.ts", secondLine: 5, secondEndLine: 16,
        lines: 12, tokens: 61, isNew: true,
      }],
    });
    expect(renderOutcome(row(value, "duplication"), { githubActions: true }).at(-1)).toBe(
      "::error file=src/a.ts,line=3,title=ts-complexity duplication::"
        + "12 lines, 61 tokens duplicated",
    );
  });
});

describe("summary rendering", () => {
  it("pads columns and renders PASS with skipped rows", () => {
    const lines = renderSummary([
      row(outcome({ id: "ts-a", count: 2, tool: "oxlint 1" })),
      row(outcome({ id: "ts-long", count: 4, tool: "fallow 3.2" }), "cognitive"),
    ], [{ id: "ts-skip", reason: "no config" }], style);
    expect(lines).toEqual([
      "",
      " Checks   2 passed",
      " Skipped  1",
      " Result   PASS",
    ]);
  });

  it("sanitizes summary and error rows", () => {
    const failed = outcome({ id: "::bad\nid", ok: false, message: "failure\n::error::x" });
    const lines = renderCheck(row(failed), {
      all: false, githubActions: false, idWidth: 8, toolWidth: 0,
    }, style);
    expect(lines[0]).toBe(" ✖ %3A%3Abad id  ERROR  failure ::error::x");
    expect(sanitizeLine("\u0085::stop-commands::x")).toBe("%3A%3Astop-commands::x");
    expect(sanitizeLine(" \u00A0\t::error::x")).toBe(" \u00A0\t%3A%3Aerror::x");
    expect(lines[0]!.trimStart()).not.toMatch(/^::/u);
  });

  it("renders errors and a failure total", () => {
    const failed = outcome({ id: "ts-broken", ok: false, message: "ts-broken: parser failed" });
    const regression = outcome({
      id: "ts-dupes", ok: false, count: 3, tool: "jscpd 5",
      regressions: [{ key: "clone", kind: "new", value: 1 }],
      message: "ts-dupes: 1 regressions",
    });
    expect(renderSummary([row(failed), row(regression, "duplication")], [], style).at(-1)).toBe(
      " Result   FAIL",
    );
    expect(renderCheck(row(failed), {
      all: false, githubActions: false, idWidth: 9, toolWidth: 0,
    }, style)[0]).toBe(" ✖ ts-broken  ERROR  parser failed");
  });

  it("renders blocking, stale, skipped, and result fields in order", () => {
    const failed = outcome({
      ok: false,
      count: 2,
      regressions: [{ key: "new", kind: "new", value: 1 }],
      stale: [{ key: "old", previous: 1 }],
    });
    expect(renderSummary([
      row(outcome()),
      row(failed),
    ], [{ id: "ts-skip", reason: "no config" }], style)).toEqual([
      "",
      " Checks   1 passed · 1 failed",
      " Blocking 1 new finding",
      " Stale    1 baseline entry to tighten",
      " Skipped  1",
      " Result   FAIL",
    ]);
  });
});

describe("status rendering", () => {
  it("renders singular clone counts", () => {
    const line = renderCheck(row(outcome({ count: 1 }), "duplication"), {
      all: false, githubActions: false, idWidth: 13, toolWidth: 13,
    }, style)[0];
    expect(line).toBe(" ✔ ts-complexity  oxlint 1.82.0  1 clone");
  });

  it("renders regression and stale status counts", () => {
    const value = outcome({
      ok: false,
      count: 4,
      regressions: [
        { key: "one", kind: "new", value: 1 },
        { key: "two", kind: "new", value: 1 },
      ],
      stale: [{ key: "old", previous: 1 }],
    });
    expect(renderCheck(row(value), {
      all: false, githubActions: false, idWidth: 13, toolWidth: 13,
    }, style)[0]).toBe(" ✖ ts-complexity  oxlint 1.82.0  4 findings · 2 new · 1 stale");
  });

  it("pads columns before applying ANSI styling", () => {
    const options = { all: false, githubActions: false, idWidth: 20, toolWidth: 20 };
    const plain = renderCheck(row(outcome({ count: 1 })), options, createStyle(false))[0];
    const colored = renderCheck(row(outcome({ count: 1 })), options, createStyle(true))[0];
    // oxlint-disable-next-line no-control-regex -- intentional: strips ANSI SGR codes to compare visible text
    expect(colored?.replaceAll(/\u001B\[[0-9;]*m/gu, "")).toBe(plain);
  });

  it("renders headers with pluralized check counts", () => {
    expect(renderHeader({
      version: "1.2.0", languages: ["ts", "php"], checks: 3,
    }, style)).toBe(" code-quality 1.2.0 · ts, php · 3 checks");
    expect(renderHeader({
      version: "1.2.0", languages: ["ts"], checks: 1,
    }, style)).toBe(" code-quality 1.2.0 · ts · 1 check");
  });
});
