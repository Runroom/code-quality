import { assertInScope, fail, FindingsBuilder } from "../shared/kit.ts";
import { resolveModuleFile } from "./modules.ts";
import type { CheckAdapter, CheckContext, ParsedFindings } from "../shared/kit.ts";
import { pythonInvocation } from "./interpreter.ts";

const RESULT = /^(?<name>.+?) (?<result>KEPT|BROKEN)( \([^)]*\))?$/u;
const TOTALS = /^Contracts: (?<kept>\d+) kept, (?<broken>\d+) broken\.$/u;
const VIOLATION = /^(?<lower>\S+) is not allowed to import (?<upper>\S+):$/u;
const CHAIN = /^-?\s*(& )?(?<lower>\S+)( -> (?<upper>\S+))? \(l\.(?<line>\d+)(, l\.\d+)*\)$/u;
const CONTINUATION = /^\s+& \S+ \(l\.\d+(, l\.\d+)*\)$/u;

interface ParseState {
  section: "header" | "broken" | "warnings";
  broken: Set<string>;
  current: string | undefined;
  pending: { lower: string; upper: string } | undefined;
  undeclared: boolean;
  keptCount: number;
  brokenCount: number;
  totals?: { kept: number; broken: number };
}

function initialState(): ParseState {
  return { section: "header", broken: new Set(), undeclared: false,
    current: undefined, pending: undefined, keptCount: 0, brokenCount: 0 };
}

function parseResult(line: string, state: ParseState): boolean {
  const match = RESULT.exec(line);
  if (!match?.groups) return false;
  if (match.groups.result === "KEPT") state.keptCount += 1;
  else {
    state.brokenCount += 1;
    state.broken.add(match.groups.name!);
  }
  return true;
}

function parseTotals(line: string, state: ParseState): boolean {
  const match = TOTALS.exec(line);
  if (!match?.groups) return false;
  state.totals = { kept: Number(match.groups.kept), broken: Number(match.groups.broken) };
  return true;
}

function isDecoration(line: string): boolean {
  return line === "Import Linter" || line === "Contracts" || /^=+$/u.test(line)
    || /^-+$/u.test(line) || /^Analyzed \d+ files, \d+ dependencies\.$/u.test(line);
}

function setSection(line: string, state: ParseState): boolean {
  if (line === "Broken contracts") {
    state.section = "broken";
    state.current = undefined;
    state.pending = undefined;
    return true;
  }
  if (line === "Warnings") {
    state.section = "warnings";
    return true;
  }
  return false;
}

function parseViolation(state: ParseState, line: string): boolean {
  const match = VIOLATION.exec(line);
  if (!match?.groups || !state.current) return false;
  state.pending = { lower: match.groups.lower!, upper: match.groups.upper! };
  return true;
}

function addChainViolation(
  ctx: CheckContext, findings: FindingsBuilder, state: ParseState, line: string,
): boolean {
  const match = CHAIN.exec(line);
  if (!match?.groups) return false;
  const lower = match.groups.lower!;
  const upper = match.groups.upper;
  if (!state.pending || !state.current || !upper) return true;
  addImportFinding(ctx, findings, {
    moduleId: lower, rule: `import-linter:${state.current}`, upper,
    line: Number(match.groups.line),
  });
  state.pending = undefined;
  return true;
}

function addUndeclared(
  ctx: CheckContext, findings: FindingsBuilder, state: ParseState, line: string,
): boolean {
  if (!state.undeclared || !state.current || !/^- \S+$/u.test(line)) return false;
  const moduleId = line.slice(2);
  addImportFinding(ctx, findings, {
    moduleId, rule: `import-linter:${state.current}:undeclared`, upper: moduleId,
  });
  return true;
}

function addImportFinding(
  ctx: CheckContext,
  findings: FindingsBuilder,
  input: { moduleId: string; rule: string; upper: string; line?: number },
): void {
  const contract = input.rule.split(":")[1]!;
  const file = resolveModuleFile(ctx.root, ctx.paths, input.moduleId);
  if (file === input.moduleId) {
    findings.add({
      file: input.moduleId, rule: `import-linter:${contract}:unresolved`,
      anchor: input.upper, value: 1,
      message: `${input.moduleId} is not allowed to import ${input.upper} (${contract})`,
      ...(input.line === undefined ? {} : { line: input.line }),
    });
    return;
  }
  assertInScope(file, ctx.paths);
  const undeclared = input.rule.endsWith(":undeclared");
  findings.add({ file, rule: input.rule, anchor: input.upper, value: 1,
    message: undeclared
      ? `${input.moduleId} is not declared in ${contract}`
      : `${input.moduleId} is not allowed to import ${input.upper} (${contract})`,
    ...(input.line === undefined ? {} : { line: input.line }),
  });
}

function parseBrokenLine(
  ctx: CheckContext, findings: FindingsBuilder, state: ParseState, line: string,
): boolean {
  if (state.broken.has(line)) {
    state.current = line;
    state.undeclared = false;
    state.pending = undefined;
    return true;
  }
  if (line === "The following modules are not listed as layers:") {
    if (!state.current) return false;
    state.undeclared = true;
    return true;
  }
  if (/^\(Since this contract is marked as 'exhaustive'.*\)$/u.test(line)) return true;
  return parseViolation(state, line) || addUndeclared(ctx, findings, state, line)
    || addChainViolation(ctx, findings, state, line) || CONTINUATION.test(line);
}

function parseLine(
  ctx: CheckContext, findings: FindingsBuilder, state: ParseState, line: string,
): void {
  if (line === "") return;
  if (isDecoration(line)) return;
  if (setSection(line, state)) return;
  if (state.section === "header" && parseHeaderLine(line, state)) return;
  if (state.section === "warnings" && /^- .*$/u.test(line)) return;
  if (state.section === "broken" && parseBrokenLine(ctx, findings, state, line)) return;
  return fail(`Unknown import-linter line: ${line}`);
}

function parseHeaderLine(line: string, state: ParseState): boolean {
  if (parseResult(line, state)) return true;
  return parseTotals(line, state);
}

function validateTotals(state: ParseState): void {
  if (!state.totals) return fail("Import-linter totals missing");
  if (state.pending) return fail(
    `Import-linter violation chain missing: ${state.pending.lower} -> ${state.pending.upper}`,
  );
  if (state.totals.kept !== state.keptCount || state.totals.broken !== state.brokenCount) {
    return fail(`Import-linter totals mismatch: expected ${state.keptCount} kept, ${state.brokenCount} broken`);
  }
}

export function importLinterFindings(ctx: CheckContext, stdout: string): ParsedFindings {
  const findings = new FindingsBuilder();
  const state = initialState();
  for (const line of stdout.split(/\r?\n/u)) parseLine(ctx, findings, state, line);
  validateTotals(state);
  return findings.build();
}

export const importLinterAdapter: CheckAdapter = {
  id: "python-architecture", check: "architecture", language: "python",
  tool: { bin: "lint-imports", version: "2.15" },
  applicability: (config) => config.architecture.python?.kind === "file"
    ? { kind: "run" } : { kind: "skip", reason: "no .importlinter" },
  configFiles: () => [],
  command: (ctx) => {
    const selection = ctx.config.architecture.python;
    if (selection?.kind !== "file") throw new Error("import-linter rules file is unavailable");
    const pythonPath = [...ctx.paths.map((path) => `${ctx.root}/${path}`), ctx.root].join(":");
    return pythonInvocation(ctx, {
      bin: "lint-imports",
      args: ["--config", selection.rulesFile, "--no-logo", "--no-cache"],
      cwd: ctx.root,
      env: { PYTHONPATH: pythonPath },
      exitCodes: [0, 1],
    });
  },
  parse: (ctx, result) => Promise.resolve(importLinterFindings(ctx, result.stdout)),
};
