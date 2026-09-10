import { appendFileSync } from "node:fs";

import { artifactDir, writeArtifact } from "../runner/artifacts.ts";
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
  root: string,
  outcome: GateOutcome,
  isDuplication: boolean,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const directory = artifactDir(root, outcome.id);
  const markdown = summaryMarkdown({
    id: outcome.id,
    isDuplication,
    count: outcome.count,
    regressions: outcome.regressions.length,
    stale: outcome.stale.length,
  });
  writeArtifact(
    directory,
    "comparison.json",
    `${JSON.stringify({ count: outcome.count, regressions: outcome.regressions, stale: outcome.stale }, null, 2)}\n`,
  );
  writeArtifact(directory, "summary.md", markdown);
  const stepSummary = env.GITHUB_STEP_SUMMARY;
  if (stepSummary) appendFileSync(stepSummary, markdown, "utf8");
}
