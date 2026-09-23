import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { z } from "zod";

import { PAYLOAD_NEXT_CONFIGS } from "../../core/config/detect.ts";
import type { ResolvedConfig } from "../../core/config/types.ts";
import { ownerOf, workspaceMemberDirectories } from "../../core/config/workspaces.ts";
import type { Applicability } from "../../core/types.ts";
import {
  assertInScope,
  excludeGlobs,
  fail,
  FindingsBuilder,
  lineColumnToByteOffset,
  parseJsonOutput,
  relativize,
} from "../shared/kit.ts";
import type { CheckAdapter, CheckContext, GeneratedFile, ParsedFindings } from "../shared/kit.ts";
import { KNIP_PLUGIN_NAMES } from "./knip-plugins.ts";

const itemSchema = z.looseObject({
  name: z.string(),
  line: z.number().int().positive().optional(),
  col: z.number().int().positive().optional(),
});
const issueSchema = z.object({
  file: z.string(),
  files: z.array(itemSchema).optional(),
  exports: z.array(itemSchema).optional(),
  types: z.array(itemSchema).optional(),
  dependencies: z.array(itemSchema).optional(),
  devDependencies: z.array(itemSchema).optional(),
}).catchall(z.unknown());
const knipSchema = z.looseObject({ issues: z.array(issueSchema) });
const KNOWN_TYPES = new Set(["file", "files", "exports", "types", "dependencies", "devDependencies"]);
const NON_ISSUE_TYPES = new Set(["owners", "ignored", "catalog"]);
const TEST_ENTRIES = [
  "tests/**/*.{ts,tsx,js,mjs,cjs}",
  "test/**/*.{ts,tsx,js,mjs,cjs}",
  "**/__tests__/**/*.{ts,tsx,js,mjs,cjs}",
  "**/*.{test,spec}.{ts,tsx,js,mjs,cjs}",
];
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;
const NEXT_APP_ENTRIES = [
  "page", "layout", "template", "loading", "error", "global-error", "not-found", "global-not-found",
  "default", "route",
  "icon", "apple-icon", "opengraph-image", "twitter-image", "sitemap", "robots", "manifest", "forbidden",
  "unauthorized",
] as const;

const PLUGIN_FLAGS = Object.fromEntries(KNIP_PLUGIN_NAMES.map((plugin) => [plugin, false]));

const FRAMEWORK_CONFIGS = [
  ...PAYLOAD_NEXT_CONFIGS,
  "vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs",
  "vitest.config.ts", "vitest.config.js", "vitest.config.mts", "vitest.config.mjs",
  "playwright.config.ts", "playwright.config.js", "playwright.config.mts", "playwright.config.mjs",
] as const;

interface FrameworkDetection {
  configs: string[];
  nextLike: boolean;
}

interface WorkspaceConfig {
  entry: string[];
  project: string[];
  ignore: string[];
}

function isFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function packageRecord(packageFile: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(packageFile, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function declaresDependencies(packageFile: string): boolean {
  const packageJson = packageRecord(packageFile);
  if (packageJson === undefined) return false;
  return DEPENDENCY_FIELDS.some((field) => {
    const entries = packageJson[field];
    return typeof entries === "object"
      && entries !== null
      && !Array.isArray(entries)
      && Object.keys(entries).length > 0;
  });
}

function declaresDependency(root: string, name: string): boolean {
  const packageFile = join(root, "package.json");
  if (!existsSync(packageFile)) return false;
  const packageJson = packageRecord(packageFile);
  if (packageJson === undefined) return false;
  return DEPENDENCY_FIELDS.some((field) => {
    const dependencies = packageJson[field];
    return typeof dependencies === "object" && dependencies !== null
      && !Array.isArray(dependencies) && Object.hasOwn(dependencies, name);
  });
}

function executionOwner(root: string, paths: readonly string[]): string | null {
  if (isFile(join(root, "package.json"))) return ".";
  const owners = new Set(paths.map((path) => ownerOf(root, path)));
  if (owners.size !== 1) return null;
  const owner = [...owners][0];
  if (owner !== undefined && !safeWorkspaceName(owner)) {
    return fail(`ts-unused: unsafe workspace owner ${owner}`);
  }
  return owner ?? null;
}

function requireNodeModules(config: ResolvedConfig): Applicability {
  const owner = executionOwner(config.root, config.paths.ts ?? []);
  if (owner === null) {
    return {
      kind: "skip",
      reason: "ts-unused needs a root package.json when TypeScript spans several packages",
    };
  }
  const packageRoot = owner === "." ? config.root : join(config.root, owner);
  const packageFile = join(packageRoot, "package.json");
  if (existsSync(join(packageRoot, "node_modules")) || !declaresDependencies(packageFile)) {
    return { kind: "run" };
  }
  return {
    kind: "error",
    message: "ts-unused (knip) needs installed dependencies: run your package manager install "
      + "(workflow input `setup: pnpm install --frozen-lockfile` or npm ci) and retry.",
  };
}

function prefix(base: string, pattern: string): string {
  return base === "." ? pattern : `${base}/${pattern}`;
}

function sourceEntries(paths: readonly string[]): string[] {
  return paths.flatMap((path) => [
    prefix(path, "**/{index,main,cli}.{ts,tsx,js,mjs,cjs}"),
    prefix(path, "**/bin/**/*.{ts,js,mjs,cjs}"),
  ]);
}

function projectEntries(paths: readonly string[]): string[] {
  return paths.map((path) => prefix(path, "**/*.{ts,tsx,js,jsx,mjs,cjs}"));
}

function detectFrameworks(root: string): FrameworkDetection {
  if (!isDirectory(root)) return { configs: [], nextLike: false };
  const configs = FRAMEWORK_CONFIGS.filter((file) => isFile(join(root, file)));
  const nextLike = configs.some((file) =>
    file.startsWith("next.config.") || file.includes("payload.config.")
  );
  return { configs, nextLike };
}

function nextEntries(root: string, paths: readonly string[]): string[] {
  const entries: string[] = [];
  for (const base of new Set([".", ...paths])) {
    if (isDirectory(join(root, base, "app"))) {
      entries.push(prefix(
        base,
        `app/**/{${NEXT_APP_ENTRIES.join(",")}}.{ts,tsx,js,jsx}`,
      ));
    }
    if (isDirectory(join(root, base, "pages"))) {
      entries.push(prefix(base, "pages/**/*.{ts,tsx,js,jsx}"));
    }
    for (const file of ["middleware", "instrumentation", "proxy", "instrumentation-client"]) {
      if (["ts", "js"].some((extension) => isFile(join(root, base, `${file}.${extension}`)))) {
        entries.push(prefix(base, `${file}.{ts,js}`));
      }
    }
  }
  return entries;
}

function frameworkEntries(
  root: string,
  paths: readonly string[],
  detection: FrameworkDetection,
): string[] {
  const applications = detection.nextLike ? nextEntries(root, paths) : [];
  const internationalization = detection.nextLike && declaresDependency(root, "next-intl")
    ? ["i18n/request.{ts,tsx,js,jsx}", "src/i18n/request.{ts,tsx,js,jsx}"]
    : [];
  return [...detection.configs, ...applications, ...internationalization];
}

function relativeToOwner(path: string, owner: string): string {
  if (owner === ".") return path;
  if (path === owner) return ".";
  return path.slice(owner.length + 1);
}

function workspaceIgnore(patterns: readonly string[], owner: string): string[] {
  return patterns.flatMap((pattern) => {
    if (pattern.startsWith("**/") || owner === ".") return [pattern];
    const ownerPrefix = `${owner}/`;
    return pattern.startsWith(ownerPrefix) ? [pattern.slice(ownerPrefix.length)] : [];
  });
}

function workspaceFrameworkEntries(root: string, owner: string, paths: readonly string[]): string[] {
  const ownerRoot = owner === "." ? root : join(root, owner);
  return frameworkEntries(ownerRoot, paths, detectFrameworks(ownerRoot));
}

function workspaceBlock(
  ctx: CheckContext,
  owner: string,
  paths: readonly string[],
): WorkspaceConfig {
  const entries = workspaceFrameworkEntries(ctx.root, owner, paths);
  return {
    entry: [...sourceEntries(paths), ...entries, ...TEST_ENTRIES],
    project: [...projectEntries(paths), ...entries, ...TEST_ENTRIES],
    ignore: workspaceIgnore(excludeGlobs(ctx.config, true), owner),
  };
}

function safeWorkspaceName(name: string): boolean {
  return name === "." || name.split("/").every((segment) => /^[A-Za-z0-9._@-]+$/u.test(segment));
}

function groupedPaths(ctx: CheckContext): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const path of ctx.paths) {
    const owner = ownerOf(ctx.root, path);
    if (!safeWorkspaceName(owner)) return fail(`ts-unused: unsafe workspace owner ${owner}`);
    const paths = groups.get(owner) ?? [];
    paths.push(relativeToOwner(path, owner));
    groups.set(owner, paths);
  }
  return groups;
}

function flatConfig(ctx: CheckContext, owner: string): string {
  const root = owner === "." ? ctx.root : join(ctx.root, owner);
  const paths = ctx.paths.map((path) => relativeToOwner(path, owner));
  const frameworks = frameworkEntries(root, paths, detectFrameworks(root));
  return JSON.stringify({
    entry: [...sourceEntries(paths), ...frameworks, ...TEST_ENTRIES],
    project: [...projectEntries(paths), ...frameworks, ...TEST_ENTRIES],
    ignore: workspaceIgnore(excludeGlobs(ctx.config, true), owner),
    ...PLUGIN_FLAGS,
  }, null, 2);
}

function knipConfig(ctx: CheckContext): string {
  const owner = executionOwner(ctx.root, ctx.paths);
  if (owner !== null && owner !== ".") return flatConfig(ctx, owner);
  const members = workspaceMemberDirectories(ctx.root);
  const groups = groupedPaths(ctx);
  const workspaceMode = members.length > 0
    || [...groups.keys()].some((candidateOwner) => candidateOwner !== ".");
  if (!workspaceMode) {
    const frameworks = frameworkEntries(ctx.root, ctx.paths, detectFrameworks(ctx.root));
    return JSON.stringify({
      entry: [...sourceEntries(ctx.paths), ...frameworks, ...TEST_ENTRIES],
      project: [...projectEntries(ctx.paths), ...frameworks, ...TEST_ENTRIES],
      ignore: excludeGlobs(ctx.config, true),
      ...PLUGIN_FLAGS,
    }, null, 2);
  }
  const workspaceGroups = new Map<string, string[]>([[".", groups.get(".") ?? []]]);
  for (const [groupOwner, paths] of groups) workspaceGroups.set(groupOwner, paths);
  const workspaces = Object.fromEntries([...workspaceGroups].map(([groupOwner, paths]) => [
    groupOwner, workspaceBlock(ctx, groupOwner, paths),
  ]));
  const ignoredMembers = members.filter((member) => !groups.has(member)).filter((member) => {
    if (safeWorkspaceName(member)) return true;
    ctx.notice(`ts-unused: ignored unsafe workspace member ${member}`);
    return false;
  });
  return JSON.stringify({
    workspaces,
    ignoreWorkspaces: ignoredMembers,
    ...PLUGIN_FLAGS,
  }, null, 2);
}

function reportedFile(ctx: CheckContext, file: string): string {
  const owner = executionOwner(ctx.root, ctx.paths);
  const nested = owner !== null && owner !== ".";
  const candidate = nested && !isAbsolute(file)
    ? `${owner}/${file}`
    : file;
  return relativize(ctx.root, candidate);
}

function knipConfigFile(ctx: CheckContext): GeneratedFile {
  return { path: "knip.json", content: knipConfig(ctx) };
}

function rejectUnknown(issue: z.infer<typeof issueSchema>): void {
  for (const [type, entries] of Object.entries(issue)) {
    if (!KNOWN_TYPES.has(type) && !NON_ISSUE_TYPES.has(type)
      && (!Array.isArray(entries) || entries.length > 0)) {
      return fail(`Unknown knip issue type ${type} in ${issue.file}`);
    }
  }
}

function optionalLocation(item: z.infer<typeof itemSchema>): { line?: number; column?: number } {
  return {
    ...(item.line === undefined ? {} : { line: item.line }),
    ...(item.col === undefined ? {} : { column: item.col }),
  };
}

async function exportAnchor(
  ctx: CheckContext,
  file: string,
  item: z.infer<typeof itemSchema>,
): Promise<string> {
  if (item.line === undefined || item.col === undefined) return "/";
  const source = ctx.readSource(file);
  const offset = lineColumnToByteOffset(source, item.line, item.col);
  try {
    return await ctx.anchor.anchor(file, source, offset, false);
  } catch (error) {
    if (error instanceof Error && error.message.includes("cannot identify diagnostic anchor")) {
      return "/";
    }
    throw error;
  }
}

function addFiles(ctx: CheckContext, issue: z.infer<typeof issueSchema>, out: FindingsBuilder): void {
  for (const item of issue.files ?? []) {
    const file = reportedFile(ctx, item.name);
    assertInScope(file, ctx.paths);
    out.add({ file, rule: "unused-file", anchor: file, value: 1,
      ...optionalLocation(item),
      message: "unused file",
    });
  }
}

async function addExports(
  ctx: CheckContext,
  issue: z.infer<typeof issueSchema>,
  out: FindingsBuilder,
): Promise<void> {
  const file = reportedFile(ctx, issue.file);
  for (const item of [...(issue.exports ?? []), ...(issue.types ?? [])]) {
    assertInScope(file, ctx.paths);
    const anchor = await exportAnchor(ctx, file, item);
    out.add({ file, rule: "unused-export", anchor: `${anchor}#${item.name}`, value: 1,
      ...optionalLocation(item),
      message: `unused export '${item.name}'`,
    });
  }
}

function addDependencies(
  ctx: CheckContext,
  issue: z.infer<typeof issueSchema>,
  out: FindingsBuilder,
): void {
  for (const item of [...(issue.dependencies ?? []), ...(issue.devDependencies ?? [])]) {
    const file = reportedFile(ctx, issue.file);
    assertInScope(file, [], ["package.json", "**/package.json"]);
    out.add({ file, rule: "unused-dependency", anchor: item.name, value: 1,
      ...optionalLocation(item),
      message: `unused dependency '${item.name}'`,
    });
  }
}

export async function knipFindings(ctx: CheckContext, input: unknown): Promise<ParsedFindings> {
  const report = knipSchema.parse(input);
  const findings = new FindingsBuilder();
  for (const issue of report.issues) {
    rejectUnknown(issue);
    addFiles(ctx, issue, findings);
    await addExports(ctx, issue, findings);
    addDependencies(ctx, issue, findings);
  }
  return findings.build();
}

export const knipAdapter: CheckAdapter = {
  id: "ts-unused",
  check: "unused",
  language: "ts",
  tool: { bin: "knip", version: "6.35.1" },
  applicability: requireNodeModules,
  configFiles: (ctx) => [knipConfigFile(ctx)],
  command: (ctx) => {
    const owner = executionOwner(ctx.root, ctx.paths);
    return {
      bin: "knip",
      args: [
        "--config", join(ctx.tempDir, "knip.json"), "--reporter", "json",
        "--include", "files,dependencies,devDependencies,exports,types",
        "--no-progress", "--no-config-hints",
      ],
      ...(owner === null || owner === "." ? {} : { cwd: join(ctx.root, owner) }),
      exitCodes: [0, 1],
    };
  },
  parse: (ctx, result) => knipFindings(
    ctx,
    parseJsonOutput(result.stdout, "knip", result.stderr),
  ),
};
