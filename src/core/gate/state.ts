import type { Comparison } from "../compare.ts";
import type { Snapshot } from "../snapshot.ts";

export type Mode = "check" | "update" | "initialize";

export type Decision =
  | { action: "write"; reason: "initialize" | "update" }
  | { action: "pass" }
  | { action: "fail"; message: string };

export interface DecisionInput {
  mode: Mode;
  exists: boolean;
  baseline: Snapshot | undefined;
  current: Snapshot;
  comparison: Comparison | undefined;
  id: string;
}

interface DecisionContext extends DecisionInput {
  file: string;
}

interface DecisionRule {
  matches(context: DecisionContext): boolean;
  decide(context: DecisionContext): Decision;
}

function failure(message: string): Decision {
  return { action: "fail", message };
}

function initializeExisting(context: DecisionContext): Decision {
  return failure(`${context.file} already exists; initialization cannot replace an existing baseline.`);
}

function missingBaseline(context: DecisionContext): Decision {
  return failure(
    `${context.file} is missing. Run code-quality check ${context.id} --initialize locally and commit it.`,
  );
}

function changedBaseline(context: DecisionContext): Decision {
  const baseline = context.baseline!;
  const baselineHash = baseline.configHash.slice(0, 8);
  const currentHash = context.current.configHash.slice(0, 8);
  return failure(
    `${context.id}: tool/config changed (baseline ${baseline.tool}/${baselineHash}, current ${context.current.tool}/${currentHash}). Review and regenerate the baseline explicitly with --initialize; ordinary refresh cannot change policy.`,
  );
}

function regressions(context: DecisionContext): Decision {
  return failure(`${context.id} regressions:\n${context.comparison!.regressions.join("\n")}`);
}

function stale(context: DecisionContext): Decision {
  return failure(
    `${context.id}: cleanup detected (${context.comparison!.stale.length} stale entries). Run code-quality baseline and commit the reduced baseline.`,
  );
}

function isInitializeExisting(context: DecisionContext): boolean {
  return context.mode === "initialize" && context.exists;
}

function isInitialize(context: DecisionContext): boolean {
  return context.mode === "initialize";
}

function isMissing(context: DecisionContext): boolean {
  return context.mode !== "initialize" && !context.exists;
}

function isChanged(context: DecisionContext): boolean {
  const baseline = context.baseline;
  return baseline !== undefined &&
    (baseline.tool !== context.current.tool || baseline.configHash !== context.current.configHash);
}

function hasRegressions(context: DecisionContext): boolean {
  return (context.comparison?.regressions.length ?? 0) > 0;
}

function isUpdate(context: DecisionContext): boolean {
  return context.mode === "update";
}

function hasStale(context: DecisionContext): boolean {
  return (context.comparison?.stale.length ?? 0) > 0;
}

const DECISION_RULES: readonly DecisionRule[] = [
  { matches: isInitializeExisting, decide: initializeExisting },
  { matches: isInitialize, decide: () => ({ action: "write", reason: "initialize" }) },
  { matches: isMissing, decide: missingBaseline },
  { matches: isChanged, decide: changedBaseline },
  { matches: hasRegressions, decide: regressions },
  { matches: isUpdate, decide: () => ({ action: "write", reason: "update" }) },
  { matches: hasStale, decide: stale },
];

function contextFor(input: DecisionInput): DecisionContext {
  return {
    ...input,
    file: `quality/${input.id}-baseline.json`,
  };
}

export function decide(input: DecisionInput): Decision {
  const context = contextFor(input);
  return DECISION_RULES.find((rule) => rule.matches(context))?.decide(context) ?? { action: "pass" };
}
