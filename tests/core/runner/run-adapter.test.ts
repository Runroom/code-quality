import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runAdapter } from "../../../src/core/runner/run-adapter.ts";
import { fakeAdapter, fakeDeps } from "../../helpers/fake-adapter.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("runAdapter artifacts", () => {
  it("creates the adapter artifact directory before spawning", async () => {
    const root = mkdtempSync(join(tmpdir(), "run-adapter-test-"));
    roots.push(root);
    mkdirSync(join(root, "src"));
    const adapter = fakeAdapter({ id: "ts-artifact-order" });
    const deps = fakeDeps();
    const originalSpawn = deps.spawn;
    deps.spawn = (invocation, cwd) => {
      expect(existsSync(join(root, "artifacts/quality/ts-artifact-order"))).toBe(true);
      return originalSpawn(invocation, cwd);
    };
    await runAdapter(adapter, {
      root,
      languages: ["ts"],
      paths: { ts: ["src"] },
      exclude: [],
      disabled: [],
      architecture: {},
      configHash: "a".repeat(64),
    }, deps);
  });
});
