import type { AnchorService } from "./anchor/service.ts";
import type { ResolvedConfig } from "./config/types.ts";
import type { Language, LogicalCheckId } from "./config/schema.ts";

export type Findings = Readonly<Record<string, number>>;

export interface FindingDetail {
  file: string;
  rule: string;
  anchor: string;
  value: number;
  line?: number;
  column?: number;
  message?: string;
  // Retained for future structured output; plain-text rendering uses the native message.
  threshold?: number;
}

export function buildFindingKey(input: Pick<FindingDetail, "file" | "rule" | "anchor">): string {
  return `${input.file} | ${input.rule} | ${input.anchor}`;
}

export function parseFindingKey(
  key: string,
): Pick<FindingDetail, "file" | "rule" | "anchor"> | undefined {
  const first = key.indexOf(" | ");
  if (first < 0) return undefined;
  const second = key.indexOf(" | ", first + 3);
  if (second < 0) return undefined;
  return {
    file: key.slice(0, first),
    rule: key.slice(first + 3, second),
    anchor: key.slice(second + 3),
  };
}

export type FindingDetails = Readonly<Record<string, FindingDetail>>;

export interface DuplicateDetail {
  file: string;
  line: number;
  endLine: number;
  secondFile: string;
  secondLine: number;
  secondEndLine: number;
  lines: number;
  tokens: number;
  isNew: boolean;
}

export interface ParsedFindings {
  findings: Findings;
  details: FindingDetails;
  duplicates?: DuplicateDetail[];
}

export type { Language, LogicalCheckId } from "./config/schema.ts";

export interface ToolPin {
  bin: string;
  version: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface ToolInvocation {
  bin: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  exitCodes: readonly number[] | "any";
}

export interface ToolResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CheckContext {
  root: string;
  config: ResolvedConfig;
  language: Language;
  paths: string[];
  tempDir: string;
  artifactDir: string;
  readSource(relativeFile: string): string;
  anchor: AnchorService;
  notice(message: string): void;
}

export type Applicability =
  | { kind: "run" }
  | { kind: "skip"; reason: string }
  | { kind: "error"; message: string };

export interface CheckAdapter {
  id: string;
  check: LogicalCheckId;
  language: Language;
  tool: ToolPin;
  applicability(config: ResolvedConfig): Applicability;
  configFiles(ctx: CheckContext): GeneratedFile[];
  command(ctx: CheckContext): ToolInvocation;
  artifactOutputs?(ctx: CheckContext): string[];
  parse(ctx: CheckContext, result: ToolResult): Promise<ParsedFindings>;
}

export const baselineFile = (adapter: CheckAdapter | string): string =>
  `quality/${typeof adapter === "string" ? adapter : adapter.id}-baseline.json`;
