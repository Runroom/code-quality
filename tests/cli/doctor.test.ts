import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  doctorLine,
  grammarProbes,
  runDoctor,
  type DoctorDeps,
} from "../../src/cli/commands/doctor.ts";
import { LIBRARY_PINS, TOOL_PINS } from "../../src/registry.ts";
import { createStyle } from "../../src/cli/style.ts";

function exactDependencies(): DoctorDeps {
  return {
    probe: (bin) => `${bin} ${TOOL_PINS.find((pin) => pin.bin === bin)?.version}`,
    exists: () => true,
    readInstalled: (path) => {
      const name = path.includes("phpcs") ? "slevomat/coding-standard" : "shipmonk/dead-code-detector";
      const version = LIBRARY_PINS.find((pin) => pin.name === name)?.version;
      return { packages: [{ name, version }] };
    },
    assets: "/assets",
  };
}

describe("runDoctor", () => {
  it("renders successful and failed probes in the CLI layout", () => {
    const style = createStyle(false);
    expect(doctorLine({ name: "oxlint", ok: true, detail: "1.82.0" }, style))
      .toBe(" ✔ oxlint  1.82.0");
    expect(doctorLine({ name: "phpcs", ok: false, detail: "missing" }, style))
      .toBe(" ✖ phpcs  missing");
  });

  it("accepts exact tool, library, and asset versions", () => {
    expect(runDoctor(exactDependencies()).every((probe) => probe.ok)).toBe(true);
  });

  it("reports an exact tool mismatch", () => {
    const probes = runDoctor({ ...exactDependencies(), probe: (bin) => bin === "oxlint" ? "oxlint 1.81.0" : `${bin} ${TOOL_PINS.find((pin) => pin.bin === bin)?.version}` });
    expect(probes.find((probe) => probe.name === "oxlint")).toEqual({
      name: "oxlint",
      ok: false,
      detail: "expected 1.82.0, received 1.81.0",
    });
  });

  it("reports a missing grammar asset", () => {
    const probes = runDoctor({ ...exactDependencies(), exists: (path) => !path.endsWith("tree-sitter-php.wasm") });
    expect(probes.find((probe) => probe.name === "tree-sitter-php.wasm")?.ok).toBe(false);
  });

  it("reports an installed library mismatch", () => {
    const probes = runDoctor({
      ...exactDependencies(),
      readInstalled: (path) => path.includes("phpcs")
        ? { packages: [{ name: "slevomat/coding-standard", version: "8.30.0" }] }
        : { packages: [{ name: "shipmonk/dead-code-detector", version: "1.4.0" }] },
    });
    expect(probes.find((probe) => probe.name === "slevomat/coding-standard")).toMatchObject({
      ok: false,
      detail: "expected 8.31.1, received 8.30.0",
    });
  });
});

describe("grammarProbes", () => {
  it("parses every grammar from the built assets directory", async () => {
    const assets = process.env.CODE_QUALITY_ASSETS_DIR ?? resolve("dist/assets");
    expect((await grammarProbes(assets)).every((probe) => probe.ok)).toBe(true);
  });

  it("reports failures when grammar assets are missing", async () => {
    const probes = await grammarProbes("/missing/code-quality-assets");
    expect(probes.every((probe) => !probe.ok)).toBe(true);
  });
});
