import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { GateOutcome } from "./types.ts";

export function summaryMarkdown(input: {
  id: string;
  isDuplication: boolean;
  count: number;
  regressions: number;
  stale: number;
}): string {
  const label = input.isDuplication ? "exact clone pairs" : "quality findings";
  return `### ${input.id}\n\nRemaining: **${input.count}** ${label}. New/worsened: **${input.regressions}**. Baseline entries to tighten: **${input.stale}**.\n`;
}

export function writeSummary(
  outcome: GateOutcome,
  isDuplication: boolean,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const markdown = summaryMarkdown({
    id: outcome.id,
    isDuplication,
    count: outcome.count,
    regressions: outcome.regressions.length,
    stale: outcome.stale.length,
  });
  const stepSummary = env.GITHUB_STEP_SUMMARY;
  if (stepSummary) {
    mkdirSync(dirname(stepSummary), { recursive: true });
    appendFileSync(stepSummary, markdown, "utf8");
  }
}
