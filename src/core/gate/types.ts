import type { Snapshot } from "../snapshot.ts";

export interface GateOutcome {
  id: string;
  ok: boolean;
  count: number;
  regressions: string[];
  stale: string[];
  message?: string;
  pendingWrite?: { file: string; snapshot: Snapshot };
}
