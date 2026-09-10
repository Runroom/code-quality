import { fail } from "../errors.ts";
import { LOGICAL_IDS, type LogicalCheckId } from "../config/schema.ts";
import type { Applicability, CheckAdapter } from "../types.ts";
import type { ResolvedConfig } from "../config/types.ts";

export interface Selection {
  adapters: CheckAdapter[];
  skipped: SkippedEntry[];
  failed: Array<{ id: string; message: string }>;
}

export interface SkippedEntry {
  id: string;
  reason: string;
}

type SelectionState = Selection;

function isKnownId(id: string): id is LogicalCheckId {
  return LOGICAL_IDS.includes(id as LogicalCheckId);
}

function validateIds(ids: LogicalCheckId[]): void {
  for (const id of ids) {
    if (!isKnownId(id)) return fail(`Unknown check id '${id}'. Known: ${LOGICAL_IDS.join(", ")}`);
  }
}

function selected(adapter: CheckAdapter, ids: LogicalCheckId[]): boolean {
  return ids.length === 0 || ids.includes(adapter.check);
}

function disabledReason(config: ResolvedConfig, check: LogicalCheckId): string | undefined {
  return config.disabled.find((entry) => entry.id === check)?.reason;
}

function addSkip(
  skipped: Array<{ id: string; reason: string }>,
  adapter: CheckAdapter,
  reason: string,
): void {
  skipped.push({ id: adapter.id, reason });
}

function addApplicable(
  adapter: CheckAdapter,
  config: ResolvedConfig,
  state: SelectionState,
): void {
  const disabled = disabledReason(config, adapter.check);
  if (disabled !== undefined) {
    addSkip(state.skipped, adapter, disabled);
    return;
  }
  const result: Applicability = adapter.applicability(config);
  if (result.kind === "run") {
    state.adapters.push(adapter);
    return;
  }
  if (result.kind === "skip") {
    addSkip(state.skipped, adapter, result.reason);
    return;
  }
  state.failed.push({ id: adapter.id, message: result.message });
}

export function selectAdapters(
  registry: readonly CheckAdapter[],
  config: ResolvedConfig,
  ids: LogicalCheckId[],
): Selection {
  validateIds(ids);
  const state: SelectionState = { adapters: [], skipped: [], failed: [] };
  for (const adapter of registry) {
    if (config.languages.includes(adapter.language) && selected(adapter, ids)) {
      addApplicable(adapter, config, state);
    }
  }
  return state;
}
