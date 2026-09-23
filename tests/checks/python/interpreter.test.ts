import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { complexipyAdapter } from "../../../src/checks/python/complexipy.ts";
import { deptryAdapter } from "../../../src/checks/python/deptry.ts";
import { importLinterAdapter } from "../../../src/checks/python/import-linter.ts";
import { PYTHON_VENV_TOOLS, pythonInvocation } from "../../../src/checks/python/interpreter.ts";
import { ruffAdapter } from "../../../src/checks/python/ruff.ts";
import { vultureAdapter } from "../../../src/checks/python/vulture.ts";
import { ADAPTERS } from "../../../src/registry.ts";
import type { CheckAdapter, ToolInvocation } from "../../../src/core/types.ts";
import { checkContext } from "../../helpers/check-context.ts";

const invocation: ToolInvocation = { bin: "tool", args: [], env: { KEEP: "yes" }, exitCodes: [0] };

function withRoot(version: string | undefined, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "code-quality-interpreter-"));
  try {
    if (version !== undefined) writeFileSync(join(root, ".python-version"), `${version}\n`);
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function pythonAdapters(): CheckAdapter[] {
  return ADAPTERS.filter((adapter) => adapter.language === "python");
}

function venvAdapters(adapters: readonly CheckAdapter[]): CheckAdapter[] {
  return adapters.filter((adapter) =>
    (PYTHON_VENV_TOOLS as readonly string[]).includes(adapter.tool.bin)
  );
}

function adapterWithBin(adapters: readonly CheckAdapter[], bin: string): CheckAdapter {
  return adapters.find((adapter) => adapter.tool.bin === bin)!;
}

describe("pythonInvocation", () => {
  it.each([undefined, "3.13"])("returns the invocation unchanged for target %s", (version) => {
    withRoot(version, (root) => expect(
      pythonInvocation(checkContext(root, "python"), invocation),
    ).toBe(invocation));
  });

  it.each(["3.14", "3.15"])("prefixes PATH and preserves other environment keys for Python %s", (version) => {
    withRoot(version, (root) => {
      const result = pythonInvocation(checkContext(root, "python"), invocation);
      expect(result.env).toMatchObject({ KEEP: "yes" });
      expect(result.env?.PATH).toBe(`/opt/venv314/bin:${process.env.PATH ?? ""}`);
    });
  });

  it("does not append an empty PATH component", () => {
    const original = process.env.PATH;
    delete process.env.PATH;
    try {
      withRoot("3.14", (root) => {
        expect(pythonInvocation(checkContext(root, "python"), invocation).env?.PATH)
          .toBe("/opt/venv314/bin");
      });
    } finally {
      if (original === undefined) delete process.env.PATH;
      else process.env.PATH = original;
    }
  });
});

describe("Python adapter interpreter selection", () => {
  it.each([
    ["ruff", ruffAdapter],
    ["complexipy", complexipyAdapter],
    ["vulture", vultureAdapter],
    ["deptry", deptryAdapter],
    ["import-linter", importLinterAdapter],
  ] satisfies Array<[string, CheckAdapter]>)("prefixes PATH for %s", (_name, adapter) => {
    withRoot("3.14", (root) => {
      const context = checkContext(root, "python");
      context.config.architecture.python = { kind: "file", rulesFile: ".importlinter" };
      expect(adapter.command(context).env?.PATH).toMatch(/^\/opt\/venv314\/bin:/u);
    });
  });

  it("wraps every registered venv tool but not Python jscpd", () => {
    withRoot("3.14", (root) => {
      const context = checkContext(root, "python");
      context.config.architecture.python = { kind: "file", rulesFile: ".importlinter" };
      const adapters = pythonAdapters();
      const wrapped = venvAdapters(adapters);
      const wrappedBins: string[] = [];
      for (const adapter of wrapped) {
        wrappedBins.push(adapter.tool.bin);
        expect(adapter.command(context).env?.PATH).toMatch(/^\/opt\/venv314\/bin(?::|$)/u);
      }
      expect(wrappedBins.toSorted()).toEqual([...PYTHON_VENV_TOOLS].toSorted());
      const jscpd = adapterWithBin(adapters, "jscpd");
      expect(jscpd.command(context).env?.PATH).toBeUndefined();
    });
  });
});
