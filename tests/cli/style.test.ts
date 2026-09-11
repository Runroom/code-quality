import { describe, expect, it } from "vitest";

import { renderCheck, type OutcomeRow } from "../../src/cli/render.ts";
import { colorFlagFromArgv, createStyle, resolveColor } from "../../src/cli/style.ts";

function row(message: string): OutcomeRow {
  return {
    check: "complexity",
    outcome: {
      id: "ts-complexity",
      ok: false,
      count: 1,
      tool: "oxlint 1.82.0",
      regressions: [{ key: "finding", kind: "new", value: 1 }],
      stale: [],
      details: {
        finding: {
          file: "src/a.ts",
          line: 2,
          rule: "complexity",
          anchor: "/run",
          value: 1,
          message,
        },
      },
    },
  };
}

describe("resolveColor", () => {
  it.each([
    [{ flag: false, env: { FORCE_COLOR: "1" }, isTTY: true }, false],
    [{ flag: true, env: { NO_COLOR: "" }, isTTY: false }, true],
    [{ env: { NO_COLOR: "" }, isTTY: true }, true],
    [{ env: { NO_COLOR: "", FORCE_COLOR: "0" }, isTTY: true }, false],
    [{ env: { NO_COLOR: "0", FORCE_COLOR: "1" }, isTTY: true }, false],
    [{ env: { FORCE_COLOR: "1" }, isTTY: false }, true],
    [{ env: { FORCE_COLOR: "0", GITHUB_ACTIONS: "true" }, isTTY: true }, false],
    [{ env: { GITHUB_ACTIONS: "true" }, isTTY: false }, true],
    [{ env: {}, isTTY: true }, true],
    [{ env: {}, isTTY: false }, false],
  ])("resolves precedence for %#", (input, expected) => {
    expect(resolveColor(input)).toBe(expected);
  });
});

describe("colorFlagFromArgv", () => {
  it.each([
    [["node", "cli"], undefined],
    [["node", "cli", "--color"], true],
    [["node", "cli", "--no-color"], false],
    [["node", "cli", "--", "--color"], undefined],
    [["node", "cli", "--color", "--no-color"], false],
    [["node", "cli", "--no-color", "--color"], true],
  ] as const)("reads %#", (argv, expected) => {
    expect(colorFlagFromArgv(argv)).toBe(expected);
  });
});

describe("createStyle", () => {
  it("is an identity style when disabled", () => {
    const style = createStyle(false);
    for (const paint of [style.bold, style.dim, style.red, style.green, style.yellow, style.gray]) {
      expect(paint("text")).toBe("text");
    }
  });

  it("wraps text with the expected SGR sequences", () => {
    const style = createStyle(true);
    expect(style.bold("x")).toBe("\u001B[1mx\u001B[22m");
    expect(style.dim("x")).toBe("\u001B[2mx\u001B[22m");
    expect(style.red("x")).toBe("\u001B[31mx\u001B[39m");
    expect(style.green("x")).toBe("\u001B[32mx\u001B[39m");
    expect(style.yellow("x")).toBe("\u001B[33mx\u001B[39m");
    expect(style.gray("x")).toBe("\u001B[90mx\u001B[39m");
  });
});

describe("styled rendering", () => {
  it("styles the status glyph and new tag after sanitization", () => {
    const lines = renderCheck(row("unsafe\u001B text"), {
      all: false, githubActions: false, idWidth: 13, toolWidth: 13,
    }, createStyle(true));
    expect(lines[0]).toContain("\u001B[31m✖\u001B[39m");
    expect(lines[1]).toContain("\u001B[1m\u001B[31mnew\u001B[39m\u001B[22m");
    expect(lines[1]).toContain("unsafe text");
  });

  it("removes a tool-provided ANSI escape while preserving CLI styling", () => {
    const lines = renderCheck(row("\u001B[31mtool text"), {
      all: false, githubActions: false, idWidth: 13, toolWidth: 13,
    }, createStyle(true));
    expect(lines[1]).not.toContain("\u001B[31mtool");
    expect(lines[1]).toContain("[31mtool text");
    expect(lines[1]).toContain("\u001B[31mnew");
  });
});
