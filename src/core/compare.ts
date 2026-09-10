import type { Findings } from "./types.ts";

export interface Comparison {
  regressions: string[];
  stale: string[];
}

export function compareFindings(before: Findings, after: Findings): Comparison {
  const regressions: string[] = [];
  const stale: string[] = [];
  for (const [key, value] of Object.entries(after)) {
    const previous = Object.hasOwn(before, key) ? before[key] : undefined;
    if (previous === undefined) regressions.push(`${key}: new (${value})`);
    else if (value > previous) regressions.push(`${key}: ${previous} → ${value}`);
  }
  for (const [key, value] of Object.entries(before)) {
    if (after[key] !== value && !(after[key]! > value)) stale.push(key);
  }
  return { regressions: regressions.toSorted(), stale: stale.toSorted() };
}
