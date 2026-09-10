import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { compareFindings, type Comparison } from "../compare.ts";
import { baselineFile, type CheckAdapter } from "../types.ts";
import { readSnapshot, writeSnapshot, type Snapshot } from "../snapshot.ts";
import { runAdapter, type RunDeps } from "../runner/run-adapter.ts";
import { decide, type Decision, type Mode } from "./state.ts";
import { writeSummary } from "./summary.ts";
import type { ResolvedConfig } from "../config/types.ts";
import type { GateOutcome } from "./types.ts";

function findingCount(adapter: CheckAdapter, findings: Snapshot["findings"]): number {
  if (adapter.check !== "duplication") return Object.keys(findings).length;
  return Object.values(findings).reduce((total, value) => total + value, 0);
}

function readBaseline(file: string, mode: Mode, exists: boolean): Snapshot | undefined {
  if (!exists || mode === "initialize") return undefined;
  return readSnapshot(file);
}

function comparisonFor(
  baseline: Snapshot | undefined,
  current: Snapshot,
): Comparison | undefined {
  if (baseline === undefined) return undefined;
  if (baseline.tool !== current.tool || baseline.configHash !== current.configHash) return undefined;
  return compareFindings(baseline.findings, current.findings);
}

function outcomeFor(
  adapter: CheckAdapter,
  current: Snapshot,
  comparison: Comparison | undefined,
  decision: Decision,
): GateOutcome {
  const regressions = comparison?.regressions ?? [];
  const stale = comparison?.stale ?? [];
  return {
    id: adapter.id,
    ok: decision.action !== "fail",
    count: findingCount(adapter, current.findings),
    regressions,
    stale,
    ...(decision.action === "fail" ? { message: decision.message } : {}),
  };
}

function pendingUpdate(
  outcome: GateOutcome, file: string, current: Snapshot, decision: Decision,
): GateOutcome {
  if (decision.action !== "write" || decision.reason !== "update") return outcome;
  return { ...outcome, pendingWrite: { file, snapshot: current } };
}

function writeCurrent(file: string, current: Snapshot): void {
  mkdirSync(dirname(file), { recursive: true });
  writeSnapshot(file, current);
}

function applyInitialization(file: string, current: Snapshot, decision: Decision): void {
  if (decision.action === "write" && decision.reason === "initialize") writeCurrent(file, current);
}

export async function executeGate(
  adapter: CheckAdapter,
  config: ResolvedConfig,
  mode: Mode,
  deps: RunDeps,
): Promise<GateOutcome> {
  const current = await runAdapter(adapter, config, deps);
  const file = join(config.root, baselineFile(adapter));
  const exists = existsSync(file);
  const baseline = readBaseline(file, mode, exists);
  const comparison = comparisonFor(baseline, current);
  const decision = decide({ mode, exists, baseline, current, comparison, id: adapter.id });
  applyInitialization(file, current, decision);
  const outcome = pendingUpdate(outcomeFor(adapter, current, comparison, decision),
    file, current, decision);
  if (decision.action !== "fail" || comparison !== undefined) {
    writeSummary(config.root, outcome, adapter.check === "duplication", deps.env);
  }
  return outcome;
}
