import { spawnTool } from "../../src/core/runner/spawn.ts";
import type { RunDeps } from "../../src/core/runner/run-adapter.ts";
import type {
  Applicability,
  CheckAdapter,
  FindingDetails,
  Findings,
  Language,
  LogicalCheckId,
} from "../../src/core/types.ts";

interface FakeAdapterOptions {
  id: string;
  findings?: Findings;
  details?: FindingDetails;
  exitCode?: number;
  language?: Language;
  check?: LogicalCheckId;
  applicability?: () => Applicability;
}

function languageFor(id: string): Language {
  if (id.startsWith("php-")) return "php";
  if (id.startsWith("python-")) return "python";
  return "ts";
}

function checkFor(id: string): LogicalCheckId {
  if (id.includes("cognitive")) return "cognitive";
  if (id.includes("duplication")) return "duplication";
  if (id.includes("unused")) return "unused";
  if (id.includes("architecture")) return "architecture";
  return "complexity";
}

export function fakeAdapter(options: FakeAdapterOptions): CheckAdapter {
  const language = options.language ?? languageFor(options.id);
  const check = options.check ?? checkFor(options.id);
  const exitCode = options.exitCode ?? 0;
  const output = JSON.stringify(options.findings ?? {});
  const details = options.details ?? {};
  return {
    id: options.id,
    check,
    language,
    tool: { bin: "node", version: "0.0.0" },
    applicability: options.applicability ?? (() => ({ kind: "run" })),
    configFiles: () => [],
    command: () => ({
      bin: "node",
      args: ["-e", `process.stdout.write(JSON.stringify(${output}))`],
      exitCodes: [exitCode],
    }),
    parse: async (_ctx, result) => ({
      findings: JSON.parse(result.stdout) as Findings,
      details,
    }),
  };
}

export function fakeDeps(): RunDeps {
  return {
    spawn: spawnTool,
    verify: () => {},
    anchor: { anchor: async () => "" },
  };
}
