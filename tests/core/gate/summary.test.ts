import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { summaryMarkdown, writeSummary } from "../../../src/core/gate/summary.ts";

describe("summaryMarkdown", () => {
  it("uses the quality finding label", () => {
    expect(summaryMarkdown({ id: "complexity", isDuplication: false, count: 2, regressions: 1, stale: 3 })).toBe(
      "### complexity\n\nRemaining: **2** quality findings. New/worsened: **1**. Baseline entries to tighten: **3**.\n",
    );
  });

  it("uses the exact clone pair label for duplication", () => {
    expect(summaryMarkdown({ id: "duplication", isDuplication: true, count: 4, regressions: 0, stale: 1 })).toContain(
      "Remaining: **4** exact clone pairs.",
    );
  });
});

describe("writeSummary", () => {
  it("only appends Markdown when a GitHub step summary is configured", () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-summary-"));
    try {
      const stepSummary = join(root, "step-summary.md");
      const outcome = {
        id: "ts-fake", ok: true, count: 1, regressions: [], stale: [],
        details: {}, tool: "node 0.0.0",
      };
      writeSummary(outcome, false, {});
      expect(existsSync(join(root, "artifacts"))).toBe(false);
      writeSummary(outcome, false, { GITHUB_STEP_SUMMARY: stepSummary });
      expect(readFileSync(stepSummary, "utf8")).toContain("### ts-fake");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates a missing GitHub step summary directory", () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-summary-"));
    try {
      const stepSummary = join(root, "artifacts", "step-summary.md");
      const outcome = {
        id: "ts-fake", ok: true, count: 1, regressions: [], stale: [],
        details: {}, tool: "node 0.0.0",
      };
      writeSummary(outcome, false, { GITHUB_STEP_SUMMARY: stepSummary });
      expect(readFileSync(stepSummary, "utf8")).toContain("### ts-fake");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
