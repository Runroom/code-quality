import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { loadConfig } from "../src/core/config/load.ts";
import { ADAPTERS } from "../src/registry.ts";
import type { CheckAdapter, CheckContext, ToolInvocation } from "../src/core/types.ts";

function usage(): never {
  throw new Error("Usage: node scripts/capture-native.ts <adapterId> <fixtureDir>");
}

function findAdapter(id: string): CheckAdapter {
  const adapter = ADAPTERS.find((candidate) => candidate.id === id);
  if (!adapter) throw new Error(`Unknown adapter '${id}'`);
  return adapter;
}

function writeConfigs(root: string, files: ReturnType<CheckAdapter["configFiles"]>): void {
  for (const file of files) {
    const target = join(root, ".code-quality-tmp", file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, "utf8");
  }
}

function dockerArgs(root: string, invocation: ToolInvocation, image: string): string[] {
  const environment = Object.entries(invocation.env ?? {}).flatMap(([key, value]) => [
    "-e", `${key}=${value}`,
  ]);
  return [
    "run", "--rm", "-v", `${root}:/work`, "-w", "/work", "-e", "CI=true",
    ...environment, "--entrypoint", invocation.bin, image, ...invocation.args,
  ];
}

function accepted(invocation: ToolInvocation, exitCode: number): boolean {
  return invocation.exitCodes === "any" || invocation.exitCodes.includes(exitCode);
}

function hostArtifact(root: string, file: string): string {
  if (!isAbsolute(file) || !file.startsWith("/work/")) {
    throw new Error(`Artifact output must be under /work: ${file}`);
  }
  return join(root, file.slice("/work/".length));
}

function saveOutputs(
  root: string,
  outputDir: string,
  adapter: CheckAdapter,
  context: CheckContext,
): void {
  for (const file of adapter.artifactOutputs?.(context) ?? []) {
    copyFileSync(hostArtifact(root, file), join(outputDir, basename(file)));
  }
}

function clearOutputs(root: string, adapter: CheckAdapter, context: CheckContext): void {
  for (const file of adapter.artifactOutputs?.(context) ?? []) {
    rmSync(hostArtifact(root, file), { force: true });
  }
}

function stdoutExtension(stdout: string): "json" | "txt" {
  try {
    JSON.parse(stdout);
    return "json";
  } catch {
    return "txt";
  }
}

interface CaptureInput {
  adapterId: string;
  fixtureDir: string;
}

function captureInput(args: string[]): CaptureInput {
  const [adapterId, fixtureDir, ...extra] = args;
  if (!adapterId || !fixtureDir || extra.length > 0) return usage();
  return { adapterId, fixtureDir };
}

function runDocker(
  root: string,
  invocation: ToolInvocation,
  image: string,
): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync("docker", dockerArgs(root, invocation, image), {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

function main(): void {
  const input = captureInput(process.argv.slice(2));
  const root = resolve(input.fixtureDir);
  const adapter = findAdapter(input.adapterId);
  const config = loadConfig(root);
  const context: CheckContext = {
    root: "/work",
    config: { ...config, root: "/work" },
    language: adapter.language,
    paths: config.paths[adapter.language] ?? [],
    tempDir: "/work/.code-quality-tmp",
    artifactDir: `/work/artifacts/quality/${adapter.id}`,
    readSource: (file) => readFileSync(join(root, file), "utf8"),
    anchor: { anchor: async () => "/" },
  };
  rmSync(join(root, ".code-quality-tmp"), { recursive: true, force: true });
  mkdirSync(join(root, "artifacts", "quality", adapter.id), { recursive: true });
  clearOutputs(root, adapter, context);
  writeConfigs(root, adapter.configFiles(context));
  const invocation = adapter.command(context);
  const image = process.env.CODE_QUALITY_IMAGE ?? "code-quality:dev";
  const result = runDocker(root, invocation, image);
  if (!accepted(invocation, result.exitCode)) {
    throw new Error(`${adapter.id} exited with ${result.exitCode}: ${result.stderr}`);
  }
  const outputDir = join(process.cwd(), "tests", "fixtures", "native", adapter.id);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    join(outputDir, `stdout.${stdoutExtension(result.stdout)}`),
    result.stdout,
    "utf8",
  );
  saveOutputs(root, outputDir, adapter, context);
}

main();
