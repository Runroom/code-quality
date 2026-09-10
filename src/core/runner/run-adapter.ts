import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ZodError } from "zod";

import { fail, QualityError } from "../errors.ts";
import { sortFindings, type Snapshot } from "../snapshot.ts";
import { artifactDir, writeArtifact } from "./artifacts.ts";
import { spawnTool } from "./spawn.ts";
import { withTempDir, writeGenerated } from "./temp.ts";
import { verifyTool } from "./verify.ts";
import type {
  Applicability,
  CheckAdapter,
  CheckContext,
  GeneratedFile,
  ToolResult,
} from "../types.ts";
import type { ResolvedConfig } from "../config/types.ts";
import type { AnchorService } from "../anchor/service.ts";

export interface RunDeps {
  spawn: typeof spawnTool;
  verify: typeof verifyTool;
  anchor: AnchorService;
  notice?: (message: string) => void;
  env?: NodeJS.ProcessEnv;
}

function requireApplicable(adapter: CheckAdapter, config: ResolvedConfig): void {
  const result: Applicability = adapter.applicability(config);
  if (result.kind === "error") return fail(result.message);
  if (result.kind === "skip") return fail(`${adapter.id}: ${result.reason}`);
}

interface ContextInput {
  adapter: CheckAdapter;
  config: ResolvedConfig;
  tempDir: string;
  artifacts: string;
  anchor: AnchorService;
  notice?: ((message: string) => void) | undefined;
}

function createContext(input: ContextInput): CheckContext {
  const { adapter, config, tempDir, artifacts, anchor } = input;
  const paths = config.paths[adapter.language] ?? [];
  const emitted = new Set<string>();
  return {
    root: config.root,
    config,
    language: adapter.language,
    paths,
    tempDir,
    artifactDir: artifacts,
    readSource: (relativeFile) => readFileSync(join(config.root, relativeFile), "utf8"),
    anchor,
    notice: (message) => {
      if (emitted.has(message)) return;
      emitted.add(message);
      input.notice?.(message);
    },
  };
}

function currentSnapshot(
  adapter: CheckAdapter,
  config: ResolvedConfig,
  findings: Snapshot["findings"],
): Snapshot {
  return {
    version: 1,
    tool: `${adapter.tool.bin}@${adapter.tool.version}`,
    configHash: config.configHash,
    findings: sortFindings(findings),
  };
}

function parseError(adapter: CheckAdapter, error: unknown): QualityError {
  if (error instanceof ZodError) {
    const issues = error.issues.slice(0, 3)
      .map((issue) => `${issue.path.join(".")} ${issue.message}`)
      .join("; ");
    return new QualityError(`${adapter.id}: unexpected native output: ${issues}`);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new QualityError(`${adapter.id}: ${message}`);
}

async function runInTemp(
  adapter: CheckAdapter,
  config: ResolvedConfig,
  deps: RunDeps,
  tempDir: string,
): Promise<Snapshot> {
  const artifacts = artifactDir(config.root, adapter.id);
  const context = createContext({
    adapter, config, tempDir, artifacts, anchor: deps.anchor, notice: deps.notice,
  });
  const generated: GeneratedFile[] = adapter.configFiles(context);
  writeGenerated(tempDir, generated);
  deps.verify(adapter.tool);
  const result: ToolResult = deps.spawn(adapter.command(context), config.root);
  writeArtifact(artifacts, "stdout.log", result.stdout);
  writeArtifact(artifacts, "stderr.log", result.stderr);
  let findings;
  try {
    findings = await adapter.parse(context, result);
  } catch (error) {
    throw parseError(adapter, error);
  }
  return currentSnapshot(adapter, config, findings);
}

export async function runAdapter(
  adapter: CheckAdapter,
  config: ResolvedConfig,
  deps: RunDeps,
): Promise<Snapshot> {
  requireApplicable(adapter, config);
  return withTempDir((tempDir) => runInTemp(adapter, config, deps, tempDir));
}
