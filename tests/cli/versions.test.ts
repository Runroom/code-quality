import { describe, expect, it } from "vitest";

import { versionsText } from "../../src/cli/commands/versions.ts";
import { ADAPTERS, LIBRARY_PINS, TOOL_PINS } from "../../src/registry.ts";

describe("versionsText", () => {
  it("prints tools and libraries in registry order", () => {
    const lines = versionsText();
    expect(lines[0]).toBe(" Tools");
    expect(lines).toContain(" TS/JS");
    expect(lines).toContain(" PHP");
    expect(lines).toContain(" Python");
    expect(lines).toContain(" Libraries");
    for (const { bin, version } of TOOL_PINS) {
      expect(lines.filter((line) => line.trimStart().startsWith(`${bin} `)
        && line.endsWith(version))).toHaveLength(1);
    }
    for (const { name, version } of LIBRARY_PINS) {
      expect(lines.filter((line) => line.trimStart().startsWith(`${name} `)
        && line.endsWith(version))).toHaveLength(1);
    }
  });

  it("declares every adapter tool in the registry", () => {
    const binaries = new Set(TOOL_PINS.map(({ bin }) => bin));
    expect(ADAPTERS.every((adapter) => binaries.has(adapter.tool.bin))).toBe(true);
  });
});
