import { existsSync, readFileSync } from "node:fs";

import { Command, CommanderError } from "commander";

import { assetsDir } from "../core/anchor/service.ts";
import { assertNotInCi, resolveMode } from "./guards.ts";
import { checkCommand } from "./commands/check.ts";
import { baselineCommand } from "./commands/baseline.ts";
import { initCommand } from "./commands/init.ts";
import { reportCommand } from "./commands/report.ts";
import { doctorLine, grammarProbes, runDoctor } from "./commands/doctor.ts";
import { versionsText } from "./commands/versions.ts";
import type { CliDeps } from "./deps.ts";
import { fieldLine, plural, sanitizeLine } from "./render.ts";
import type { Style } from "./style.ts";
import { CLI_VERSION } from "./version.ts";

interface ProgramState {
  exitCode: number;
}

interface GateFlags {
  update?: boolean;
  initialize?: boolean;
  all?: boolean;
  artifacts?: string;
}

interface ReportFlags {
  output?: string;
  coverage?: string;
}

const PROGRAM_STATES = new WeakMap<Command, ProgramState>();

function doctorDependencies(deps: CliDeps): { assets: string; probe: (bin: string) => string; exists: (path: string) => boolean; readInstalled: (path: string) => unknown } {
  const assets = deps.env.CODE_QUALITY_ASSETS_DIR ?? assetsDir();
  return {
    assets,
    probe: (bin) => deps.run.spawn({ bin, args: ["--version"], exitCodes: [0] }, deps.cwd).stdout,
    exists: existsSync,
    readInstalled: (path) => JSON.parse(readFileSync(path, "utf8")) as unknown,
  };
}

async function versionsCommand(deps: CliDeps): Promise<number> {
  deps.stdout(`${versionsText({ style: deps.style }).join("\n")}\n`);
  return 0;
}

export function doctorResultLine(probes: readonly { ok: boolean }[], style: Style): string {
  const failed = probes.filter((probe) => !probe.ok).length;
  const result = failed === 0
    ? style.bold(style.green("OK"))
    : style.bold(style.red("FAIL"));
  const detail = failed === 0
    ? plural(probes.length, "probe")
    : `${failed} of ${plural(probes.length, "probe")}`;
  return fieldLine("Result", `${result} · ${detail}`, style);
}

async function doctorCommand(deps: CliDeps): Promise<number> {
  const runtime = doctorDependencies(deps);
  const probes = [...runDoctor(runtime), ...(await grammarProbes(runtime.assets))];
  for (const probe of probes) deps.stdout(`${doctorLine(probe, deps.style)}\n`);
  const failed = probes.filter((probe) => !probe.ok).length;
  deps.stdout("\n");
  deps.stdout(`${doctorResultLine(probes, deps.style)}\n`);
  return failed === 0 ? 0 : 1;
}

async function checkHandler(
  deps: CliDeps,
  state: ProgramState,
  ids: string[],
  flags: GateFlags,
): Promise<number> {
  const mode = resolveMode(flags);
  if (mode === "update") assertNotInCi(deps.env, "--update");
  if (mode === "initialize") assertNotInCi(deps.env, "--initialize");
  const code = await checkCommand(ids, mode, deps, { all: flags.all, artifacts: flags.artifacts });
  state.exitCode = code;
  return code;
}

function registerCommands(program: Command, deps: CliDeps, state: ProgramState): void {
  program.command("check [ids...]")
    .description("Run selected quality checks")
    .option("--update", "refresh existing baselines")
    .option("--initialize", "create missing baselines")
    .option("--all", "print all current findings")
    .option("--artifacts <dir>", "keep raw tool output and logs")
    .action(async (ids: string[], flags: GateFlags) => {
      state.exitCode = await checkHandler(deps, state, ids, flags);
    });
  program.command("baseline")
    .description("Refresh existing baselines")
    .option("--all", "print all current findings")
    .option("--artifacts <dir>", "keep raw tool output and logs")
    .action(async (flags: GateFlags) => {
      assertNotInCi(deps.env, "baseline");
      state.exitCode = await baselineCommand(deps, flags);
    });
  program.command("report")
    .description("Generate advisory reports")
    .option("--output <dir>", "report output directory")
    .option("--coverage <path>", "Istanbul coverage map (coverage-final.json) or its directory")
    .action(async (flags: ReportFlags) => {
      state.exitCode = await reportCommand(deps, flags);
    });
  program.command("init")
    .description("Scaffold and initialize quality baselines")
    .option("--artifacts <dir>", "keep raw tool output and logs")
    .action(async (flags: GateFlags) => {
      assertNotInCi(deps.env, "init");
      state.exitCode = await initCommand(deps, flags);
    });
  program.command("versions").description("Print pinned tool versions").action(async () => {
    state.exitCode = await versionsCommand(deps);
  });
  program.command("doctor").description("Verify tools and grammar assets").action(async () => {
    state.exitCode = await doctorCommand(deps);
  });
}

function createProgram(deps: CliDeps): Command {
  const state: ProgramState = { exitCode: 0 };
  const program = new Command("code-quality")
    .description("Runroom incremental quality gate")
    .version(CLI_VERSION)
    // Resolved before parsing in main.ts because deps.style is needed when commands run.
    .option("--color", "force color output")
    .option("--no-color", "disable color output")
    .exitOverride()
    .configureOutput({
      writeOut: (value) => deps.stdout(value),
      writeErr: (value) => deps.stderr(value),
      outputError: () => {},
    });
  PROGRAM_STATES.set(program, state);
  registerCommands(program, deps, state);
  return program;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSuccessfulCommanderExit(error: CommanderError): boolean {
  return error.exitCode === 0 && (
    error.code === "commander.helpDisplayed" || error.code === "commander.version"
  );
}

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const program = createProgram(deps);
  try {
    await program.parseAsync(argv);
    return PROGRAM_STATES.get(program)?.exitCode ?? 0;
  } catch (error) {
    if (error instanceof CommanderError && isSuccessfulCommanderExit(error)) return 0;
    deps.stderr(`${sanitizeLine(errorMessage(error))}\n`);
    return 1;
  }
}
