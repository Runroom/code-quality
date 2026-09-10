import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  it("writes comparison JSON and Markdown under the adapter artifact directory", () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-summary-"));
    try {
      writeSummary(root, { id: "ts-fake", ok: true, count: 1, regressions: [], stale: [] }, false);
      expect(readFileSync(join(root, "artifacts/quality/ts-fake/comparison.json"), "utf8")).toBe(
        '{\n  "count": 1,\n  "regressions": [],\n  "stale": []\n}\n',
      );
      expect(readFileSync(join(root, "artifacts/quality/ts-fake/summary.md"), "utf8")).toContain(
        "### ts-fake",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
