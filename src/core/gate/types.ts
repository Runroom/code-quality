import type { Snapshot } from "../snapshot.ts";
import type { Regression, StaleEntry } from "../compare.ts";
import type { DuplicateDetail, FindingDetails } from "../types.ts";

export interface GateOutcome {
  id: string;
  ok: boolean;
  count: number;
  regressions: Regression[];
  stale: StaleEntry[];
  details: FindingDetails;
  duplicates?: DuplicateDetail[];
  tool: string;
  message?: string;
  pendingWrite?: { file: string; snapshot: Snapshot };
}
