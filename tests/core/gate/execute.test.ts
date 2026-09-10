import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { executeGate } from "../../../src/core/gate/execute.ts";
import type { ResolvedConfig } from "../../../src/core/config/types.ts";
import { fakeAdapter, fakeDeps } from "../../helpers/fake-adapter.ts";

const roots: string[] = [];

function consumer(): { root: string; config: ResolvedConfig } {
  const root = mkdtempSync(join(tmpdir(), "code-quality-gate-"));
  roots.push(root);
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "quality"));
  writeFileSync(join(root, "package.json"), "{}", "utf8");
  return {
    root,
    config: {
      root,
      languages: ["ts"],
      paths: { ts: ["src"] },
      exclude: [],
      disabled: [],
      architecture: { ts: { kind: "skip" } },
      configHash: "a".repeat(64),
    },
  };
}

function findings(root: string): Record<string, number> {
  return JSON.parse(readFileSync(join(root, "quality/ts-fake-baseline.json"), "utf8")).findings;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

describe("executeGate initialization", () => {
  it("initializes, compares, and updates reduction-only snapshots", async () => {
    const { root, config } = consumer();
    const initial = fakeAdapter({ id: "ts-fake", findings: { z: 1, a: 2 } });
    const initialized = await executeGate(initial, config, "initialize", fakeDeps());
    expect(initialized.ok).toBe(true);
    expect(findings(root)).toEqual({ a: 2, z: 1 });

    const file = join(root, "quality/ts-fake-baseline.json");
    const bytes = readFileSync(file, "utf8");
    const second = await executeGate(initial, config, "initialize", fakeDeps());
    expect(second.ok).toBe(false);
    expect(second.message).toContain("already exists");
    expect(readFileSync(file, "utf8")).toBe(bytes);

    const equal = await executeGate(initial, config, "check", fakeDeps());
    expect(equal).toMatchObject({ ok: true, regressions: [], stale: [] });
    expect(existsSync(join(root, "artifacts/quality/ts-fake/comparison.json"))).toBe(true);
    expect(existsSync(join(root, "artifacts/quality/ts-fake/summary.md"))).toBe(true);
  });
});

describe("executeGate comparisons", () => {
  it("blocks increases and preserves the baseline", async () => {
    const { root, config } = consumer();
    const initial = fakeAdapter({ id: "ts-fake", findings: { key: 1 } });
    await executeGate(initial, config, "initialize", fakeDeps());
    const file = join(root, "quality/ts-fake-baseline.json");
    const bytes = readFileSync(file, "utf8");

    const increased = fakeAdapter({ id: "ts-fake", findings: { key: 2 } });
    const checked = await executeGate(increased, config, "check", fakeDeps());
    expect(checked).toMatchObject({ ok: false });
    expect(checked.regressions).toContain("key: 1 → 2");
    expect(readFileSync(file, "utf8")).toBe(bytes);
    const updated = await executeGate(increased, config, "update", fakeDeps());
    expect(updated.ok).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(bytes);
  });

  it("requires explicit updates for reductions and rejects changed config", async () => {
    const { root, config } = consumer();
    const initial = fakeAdapter({ id: "ts-fake", findings: { key: 2, removed: 1 } });
    await executeGate(initial, config, "initialize", fakeDeps());

    const reduced = fakeAdapter({ id: "ts-fake", findings: { key: 1 } });
    const checked = await executeGate(reduced, config, "check", fakeDeps());
    expect(checked.ok).toBe(false);
    expect(checked.message).toContain("cleanup detected");
    const updated = await executeGate(reduced, config, "update", fakeDeps());
    expect(updated.ok).toBe(true);
    expect(updated.pendingWrite).toMatchObject({ file: join(root, "quality/ts-fake-baseline.json") });
    expect(findings(root)).toEqual({ key: 2, removed: 1 });

    const file = join(root, "quality/ts-fake-baseline.json");
    const changed = { ...JSON.parse(readFileSync(file, "utf8")), configHash: "c".repeat(64) };
    writeFileSync(file, `${JSON.stringify(changed)}\n`, "utf8");
    const mismatch = await executeGate(reduced, config, "check", fakeDeps());
    expect(mismatch.ok).toBe(false);
    expect(mismatch.message).toContain("tool/config changed");
  });

  it("appends the Markdown summary to GitHub's step summary", async () => {
    const { root, config } = consumer();
    const stepSummary = join(root, "step-summary.md");
    vi.stubEnv("GITHUB_STEP_SUMMARY", stepSummary);
    await executeGate(
      fakeAdapter({ id: "ts-fake", findings: {} }),
      config,
      "initialize",
      fakeDeps(),
    );
    expect(readFileSync(stepSummary, "utf8")).toContain("### ts-fake");
  });
});

it("does not write a summary when no comparison is available", async () => {
  const { root, config } = consumer();
  const stepSummary = join(root, "step-summary.md");
  vi.stubEnv("GITHUB_STEP_SUMMARY", stepSummary);
  const missing = await executeGate(fakeAdapter({ id: "ts-fake" }), config, "check", fakeDeps());
  expect(missing.ok).toBe(false);
  expect(existsSync(stepSummary)).toBe(false);

  await executeGate(fakeAdapter({ id: "ts-fake" }), config, "initialize", fakeDeps());
  rmSync(stepSummary, { force: true });
  const file = join(root, "quality/ts-fake-baseline.json");
  const changed = { ...JSON.parse(readFileSync(file, "utf8")), configHash: "c".repeat(64) };
  writeFileSync(file, `${JSON.stringify(changed)}\n`, "utf8");
  const mismatch = await executeGate(fakeAdapter({ id: "ts-fake" }), config, "check", fakeDeps());
  expect(mismatch.ok).toBe(false);
  expect(existsSync(stepSummary)).toBe(false);
});
