import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runAdapter } from "../../../src/core/runner/run-adapter.ts";
import { verifyTool } from "../../../src/core/runner/verify.ts";
import type { ToolInvocation } from "../../../src/core/types.ts";
import { fakeAdapter, fakeDeps } from "../../helpers/fake-adapter.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("runAdapter artifacts", () => {
  it("uses temporary output and creates no root artifacts by default", async () => {
    const root = mkdtempSync(join(tmpdir(), "run-adapter-test-"));
    roots.push(root);
    mkdirSync(join(root, "src"));
    const adapter = fakeAdapter({ id: "ts-artifact-order" });
    const deps = fakeDeps();
    const originalSpawn = deps.spawn;
    deps.spawn = (invocation, cwd) => {
      expect(invocation).toBeDefined();
      return originalSpawn(invocation, cwd);
    };
    await runAdapter(adapter, {
      root,
      isDrupal: false,
      languages: ["ts"],
      paths: { ts: ["src"] },
      exclude: [],
      disabled: [],
      architecture: {},
      notices: [],
      configHash: "a".repeat(64),
    }, deps);
    expect(existsSync(join(root, "artifacts"))).toBe(false);
  });

  it("writes logs under an explicit artifacts root", async () => {
    const root = mkdtempSync(join(tmpdir(), "run-adapter-test-"));
    roots.push(root);
    mkdirSync(join(root, "src"));
    const artifactsRoot = join(root, "evidence");
    await runAdapter(fakeAdapter({ id: "ts-logs" }), {
      root,
      isDrupal: false,
      languages: ["ts"],
      paths: { ts: ["src"] },
      exclude: [],
      disabled: [],
      architecture: {},
      notices: [],
      configHash: "a".repeat(64),
    }, { ...fakeDeps(), artifactsRoot });
    expect(readFileSync(join(artifactsRoot, "ts-logs/stdout.log"), "utf8")).toBe("{}");
  });
});

describe("runAdapter tool verification", () => {
  it("probes the tool with the invocation environment and cwd", async () => {
    const root = mkdtempSync(join(tmpdir(), "run-adapter-test-"));
    roots.push(root);
    mkdirSync(join(root, "src"));
    const invocation: ToolInvocation = {
      bin: "fake-tool",
      args: ["check"],
      cwd: join(root, "work"),
      env: { PATH: "/fake/venv:/usr/bin", PYTHONPATH: "/fake/src" },
      exitCodes: [0],
    };
    const adapter = {
      ...fakeAdapter({ id: "python-verify-environment" }),
      tool: { bin: "fake-tool", version: "1.2.3" },
      command: () => invocation,
    };
    const spawn = vi.fn((call: ToolInvocation) => call.args[0] === "--version"
      ? { stdout: "fake-tool 1.2.3\n", stderr: "", exitCode: 0 }
      : { stdout: "{}", stderr: "", exitCode: 0 });

    await runAdapter(adapter, {
      root,
      isDrupal: false,
      languages: ["python"],
      paths: { python: ["src"] },
      exclude: [],
      disabled: [],
      architecture: {},
      notices: [],
      configHash: "a".repeat(64),
    }, { ...fakeDeps(), spawn, verify: verifyTool });

    expect(spawn).toHaveBeenNthCalledWith(1, {
      bin: "fake-tool",
      args: ["--version"],
      cwd: invocation.cwd,
      env: invocation.env,
      exitCodes: [0],
    }, root);
    expect(spawn).toHaveBeenNthCalledWith(2, invocation, root);
  });
});
