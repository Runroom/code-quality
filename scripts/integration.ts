import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Mutation {
  fixture: string;
  file: string;
  append?: string;
  copyFrom?: string;
  content?: string;
  expect: string;
}

export const MUTATIONS = [
  {
    fixture: "ts-project",
    file: "src/complexity.ts",
    append: "\nexport function extra(a:number,b:number,c:number,d:number,e:number){return [a,b,c,d,e];}\n",
    expect: "regressions",
  },
  {
    fixture: "ts-project",
    file: "src/dup-c.ts",
    copyFrom: "src/dup-a.ts",
    expect: "regressions",
  },
  {
    fixture: "ts-project",
    file: "src/orphan2.ts",
    content: "export const orphan2 = 1;\n",
    expect: "regressions",
  },
  {
    fixture: "ts-project",
    file: "src/ui/other.ts",
    content: "import '../db/repo.ts';\n",
    expect: "regressions",
  },
  {
    fixture: "php-project",
    file: "src/Service/Extra.php",
    content: "<?php\nnamespace App\\Service;\nclass Extra { public function f(int $a,int $b,int $c,int $d,int $e): array { return [$a,$b,$c,$d,$e]; } }\n",
    expect: "regressions",
  },
  {
    fixture: "python-project",
    file: "src/demo_app/extra.py",
    content: "def extra(a, b, c, d, e):\n    return [a, b, c, d, e]\n",
    expect: "regressions",
  },
] as const satisfies readonly Mutation[];

export interface ResultRow {
  label: string;
  exitCode: number;
  expectedExitCode: number;
  stderr: string;
  expectedStderr?: string;
}

interface DockerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const FIXTURES = ["ts-project", "php-project", "python-project"] as const;
const MAX_BUFFER = 256 * 1024 * 1024;

function normalizeRelative(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

export function shouldCopyFixturePath(path: string): boolean {
  const normalized = normalizeRelative(path);
  return normalized !== "artifacts" && !normalized.startsWith("artifacts/") &&
    normalized !== ".code-quality-tmp" && !normalized.startsWith(".code-quality-tmp/");
}

function copyFilter(sourceRoot: string, sourcePath: string): boolean {
  return shouldCopyFixturePath(relative(sourceRoot, sourcePath));
}

export function copyFixture(sourceRoot: string, destinationRoot: string, copyVendor = false): void {
  mkdirSync(destinationRoot, { recursive: true });
  for (const entry of readdirSync(sourceRoot)) {
    if (!shouldCopyFixturePath(entry)) continue;
    cpSync(join(sourceRoot, entry), join(destinationRoot, entry), {
      recursive: true,
      dereference: copyVendor,
      filter: (sourcePath) => copyFilter(sourceRoot, sourcePath),
    });
  }
}

function mutationTarget(root: string, mutation: Mutation): string {
  const target = join(root, mutation.file);
  mkdirSync(dirname(target), { recursive: true });
  return target;
}

function writeMutation(target: string, mutation: Mutation): void {
  if (mutation.content !== undefined) {
    writeFileSync(target, mutation.content, "utf8");
    return;
  }
  if (mutation.copyFrom !== undefined) {
    copyFileSync(mutation.copyFrom, target);
    return;
  }
  if (mutation.append !== undefined) {
    appendFileSync(target, mutation.append, "utf8");
    return;
  }
  throw new Error(`Mutation for ${mutation.file} has no operation`);
}

export function applyMutation(root: string, mutation: Mutation): void {
  const target = mutationTarget(root, mutation);
  const sourceMutation = mutation.copyFrom === undefined
    ? mutation
    : { ...mutation, copyFrom: join(root, mutation.copyFrom) };
  writeMutation(target, sourceMutation);
}

function hostUserArgs(): string[] {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  return uid === undefined || gid === undefined ? [] : ["--user", `${uid}:${gid}`];
}

export function dockerArgs(image: string, command: readonly string[], mountRoot?: string): string[] {
  const mountArgs = mountRoot === undefined
    ? []
    : ["-v", `${mountRoot}:/work`, "-w", "/work"];
  return [
    "run", "--rm", "-e", "GITHUB_ACTIONS=true", ...hostUserArgs(), ...mountArgs, image, ...command,
  ];
}

function runDocker(image: string, command: readonly string[], mountRoot?: string): DockerResult {
  const result = spawnSync("docker", dockerArgs(image, command, mountRoot), {
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  const error = result.error?.message;
  const stderr = [result.stderr ?? "", error ?? ""].filter(Boolean).join("\n");
  return {
    stdout: result.stdout ?? "",
    stderr,
    exitCode: result.status ?? 1,
  };
}

function resultRow(
  label: string,
  result: DockerResult,
  expectedExitCode: number,
  expectedStderr?: string,
): ResultRow {
  return {
    label,
    exitCode: result.exitCode,
    expectedExitCode,
    stderr: result.stderr,
    ...(expectedStderr === undefined ? {} : { expectedStderr }),
  };
}

function rowIsOk(row: ResultRow): boolean {
  return row.exitCode === row.expectedExitCode &&
    (row.expectedStderr === undefined || row.stderr.includes(row.expectedStderr));
}

export function formatResultRow(row: ResultRow): string {
  return `${row.label} | exit ${row.exitCode} | ${rowIsOk(row) ? "ok" : "FAIL"}`;
}

export function formatResultTable(rows: readonly ResultRow[]): string {
  return ["result | status", ...rows.map(formatResultRow)].join("\n");
}

function fixtureRoot(repositoryRoot: string, fixture: string): string {
  return join(repositoryRoot, "fixtures", fixture);
}

function smokeRows(image: string): ResultRow[] {
  return [
    resultRow("versions", runDocker(image, ["versions"]), 0),
    resultRow("doctor", runDocker(image, ["doctor"]), 0),
  ];
}

function fixtureCheckRow(repositoryRoot: string, image: string, fixture: string): ResultRow {
  const root = fixtureRoot(repositoryRoot, fixture);
  return resultRow(`${fixture} check`, runDocker(image, ["check"], root), 0);
}

function temporaryFixture(repositoryRoot: string, mutation: Mutation): string {
  const sourceRoot = fixtureRoot(repositoryRoot, mutation.fixture);
  const destinationRoot = mkdtempSync(join(tmpdir(), "code-quality-integration-"));
  chmodSync(destinationRoot, 0o755);
  copyFixture(sourceRoot, destinationRoot, mutation.fixture === "php-project");
  return destinationRoot;
}

function mutationRow(repositoryRoot: string, image: string, mutation: Mutation): ResultRow {
  const root = temporaryFixture(repositoryRoot, mutation);
  try {
    applyMutation(root, mutation);
    const result = runDocker(image, ["check"], root);
    return resultRow(`${mutation.fixture} ${mutation.file}`, result, 1, mutation.expect);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function integrationRows(repositoryRoot: string, image: string): ResultRow[] {
  const rows = smokeRows(image);
  for (const fixture of FIXTURES) rows.push(fixtureCheckRow(repositoryRoot, image, fixture));
  for (const mutation of MUTATIONS) rows.push(mutationRow(repositoryRoot, image, mutation));
  return rows;
}

function invokedDirectly(): boolean {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

function main(): void {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const image = process.env.CODE_QUALITY_IMAGE ?? "code-quality:dev";
  const rows = integrationRows(repositoryRoot, image);
  console.log(formatResultTable(rows));
  process.exitCode = rows.every(rowIsOk) ? 0 : 1;
}

if (invokedDirectly()) main();
