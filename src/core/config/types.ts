import type { Language, LogicalCheckId } from "./schema.ts";

export type ArchitectureSelection =
  | { kind: "file"; rulesFile: string }
  | { kind: "skip" }
  | { kind: "missing"; rulesFile: string };

export interface ResolvedConfig {
  root: string;
  isDrupal: boolean;
  languages: Language[];
  paths: Partial<Record<Language, string[]>>;
  exclude: string[];
  disabled: Array<{ id: LogicalCheckId; reason: string }>;
  architecture: Partial<Record<Language, ArchitectureSelection>>;
  notices: string[];
  configHash: string;
}
