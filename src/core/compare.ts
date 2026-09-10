import type { Findings } from "./types.ts";

export interface Comparison {
  regressions: Regression[];
  stale: StaleEntry[];
}

export interface Regression {
  key: string;
  kind: "new" | "worsened";
  previous?: number;
  value: number;
}

export interface StaleEntry {
  key: string;
  previous: number;
  value?: number;
}

function compareKeys(left: { key: string }, right: { key: string }): number {
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

export function compareFindings(before: Findings, after: Findings): Comparison {
  const regressions: Regression[] = [];
  const stale: StaleEntry[] = [];
  for (const [key, value] of Object.entries(after)) {
    const previous = Object.hasOwn(before, key) ? before[key] : undefined;
    if (previous === undefined) regressions.push({ key, kind: "new", value });
    else if (value > previous) regressions.push({ key, kind: "worsened", previous, value });
  }
  for (const [key, value] of Object.entries(before)) {
    const current = after[key];
    if (current === undefined) stale.push({ key, previous: value });
    else if (current < value) stale.push({ key, previous: value, value: current });
  }
  return {
    regressions: regressions.toSorted(compareKeys),
    stale: stale.toSorted(compareKeys),
  };
}
