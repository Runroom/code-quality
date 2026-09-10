import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { loadConfig } from "../../core/config/load.ts";
import { executeGate } from "../../core/gate/execute.ts";
import { selectAdapters } from "../../core/gate/select.ts";
import { baselineFile } from "../../core/types.ts";
import { parseLogicalIds } from "../../registry.ts";
import type { CliDeps } from "../deps.ts";
import type { GateOutcome } from "../../core/gate/types.ts";
import type { Mode } from "../../core/gate/state.ts";
import type { CheckAdapter } from "../../core/types.ts";
import { writeSnapshot } from "../../core/snapshot.ts";
import type { ResolvedConfig } from "../../core/config/types.ts";
import { renderOutcome, renderSummary, sanitizeLine, type OutcomeRow } from "../render.ts";

const NOTHING_TO_CHECK = "Nothing to check: no supported sources found. Declare languages and paths "
  + "in .code-quality.yml.";

function printOutcome(row: OutcomeRow, deps: CliDeps, all: boolean): void {
  for (const line of renderOutcome(row, {
    all,
    githubActions: deps.env.GITHUB_ACTIONS === "true",
  })) deps.stdout(`${line}\n`);
  const { outcome } = row;
  if (outcome.message !== undefined) deps.stderr(`${sanitizeLine(outcome.message)}\n`);
}

function printNoticesOrReject(config: ResolvedConfig, deps: CliDeps): boolean {
  for (const notice of config.notices) deps.stdout(`${sanitizeLine("Notice: " + notice)}\n`);
  if (config.languages.length > 0) return false;
  deps.stderr(`${sanitizeLine(NOTHING_TO_CHECK)}\n`);
  return true;
}

function runtimeNoticeSink(deps: CliDeps): (message: string) => void {
  const emitted = new Set<string>();
  return (message) => {
    const file = /^anchors for (\S+) /u.exec(message)?.[1];
    const key = file === undefined ? message : `anchors:${file}`;
    if (emitted.has(key)) return;
    emitted.add(key);
    deps.stdout(`${sanitizeLine(`Notice: ${message}`)}\n`);
  };
}

function finalCode(outcomes: readonly GateOutcome[]): number {
  return outcomes.every((outcome) => outcome.ok) ? 0 : 1;
}

function failedOutcome(entry: { id: string; message: string }): GateOutcome {
  return {
    id: entry.id,
    ok: false,
    count: 0,
    regressions: [],
    stale: [],
    details: {},
    tool: "",
    message: entry.message,
  };
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
  all?: boolean | undefined;
  artifacts?: string | undefined;
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

function runDependencies(deps: CliDeps, artifacts: string | undefined) {
  return {
    ...deps.run,
    env: deps.env,
    notice: runtimeNoticeSink(deps),
    ...(artifacts === undefined ? {} : { artifactsRoot: resolve(deps.cwd, artifacts) }),
  };
}

export async function checkCommand(
  ids: string[],
  mode: Mode,
  deps: CliDeps,
  options: CheckOptions = {},
): Promise<number> {
  const config = options.config ?? loadConfig(deps.cwd);
  if (printNoticesOrReject(config, deps)) return 1;
  const registry = mode === "initialize" && options.keepExisting
    ? deps.registry.filter((adapter) => {
      if (!config.languages.includes(adapter.language)) return true;
      return !keepExistingBaseline(adapter, deps.cwd, deps);
    })
    : deps.registry;
  const selection = selectAdapters(registry, config, parseLogicalIds(ids));
  const rows: OutcomeRow[] = [];
  const run = runDependencies(deps, options.artifacts);
  for (const entry of selection.failed) {
    const outcome = failedOutcome(entry);
    const row: OutcomeRow = { outcome, check: "architecture" };
    rows.push(row);
    printOutcome(row, deps, options.all === true);
  }
  for (const adapter of selection.adapters) {
    const outcome = await executeAdapter(adapter, config, mode, run);
    const row: OutcomeRow = { outcome, check: adapter.check };
    rows.push(row);
    printOutcome(row, deps, options.all === true);
  }
  const outcomes = rows.map((row) => row.outcome);
  if (mode === "update") flushPendingWrites(outcomes);
  for (const line of renderSummary(rows, selection.skipped)) deps.stdout(`${line}\n`);
  return finalCode(outcomes);
}
