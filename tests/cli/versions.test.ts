import { describe, expect, it } from "vitest";

import { versionsText } from "../../src/cli/commands/versions.ts";
import { ADAPTERS, LIBRARY_PINS, TOOL_PINS } from "../../src/registry.ts";

describe("versionsText", () => {
  it("prints tools and libraries in registry order", () => {
    const lines = versionsText().split("\n");
    expect(lines).toHaveLength(17);
    expect(lines).toEqual([
      ...TOOL_PINS.map(({ bin, version }) => `${bin} ${version}`),
      ...LIBRARY_PINS.map(({ name, version }) => `${name} ${version} (library)`),
    ]);
    expect(lines.every((line) => /^\S+ \d+\.\d+(\.\d+)?( \(library\))?$/.test(line))).toBe(true);
  });

  it("declares every adapter tool in the registry", () => {
    const binaries = new Set(TOOL_PINS.map(({ bin }) => bin));
    expect(ADAPTERS.every((adapter) => binaries.has(adapter.tool.bin))).toBe(true);
  });
});
