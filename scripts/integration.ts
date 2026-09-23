import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  expect?: string;
  exitCode?: 0 | 1;
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
    fixture: "drupal-project",
    file: "web/modules/custom/demo/demo.module",
    append: `
function demo_complex(int $a, int $b, int $c, int $d, int $e): int
{
    $result = 0;
    if ($a > 0) {
        $result += $a;
        if ($b > 0) {
            $result += $b;
            if ($c > 0) {
                $result += $c;
                if ($d > 0) {
                    $result += $d;
                    if ($e > 0) {
                        $result += $e;
                    }
                }
            }
        }
    }
    if ($a > $b) $result += 1;
    if ($b > $c) $result += 2;
    if ($c > $d) $result += 3;
    if ($d > $e) $result += 4;
    if ($e > $a) $result += 5;
    if ($a === $e) $result += 6;
    return $result;
}
`,
    expect: "regressions",
  },
  {
    fixture: "drupal-project",
    file: "web/modules/custom/demo/demo_copy.module",
    copyFrom: "web/modules/custom/demo/demo.module",
    expect: "regressions",
  },
  {
    fixture: "payload-project",
    file: "src/payload-types.ts",
    content: `
export function generatedComplex(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
): number {
  let result = 0;
  if (a > 0) {
    result += a;
    if (b > 0) {
      result += b;
      if (c > 0) {
        result += c;
        if (d > 0) {
          result += d;
          if (e > 0) result += e;
        }
      }
    }
  }
  if (a > b) result += 1;
  if (b > c) result += 2;
  if (c > d) result += 3;
  if (d > e) result += 4;
  if (e > a) result += 5;
  if (a === e) result += 6;
  return result;
}
`,
    expect: "regressions",
    exitCode: 0,
  },
  {
    fixture: "monorepo-project",
    file: "packages/core/src/orphan.ts",
    content: "export function orphan(): string { return \"orphan\"; }\n",
    expect: "regressions",
  },
  {
    fixture: "python-project",
    file: "src/demo_app/extra.py",
    content: "def extra(a, b, c, d, e):\n    return [a, b, c, d, e]\n",
    expect: "regressions",
  },
  {
    fixture: "python314-project",
    file: "src/demo314/extra.py",
    content: `def extra(value: int) -> int:
    if value > 0:
        if value > 1:
            if value > 2:
                if value > 3:
                    if value > 4:
                        if value > 5:
                            if value > 6:
                                if value > 7:
                                    if value > 8:
                                        if value > 9:
                                            if value > 10:
                                                return value
    return 0
`,
    expect: "regressions",
  },
  {
    fixture: "web-project",
    file: "templates/page-c.twig",
    copyFrom: "templates/page-a.twig",
    expect: "regressions",
  },
] as const satisfies readonly Mutation[];

export interface ResultRow {
  label: string;
  exitCode: number;
  expectedExitCode: number;
  stderr: string;
  expectedStderr?: string;
  evidenceOk?: boolean;
}

interface DockerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface FixtureDependencyState {
  tsNodeModules: boolean;
  phpVendor: boolean;
  payloadNodeModules: boolean;
  monorepoNodeModules: boolean;
  python314Venv: boolean;
}

interface DependencyInstallPlan {
  fixture: "ts-project" | "php-project" | "payload-project" | "monorepo-project" | "python314-project";
  entrypoint: "npm" | "composer" | "corepack" | "uv";
  command: readonly string[];
}

const DEPENDENCY_INSTALLS = [
  {
    state: "tsNodeModules",
    fixture: "ts-project",
    entrypoint: "npm",
    command: ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
  },
  {
    state: "phpVendor",
    fixture: "php-project",
    entrypoint: "composer",
    command: ["install", "--no-interaction"],
  },
  {
    state: "payloadNodeModules",
    fixture: "payload-project",
    entrypoint: "npm",
    command: ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
  },
  {
    state: "monorepoNodeModules",
    fixture: "monorepo-project",
    entrypoint: "corepack",
    command: ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"],
  },
  {
    state: "python314Venv",
    fixture: "python314-project",
    entrypoint: "uv",
    command: ["sync", "--frozen"],
  },
] as const satisfies readonly (DependencyInstallPlan & { state: keyof FixtureDependencyState })[];

const FIXTURES = [
  "ts-project", "php-project", "python-project", "python314-project", "web-project",
  "drupal-project", "payload-project", "monorepo-project",
] as const;
// web-project selects no advisory report.
const REPORT_FIXTURES = ["ts-project", "php-project", "python-project"] as const;
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

export function copyFixture(
  sourceRoot: string,
  destinationRoot: string,
  dereferenceDependencies = false,
): void {
  mkdirSync(destinationRoot, { recursive: true });
  for (const entry of readdirSync(sourceRoot)) {
    if (!shouldCopyFixturePath(entry)) continue;
    cpSync(join(sourceRoot, entry), join(destinationRoot, entry), {
      recursive: true,
      dereference: dereferenceDependencies,
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

export function mutationEvidenceOk(mutation: Mutation, stderr: string): boolean {
  const expected = mutation.expect ?? "regressions";
  return (mutation.exitCode ?? 1) === 1 ? stderr.includes(expected) : !stderr.includes(expected);
}

function hostUserArgs(): string[] {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  return uid === undefined || gid === undefined ? [] : ["--user", `${uid}:${gid}`];
}

export function dockerArgs(
  image: string,
  command: readonly string[],
  mountRoot?: string,
  entrypoint?: "npm" | "composer" | "corepack" | "uv",
): string[] {
  const mountArgs = mountRoot === undefined
    ? []
    : ["-v", `${mountRoot}:/work`, "-w", "/work"];
  // Installers run as the host user, who has no home inside the image.
  const entrypointArgs = entrypoint === undefined
    ? []
    : [
      "-e", "HOME=/tmp",
      "-e", "COMPOSER_HOME=/tmp/composer",
      "-e", "UV_CACHE_DIR=/tmp/uv-cache",
      "--entrypoint", entrypoint,
    ];
  return [
    "run", "--rm", "-e", "GITHUB_ACTIONS=true", ...hostUserArgs(), ...mountArgs,
    ...entrypointArgs, image, ...command,
  ];
}

export function plannedDependencyInstalls(
  state: FixtureDependencyState,
): DependencyInstallPlan[] {
  return DEPENDENCY_INSTALLS
    .filter((plan) => !state[plan.state])
    .map(({ state: _state, ...plan }) => plan);
}

function runDocker(
  image: string,
  command: readonly string[],
  mountRoot?: string,
  entrypoint?: "npm" | "composer" | "corepack" | "uv",
): DockerResult {
  const result = spawnSync("docker", dockerArgs(image, command, mountRoot, entrypoint), {
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
    (row.expectedStderr === undefined || row.stderr.includes(row.expectedStderr)) &&
    row.evidenceOk !== false;
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

function installMissingFixtureDependencies(repositoryRoot: string, image: string): void {
  const state: FixtureDependencyState = {
    tsNodeModules: existsSync(join(fixtureRoot(repositoryRoot, "ts-project"), "node_modules")),
    phpVendor: existsSync(join(fixtureRoot(repositoryRoot, "php-project"), "vendor")),
    payloadNodeModules: existsSync(join(fixtureRoot(repositoryRoot, "payload-project"), "node_modules")),
    monorepoNodeModules: existsSync(join(fixtureRoot(repositoryRoot, "monorepo-project"), "node_modules")),
    python314Venv: existsSync(join(fixtureRoot(repositoryRoot, "python314-project"), ".venv")),
  };
  for (const plan of plannedDependencyInstalls(state)) {
    const root = fixtureRoot(repositoryRoot, plan.fixture);
    const result = runDocker(image, plan.command, root, plan.entrypoint);
    if (result.exitCode !== 0) {
      throw new Error(`${plan.fixture} dependency install failed: ${result.stderr}`);
    }
  }
}

function temporaryFixture(repositoryRoot: string, fixture: string): string {
  const sourceRoot = fixtureRoot(repositoryRoot, fixture);
  const destinationRoot = mkdtempSync(join(tmpdir(), "code-quality-integration-"));
  chmodSync(destinationRoot, 0o755);
  copyFixture(
    sourceRoot,
    destinationRoot,
    fixture !== "python-project" && fixture !== "python314-project",
  );
  return destinationRoot;
}

function fixtureReportRow(repositoryRoot: string, image: string, fixture: string): ResultRow {
  const root = temporaryFixture(repositoryRoot, fixture);
  try {
    return resultRow(`${fixture} report`, runDocker(image, ["report"], root), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function fixtureCoverageReportRow(repositoryRoot: string, image: string): ResultRow {
  const root = temporaryFixture(repositoryRoot, "ts-project");
  try {
    const coverageDirectory = join(root, "coverage");
    mkdirSync(coverageDirectory, { recursive: true });
    copyFileSync(
      join(repositoryRoot, "tests/fixtures/istanbul/ts-project.coverage-final.json"),
      join(coverageDirectory, "coverage-final.json"),
    );
    const result = runDocker(image, ["report", "--coverage", "coverage/coverage-final.json"], root);
    const report = JSON.parse(readFileSync(
      join(root, "artifacts/quality/fallow-health/fallow-health.json"),
      "utf8",
    )) as { summary?: { istanbul_files_matched?: number } };
    return {
      ...resultRow("ts-project report --coverage", result, 0),
      evidenceOk: (report.summary?.istanbul_files_matched ?? 0) >= 1,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function mutationRow(repositoryRoot: string, image: string, mutation: Mutation): ResultRow {
  const root = temporaryFixture(repositoryRoot, mutation.fixture);
  try {
    applyMutation(root, mutation);
    const result = runDocker(image, ["check"], root);
    const expectedExitCode = mutation.exitCode ?? 1;
    const expectedText = mutation.expect ?? "regressions";
    const row = resultRow(
      `${mutation.fixture} ${mutation.file}`,
      result,
      expectedExitCode,
      expectedExitCode === 1 ? expectedText : undefined,
    );
    return { ...row, evidenceOk: mutationEvidenceOk(mutation, result.stderr) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function integrationRows(repositoryRoot: string, image: string): ResultRow[] {
  const rows = smokeRows(image);
  installMissingFixtureDependencies(repositoryRoot, image);
  for (const fixture of FIXTURES) rows.push(fixtureCheckRow(repositoryRoot, image, fixture));
  for (const fixture of REPORT_FIXTURES) rows.push(fixtureReportRow(repositoryRoot, image, fixture));
  rows.push(fixtureCoverageReportRow(repositoryRoot, image));
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
