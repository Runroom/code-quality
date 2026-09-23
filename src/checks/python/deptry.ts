import { closeSync, lstatSync, openSync, readFileSync, readSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";

import { z } from "zod";
import { parse as parseToml } from "smol-toml";

import { assertInScope, excludeGlobs, FindingsBuilder, relativizeFrom, toolOutput } from "../shared/kit.ts";
import type { CheckAdapter, CheckContext, ParsedFindings } from "../shared/kit.ts";
import { pythonInvocation } from "./interpreter.ts";
import { readRecord } from "../../core/config/workspaces.ts";

const reportSchema = z.array(z.looseObject({
  error: z.looseObject({
    code: z.enum(["DEP001", "DEP002", "DEP003", "DEP004", "DEP005"]),
    message: z.string(),
  }),
  module: z.string(),
  location: z.looseObject({
    file: z.string(),
    line: z.number().int().positive().nullable(),
    column: z.number().int().nullable(),
  }),
}));

const MAX_PACKAGE_METADATA_SIZE = 1024 * 1024;
const MAX_METADATA_HEADER_SIZE = 64 * 1024;
const MAX_DISTRIBUTIONS = 2000;
const MODULE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const PACKAGE_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u;

function escapeCharacter(character: string): string {
  return /[\\.^$+{}()|[\]]/u.test(character) ? `\\${character}` : character;
}

function globSegmentRegex(segment: string): string {
  let result = "";
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index]!;
    if (character === "*") result += "[^/]*";
    else if (character === "?") result += "[^/]";
    else if (character === "{" && segment.indexOf("}", index + 1) > index) {
      const end = segment.indexOf("}", index + 1);
      const choices = segment.slice(index + 1, end).split(",").map((choice) =>
        [...choice].map(escapeCharacter).join(""));
      result += `(?:${choices.join("|")})`;
      index = end;
    } else if (character === "[" && segment.indexOf("]", index + 1) > index) {
      const end = segment.indexOf("]", index + 1);
      result += segment.slice(index, end + 1);
      index = end;
    }
    else result += escapeCharacter(character);
  }
  return result;
}

export function deptryExcludeRegex(glob: string): string {
  const segments = glob.split("/");
  if (segments.length === 1 && segments[0] === "**") return "^.*$";
  let result = "^";
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (segment === "**") {
      if (index === 0) result += "(?:.*/)?";
      else if (index === segments.length - 1) result += "(?:/.*)?";
      else result += "/(?:[^/]+/)*";
    } else {
      if (index > 0 && segments[index - 1] !== "**") result += "/";
      result += globSegmentRegex(segment);
    }
  }
  return `${result}$`;
}

export function deptryFindings(ctx: CheckContext, input: unknown): ParsedFindings {
  const report = reportSchema.parse(input);
  const findings = new FindingsBuilder();
  const grouped = new Map<string, { diagnostic: z.infer<typeof reportSchema>[number]; count: number }>();
  for (const diagnostic of report) {
    const file = relativizeFrom(ctx.root, diagnostic.location.file);
    assertInScope(file, ctx.paths, ["pyproject.toml", "setup.py"]);
    const key = `${file}\0${diagnostic.error.code}\0${diagnostic.module}`;
    const existing = grouped.get(key);
    grouped.set(key, { diagnostic, count: (existing?.count ?? 0) + 1 });
  }
  for (const { diagnostic, count } of grouped.values()) {
    const file = relativizeFrom(ctx.root, diagnostic.location.file);
    findings.add({
      file, rule: `deptry-${diagnostic.error.code}`, anchor: diagnostic.module, value: count,
      message: diagnostic.error.message,
      ...(diagnostic.location.line === null ? {} : { line: diagnostic.location.line }),
      ...(diagnostic.location.column === null ? {} : { column: diagnostic.location.column }),
    });
  }
  return findings.build();
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

function readSmallFile(path: string): string | undefined {
  try {
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.size > MAX_PACKAGE_METADATA_SIZE) return undefined;
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function readMetadataHeader(path: string): string | undefined {
  let descriptor: number | undefined;
  try {
    const stats = lstatSync(path);
    if (!stats.isFile()) return undefined;
    const buffer = Buffer.alloc(Math.min(stats.size, MAX_METADATA_HEADER_SIZE));
    descriptor = openSync(path, "r");
    const bytes = readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, bytes).split(/\r?\n\r?\n/u, 1)[0];
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function safeDirectories(path: string): string[] {
  if (!isDirectory(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name);
}

function sitePackages(root: string): string[] {
  for (const environment of [join(root, ".venv"), join(root, "venv")]) {
    if (!isDirectory(environment)) continue;
    const sites: string[] = [];
    const lib = join(environment, "lib");
    for (const python of safeDirectories(lib).filter((name) => name.startsWith("python"))) {
      const site = join(lib, python, "site-packages");
      if (isDirectory(site)) sites.push(site);
    }
    const windowsSite = join(environment, "Lib", "site-packages");
    if (isDirectory(windowsSite)) sites.push(windowsSite);
    if (sites.length > 0) return sites;
  }
  return [];
}

function normalizedName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/gu, "-");
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function dependencyStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function dependencyTable(value: unknown): string[] {
  const table = recordValue(value);
  return table === undefined ? [] : Object.values(table).flatMap(dependencyStrings);
}

function dependencyName(entry: string): string | undefined {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*/u.exec(entry.trim())?.[0];
}

function tableKeys(value: unknown): string[] {
  return Object.keys(recordValue(value) ?? {}).filter((name) => PACKAGE_NAME.test(name));
}

function poetryGroupDependencies(poetry: Record<string, unknown> | undefined): string[] {
  const groups = recordValue(poetry?.group);
  if (groups === undefined) return [];
  return Object.values(groups).flatMap((group) => tableKeys(recordValue(group)?.dependencies));
}

function toolDeclarations(tool: Record<string, unknown> | undefined): string[] {
  const poetry = recordValue(tool?.poetry);
  return [
    ...tableKeys(poetry?.dependencies), ...poetryGroupDependencies(poetry),
    ...dependencyTable(recordValue(tool?.pdm)?.["dev-dependencies"]),
    ...dependencyStrings(recordValue(tool?.uv)?.["dev-dependencies"]),
  ];
}

function manifestDeclarations(manifest: Record<string, unknown> | undefined): string[] {
  const project = recordValue(manifest?.project);
  const tool = recordValue(manifest?.tool);
  return [
    ...dependencyStrings(project?.dependencies),
    ...dependencyTable(project?.["optional-dependencies"]),
    ...dependencyTable(manifest?.["dependency-groups"]),
    ...toolDeclarations(tool),
  ];
}

function requirementDeclarations(root: string): string[] {
  if (!isDirectory(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^requirements.*\.txt$/u.test(entry.name))
    .flatMap((entry) => (readSmallFile(join(root, entry.name)) ?? "").split(/\r?\n/u));
}

function declaredDependencySpellings(root: string): Map<string, string> {
  const manifest = readRecord(join(root, "pyproject.toml"), parseToml);
  const declarations = [...manifestDeclarations(manifest), ...requirementDeclarations(root)];
  const spellings = new Map<string, string>();
  for (const declaration of declarations) {
    const name = dependencyName(declaration);
    if (name !== undefined && !spellings.has(normalizedName(name))) spellings.set(normalizedName(name), name);
  }
  return spellings;
}

function distributionIdentity(
  directory: string,
  metadata?: string,
): { normalized: string; spelling: string } | undefined {
  const declared = /^Name:[ \t]*(.+)$/imu.exec(metadata ?? "")?.[1]?.trim();
  const stem = directory.slice(0, -".dist-info".length);
  const spelling = declared ?? stem.replace(/-[0-9][^-]*$/u, "");
  if (!PACKAGE_NAME.test(spelling)) return undefined;
  return { normalized: normalizedName(spelling), spelling };
}

function topLevelModules(content: string): string[] {
  return content.split(/\r?\n/u).map((line) => line.trim()).filter((name) => MODULE_NAME.test(name));
}

function recordPath(line: string): string {
  if (!line.startsWith('"')) return line.split(",", 1)[0] ?? "";
  let path = "";
  for (let index = 1; index < line.length; index += 1) {
    const character = line[index]!;
    if (character !== '"') path += character;
    else if (line[index + 1] === '"') {
      path += '"';
      index += 1;
    } else break;
  }
  return path;
}

function recordModules(content: string): string[] {
  const modules = new Set<string>();
  for (const line of content.split(/\r?\n/u)) {
    const path = recordPath(line).replaceAll("\\", "/");
    if (!path.endsWith(".py") || path.startsWith("../") || path.startsWith("/")) continue;
    const first = path.split("/", 1)[0] ?? "";
    if (first.endsWith(".dist-info") || first === "__pycache__") continue;
    const module = first.endsWith(".py") ? basename(first, ".py") : first;
    if (MODULE_NAME.test(module)) modules.add(module);
  }
  return [...modules].toSorted();
}

function distributionModules(directory: string): string[] {
  const topLevel = readSmallFile(join(directory, "top_level.txt"));
  if (topLevel !== undefined) return topLevelModules(topLevel);
  const record = readSmallFile(join(directory, "RECORD"));
  return record === undefined ? [] : recordModules(record);
}

function deptryPackageModuleMap(root: string): string | undefined {
  const mappings = new Map<string, { spelling: string; modules: Set<string> }>();
  const declared = declaredDependencySpellings(root);
  for (const site of sitePackages(root)) {
    const distributions = safeDirectories(site)
      .filter((name) => name.endsWith(".dist-info"))
      .toSorted()
      .slice(0, MAX_DISTRIBUTIONS);
    for (const directory of distributions) {
      const absolute = join(site, directory);
      const identity = distributionIdentity(directory, readMetadataHeader(join(absolute, "METADATA")));
      const modules = distributionModules(absolute);
      if (identity === undefined || modules.length === 0) continue;
      const known = mappings.get(identity.normalized) ?? {
        spelling: identity.spelling, modules: new Set<string>(),
      };
      for (const module of modules) known.modules.add(module);
      mappings.set(identity.normalized, known);
    }
  }
  if (mappings.size === 0) return undefined;
  return [...mappings].toSorted(([left], [right]) => left.localeCompare(right))
    .map(([normalized, mapping]) => {
      const spelling = declared.get(normalized) ?? mapping.spelling;
      return `${spelling}=${[...mapping.modules].toSorted().join("|")}`;
    }).join(",");
}

function childFirstParty(absolute: string): string[] {
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && isFile(join(absolute, entry.name, "__init__.py"))) return [entry.name];
    if (entry.isFile() && extname(entry.name) === ".py" && entry.name !== "__init__.py") {
      return [basename(entry.name, ".py")];
    }
    return [];
  });
}

function pathFirstParty(root: string, path: string): string[] {
  if (path === ".") return [];
  const absolute = join(root, path);
  if (!isDirectory(absolute)) return [];
  return isFile(join(absolute, "__init__.py")) ? [basename(path)] : childFirstParty(absolute);
}

function deptryFirstParty(ctx: Pick<CheckContext, "root" | "paths">): string[] {
  return [...new Set(ctx.paths.flatMap((path) => pathFirstParty(ctx.root, path)))].toSorted();
}

export const deptryAdapter: CheckAdapter = {
  id: "python-unused-deptry", check: "unused", language: "python",
  tool: { bin: "deptry", version: "0.25.1" },
  applicability: () => ({ kind: "run" }),
  configFiles: (ctx) => toolOutput(ctx, "deptry.json").clear(),
  command: (ctx) => {
    const packageModuleMap = deptryPackageModuleMap(ctx.root);
    return pythonInvocation(ctx, {
      bin: "deptry",
      args: [...ctx.paths, "--json-output", toolOutput(ctx, "deptry.json").path, "--no-ansi",
        ...deptryFirstParty(ctx).flatMap((name) => ["--known-first-party", name]),
        ...(packageModuleMap === undefined
          ? [] : ["--package-module-name-map", packageModuleMap]),
        ...excludeGlobs(ctx.config, true).flatMap((glob) => [
          "--extend-exclude", deptryExcludeRegex(glob),
        ])],
      exitCodes: [0, 1],
    });
  },
  artifactOutputs: (ctx) => toolOutput(ctx, "deptry.json").outputs(),
  parse: (ctx) => Promise.resolve(deptryFindings(
    ctx, JSON.parse(toolOutput(ctx, "deptry.json").read("deptry")) as unknown,
  )),
};
