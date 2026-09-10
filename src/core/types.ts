import type { AnchorService } from "./anchor/service.ts";
import type { ResolvedConfig } from "./config/types.ts";
import type { Language, LogicalCheckId } from "./config/schema.ts";

export type Findings = Readonly<Record<string, number>>;

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
  parse(ctx: CheckContext, result: ToolResult): Promise<Findings>;
}

export const baselineFile = (adapter: CheckAdapter): string =>
  `quality/${adapter.id}-baseline.json`;
