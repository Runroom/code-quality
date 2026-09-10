import { addAnchoredFinding, excludeGlobs, fail, FindingsBuilder, relativizeFrom } from "../shared/kit.ts";
import type { CheckAdapter, CheckContext, Findings } from "../shared/kit.ts";

const LINE = /^(?<file>[^:]+):(?<line>\d+): (?<message>unused (?<typ>attribute|class|function|import|method|property|variable) '(?<name>[^']+)'|unreachable code after '(?<stmt>[^']+)'|unsatisfiable '(?<cond>[^']+)' condition) \((?<confidence>\d+)% confidence\)$/u;

interface VultureFinding {
  file: string;
  line: number;
  category: string;
  identity: string;
}

function parseLine(line: string): VultureFinding {
  const match = LINE.exec(line);
  if (!match?.groups) return fail(`Unknown vulture line: ${line}`);
  const identity = match.groups.name ?? match.groups.stmt ?? match.groups.cond;
  if (!identity) return fail(`Unknown vulture line: ${line}`);
  const category = match.groups.typ ?? (match.groups.stmt
    ? "unreachable_code" : "unsatisfiable_condition");
  return { file: match.groups.file!, line: Number(match.groups.line), category, identity };
}

async function addFinding(
  ctx: CheckContext,
  findings: FindingsBuilder,
  item: VultureFinding,
): Promise<void> {
  const file = relativizeFrom(ctx.root, item.file);
  await addAnchoredFinding(ctx, findings, {
    file, rule: `vulture-${item.category}`, value: 1, line: item.line,
    blockMode: false, fallbackAnchor: "/", anchorSuffix: `#${item.identity}`,
  });
}

export async function vultureFindings(ctx: CheckContext, stdout: string): Promise<Findings> {
  const findings = new FindingsBuilder();
  for (const line of stdout.split(/\r?\n/u).filter((value) => value.length > 0)) {
    await addFinding(ctx, findings, parseLine(line));
  }
  return findings.build();
}

export const vultureAdapter: CheckAdapter = {
  id: "python-unused-vulture", check: "unused", language: "python",
  tool: { bin: "vulture", version: "2.16" },
  applicability: () => ({ kind: "run" }),
  configFiles: () => [],
  command: (ctx) => ({
    bin: "vulture",
    args: [...ctx.paths, "--exclude", excludeGlobs(ctx.config, false).join(","),
      "--min-confidence", "0"],
    exitCodes: [0, 3],
  }),
  parse: (ctx, result) => vultureFindings(ctx, result.stdout),
};
