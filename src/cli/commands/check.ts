import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { loadConfig } from "../../core/config/load.ts";
import { executeGate } from "../../core/gate/execute.ts";
import { selectAdapters } from "../../core/gate/select.ts";
import { summaryMarkdown } from "../../core/gate/summary.ts";
import { baselineFile } from "../../core/types.ts";
import { parseLogicalIds } from "../../registry.ts";
import type { CliDeps } from "../deps.ts";
import type { GateOutcome } from "../../core/gate/types.ts";
import type { Mode } from "../../core/gate/state.ts";
import type { CheckAdapter } from "../../core/types.ts";
import { writeSnapshot } from "../../core/snapshot.ts";
import type { ResolvedConfig } from "../../core/config/types.ts";

function summaryFor(outcome: GateOutcome, check: string): string {
  return summaryMarkdown({
    id: outcome.id,
    isDuplication: check === "duplication",
    count: outcome.count,
    regressions: outcome.regressions.length,
    stale: outcome.stale.length,
  });
}

function printOutcome(
  outcome: GateOutcome,
  deps: CliDeps,
  check: string,
  showSummary = outcome.ok || outcome.regressions.length > 0 || outcome.stale.length > 0,
): void {
  if (showSummary) deps.stdout(summaryFor(outcome, check));
  if (outcome.message !== undefined) deps.stderr(`${outcome.message}\n`);
}

function printSkipped(skipped: Array<{ id: string; reason: string }>, deps: CliDeps): void {
  for (const entry of skipped) deps.stdout(`Skipped: ${entry.id} (${entry.reason})\n`);
}

function finalCode(outcomes: readonly GateOutcome[]): number {
  return outcomes.every((outcome) => outcome.ok) ? 0 : 1;
}

function failedOutcome(entry: { id: string; message: string }): GateOutcome {
  return { id: entry.id, ok: false, count: 0, regressions: [], stale: [], message: entry.message };
}

function adapterFailure(adapter: CheckAdapter, error: unknown): GateOutcome {
  const message = error instanceof Error ? error.message : String(error);
  const prefixed = message.startsWith(`${adapter.id}:`) ? message : `${adapter.id}: ${message}`;
  return failedOutcome({ id: adapter.id, message: prefixed });
}

function flushPendingWrites(outcomes: readonly GateOutcome[]): void {
  if (!outcomes.every((outcome) => outcome.ok)) return;
  for (const outcome of outcomes) {
    if (outcome.pendingWrite === undefined) continue;
    mkdirSync(dirname(outcome.pendingWrite.file), { recursive: true });
    writeSnapshot(outcome.pendingWrite.file, outcome.pendingWrite.snapshot);
  }
}

interface CheckOptions {
  keepExisting?: boolean;
  config?: ResolvedConfig;
}

function keepExistingBaseline(adapter: CheckAdapter, root: string, deps: CliDeps): boolean {
  const file = baselineFile(adapter);
  if (!existsSync(join(root, file))) return false;
  deps.stdout(`Kept existing: ${file}\n`);
  return true;
}

async function executeAdapter(
  adapter: CheckAdapter,
  config: ResolvedConfig,
  mode: Mode,
  run: Parameters<typeof executeGate>[3],
): Promise<GateOutcome> {
  try {
    return await executeGate(adapter, config, mode, run);
  } catch (error) {
    return adapterFailure(adapter, error);
  }
}

export async function checkCommand(
  ids: string[],
  mode: Mode,
  deps: CliDeps,
  options: CheckOptions = {},
): Promise<number> {
  const config = options.config ?? loadConfig(deps.cwd);
  for (const notice of config.notices) deps.stdout(`Notice: ${notice}\n`);
  const registry = mode === "initialize" && options.keepExisting
    ? deps.registry.filter((adapter) => {
      if (!config.languages.includes(adapter.language)) return true;
      return !keepExistingBaseline(adapter, deps.cwd, deps);
    })
    : deps.registry;
  const selection = selectAdapters(registry, config, parseLogicalIds(ids));
  const outcomes: GateOutcome[] = [];
  const run = { ...deps.run, env: deps.env };
  for (const entry of selection.failed) {
    const outcome = failedOutcome(entry);
    outcomes.push(outcome);
    printOutcome(outcome, deps, "architecture", true);
  }
  for (const adapter of selection.adapters) {
    const outcome = await executeAdapter(adapter, config, mode, run);
    outcomes.push(outcome);
    printOutcome(outcome, deps, adapter.check);
  }
  if (mode === "update") flushPendingWrites(outcomes);
  printSkipped(selection.skipped, deps);
  const failures = outcomes.filter((outcome) => !outcome.ok).length;
  deps.stdout(failures === 0 ? "code-quality: PASS\n" : `code-quality: FAIL (${failures} checks)\n`);
  return finalCode(outcomes);
}
