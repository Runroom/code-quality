import { describe, expect, it } from "vitest";

import { PYTHON_VENV_TOOLS } from "../../src/checks/python/interpreter.ts";
import { PYTHON_314_BIN } from "../../src/core/config/runtime.ts";
import { versionsText } from "../../src/cli/commands/versions.ts";
import {
  ADAPTERS,
  LIBRARY_PINS,
  RUNTIME_PINS,
  RUNTIME_PRESENCE,
  TOOL_PINS,
} from "../../src/registry.ts";

describe("versionsText", () => {
  it("prints tools and libraries in registry order", () => {
    const lines = versionsText();
    expect(lines[0]).toBe(" Tools");
    expect(lines).toContain(" TS/JS");
    expect(lines).toContain(" PHP");
    expect(lines).toContain(" Python");
    expect(lines).toContain(" Runtime");
    expect(lines).toContain(" Libraries");
    expect(lines).not.toContain(" Other");
    for (const { bin, version } of TOOL_PINS) {
      expect(lines.filter((line) => line.trimStart().startsWith(`${bin} `)
        && line.endsWith(version))).toHaveLength(1);
    }
    for (const { name, version } of LIBRARY_PINS) {
      expect(lines.filter((line) => line.trimStart().startsWith(`${name} `)
        && line.endsWith(version))).toHaveLength(1);
    }
    for (const { bin, version } of RUNTIME_PINS) {
      expect(lines.filter((line) => line.trimStart().startsWith(`${bin} `)
        && line.endsWith(version))).toHaveLength(1);
    }
    for (const bin of RUNTIME_PRESENCE) {
      expect(lines.filter((line) => line.trimStart().startsWith(`${bin} `)
        && line.endsWith("presence (verified by doctor)"))).toHaveLength(1);
    }
  });

  it("renders uncategorized pins in Other", () => {
    const other = [{ bin: "other-only", version: "1.2.3" }];
    const lines = versionsText({ pins: other, libraries: [], runtime: [] });
    expect(lines).toContain(" Runtime");
    expect(lines).toContain(" Other");
    expect(lines.filter((line) => line.trimStart().startsWith("other-only "))).toHaveLength(1);
  });

  it("derives one venv314 runtime pin per wrapped Python tool", () => {
    const venvPins = RUNTIME_PINS
      .filter((pin) => pin.bin.startsWith(`${PYTHON_314_BIN}/`))
      .map((pin) => pin.bin.slice(PYTHON_314_BIN.length + 1));
    expect(venvPins).toEqual([...PYTHON_VENV_TOOLS]);
  });

  it("declares every adapter tool in the registry", () => {
    const binaries = new Set(TOOL_PINS.map(({ bin }) => bin));
    expect(ADAPTERS.every((adapter) => binaries.has(adapter.tool.bin))).toBe(true);
  });
});
