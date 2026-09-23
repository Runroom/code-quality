import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";

import { isExcluded } from "./exclusions.ts";
import { isRelativePath, type Language } from "./schema.ts";
import { DISCOVERY_EXCLUDED_ROOTS, findSourceFiles, type SourceSelection } from "./sources.ts";

const MAX_MANIFEST_SIZE = 1024 * 1024;
const MAX_PATTERNS = 200;
const MAX_PATTERN_LENGTH = 200;
const INVALID_CHARACTERS = new Set(["?", "[", "]", "{", "}", "(", ")", "!", "+", "@"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function readRecord(
  file: string,
  parse: (content: string) => unknown,
): Record<string, unknown> | undefined {
  try {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > MAX_MANIFEST_SIZE) return undefined;
    const value = parse(readFileSync(file, "utf8"));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function normalize(candidate: string): string | undefined {
  if (candidate.startsWith("/")) return undefined;
  const normalized = candidate.split("/").filter((segment) => segment.length > 0 && segment !== ".").join("/");
  return isRelativePath(normalized) ? normalized : undefined;
}

function normalizePattern(pattern: string): string | undefined {
  const negation = pattern.startsWith("!");
  const normalized = normalize(negation ? pattern.slice(1) : pattern);
  return normalized === undefined ? undefined : `${negation ? "!" : ""}${normalized}`;
}

function safeDirectories(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function childDirectories(root: string): string[] {
  const directories: string[] = [];
  let frontier = [""];
  for (let depth = 1; depth <= 3; depth += 1) {
    const next: string[] = [];
    for (const parent of frontier) {
      for (const name of safeDirectories(join(root, parent))) {
        const directory = parent === "" ? name : `${parent}/${name}`;
        directories.push(directory);
        next.push(directory);
      }
    }
    frontier = next;
  }
  return directories;
}

function validSegment(segment: string): boolean {
  if (segment === "**" || segment === "*") return true;
  return ![...segment].some((character) => INVALID_CHARACTERS.has(character)) &&
    (segment.match(/\*/gu)?.length ?? 0) <= 1;
}

function validPattern(pattern: string): boolean {
  return pattern.length > 0 && pattern.length <= MAX_PATTERN_LENGTH &&
    pattern.split("/").every(validSegment);
}

function segmentMatches(pattern: string, candidate: string): boolean {
  if (pattern === "*") return true;
  const star = pattern.indexOf("*");
  return star < 0
    ? pattern === candidate
    : candidate.startsWith(pattern.slice(0, star)) && candidate.endsWith(pattern.slice(star + 1));
}

function matchSegments(pattern: readonly string[], candidate: readonly string[]): boolean {
  const memo = new Map<string, boolean>();
  function matches(patternIndex: number, candidateIndex: number): boolean {
    const key = `${patternIndex}:${candidateIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const head = pattern[patternIndex];
    let result = candidateIndex === candidate.length;
    if (head === "**") {
      result = matches(patternIndex + 1, candidateIndex) ||
        (candidateIndex < candidate.length && matches(patternIndex, candidateIndex + 1));
    } else if (head !== undefined) {
      result = candidateIndex < candidate.length && segmentMatches(head, candidate[candidateIndex]!) &&
        matches(patternIndex + 1, candidateIndex + 1);
    }
    memo.set(key, result);
    return result;
  }
  return matches(0, 0);
}

function memberMatches(pattern: string, directory: string): boolean {
  return validPattern(pattern) && matchSegments(pattern.split("/"), directory.split("/"));
}

function expandMemberGlobs(root: string, patterns: readonly string[]): string[] {
  const normalized = patterns.flatMap((pattern) => {
    const result = normalizePattern(pattern);
    return result === undefined ? [] : [result];
  });
  const included = normalized.filter((pattern) => !pattern.startsWith("!")).slice(0, MAX_PATTERNS);
  const excluded = normalized.filter((pattern) => pattern.startsWith("!")).slice(0, MAX_PATTERNS)
    .map((pattern) => pattern.slice(1));
  if (included.length === 0) return [];
  return childDirectories(root).filter((directory) =>
    included.some((pattern) => memberMatches(pattern, directory)) &&
    !excluded.some((pattern) => memberMatches(pattern, directory))
  );
}

function packageWorkspacePatterns(manifest: Record<string, unknown> | undefined): string[] {
  const workspaces = manifest?.workspaces;
  if (Array.isArray(workspaces)) return strings(workspaces);
  return isRecord(workspaces) ? strings(workspaces.packages) : [];
}

function hasManifest(root: string, member: string, manifest: string): boolean {
  return existsSync(join(root, member, manifest));
}

export function workspaceMemberDirectories(root: string): string[] {
  const pnpm = readRecord(join(root, "pnpm-workspace.yaml"), parseYaml);
  const packageJson = readRecord(join(root, "package.json"), JSON.parse);
  const patterns = [...strings(pnpm?.packages), ...packageWorkspacePatterns(packageJson)];
  return [...new Set(expandMemberGlobs(root, patterns))]
    .filter((member) => hasManifest(root, member, "package.json"))
    .toSorted();
}

function isConventionalName(name: string): boolean {
  return name.startsWith(".") || DISCOVERY_EXCLUDED_ROOTS.has(name);
}

const DEPTH_ONE_TS_EXCLUSIONS = new Set([
  "static", "cypress", "e2e", "examples", "fixtures", "playwright", "storybook-static",
]);

function depthOnePackages(root: string): string[] {
  return safeDirectories(root)
    .filter((name) => !isConventionalName(name) && !DEPTH_ONE_TS_EXCLUSIONS.has(name))
    .filter((name) => hasManifest(root, name, "package.json"));
}

function preferSrcSubdir(root: string, member: string, selection?: SourceSelection): string {
  const source = `${member}/src`;
  if (!existsSync(join(root, source))) return member;
  if (selection === undefined) return source;
  const outsideSrc = findSourceFiles(root, [member], "ts", selection)
    .some((file) => !file.startsWith(`${source}/`));
  return outsideSrc ? member : source;
}

function typeScriptCandidates(root: string, selection: SourceSelection): string[] {
  return [...workspaceMemberDirectories(root), ...depthOnePackages(root)]
    .map((member) => preferSrcSubdir(root, member, selection));
}

function composerMapDirectories(value: unknown): string[] {
  return isRecord(value) ? Object.values(value).flatMap(strings) : [];
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function phpCandidates(root: string): string[] {
  const autoload = readRecord(join(root, "composer.json"), JSON.parse)?.autoload;
  if (!isRecord(autoload)) return [];
  const candidates = [
    ...composerMapDirectories(autoload["psr-4"]),
    ...composerMapDirectories(autoload["psr-0"]),
  ];
  for (const entry of strings(autoload.classmap)) {
    const directory = normalize(entry);
    if (directory !== undefined && isDirectory(join(root, directory))) candidates.push(directory);
  }
  return candidates;
}

function nestedRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return isRecord(current) ? current : undefined;
}

export function uvWorkspaceMemberDirectories(root: string): string[] {
  const project = readRecord(join(root, "pyproject.toml"), parseToml);
  const workspace = nestedRecord(project, ["tool", "uv", "workspace"]);
  const patterns = [
    ...strings(workspace?.members),
    ...strings(workspace?.exclude).map((pattern) => `!${pattern}`),
  ];
  return expandMemberGlobs(root, patterns)
    .filter((member) => hasManifest(root, member, "pyproject.toml"));
}

function pythonCandidates(root: string): string[] {
  const project = readRecord(join(root, "pyproject.toml"), parseToml);
  const setuptools = nestedRecord(project, ["tool", "setuptools", "packages", "find"]);
  const members = uvWorkspaceMemberDirectories(root)
    .map((member) => preferSrcSubdir(root, member));
  return [...members, ...strings(setuptools?.where)];
}

function isFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

export function ownerOf(root: string, path: string): string {
  let candidate = path.replace(/\/+$/u, "") || ".";
  while (candidate !== ".") {
    if (isFile(join(root, candidate, "package.json"))) return candidate;
    const parent = dirname(candidate);
    candidate = parent === candidate ? "." : parent;
  }
  return ".";
}

function reduceRoots(candidates: readonly string[]): string[] {
  const unique = [...new Set(candidates)].toSorted();
  return unique.filter((candidate) =>
    !unique.some((parent) => parent !== candidate && candidate.startsWith(`${parent}/`))
  );
}

export function workspaceRoots(root: string, language: Language, selection: SourceSelection): string[] {
  if (language === "web") return [];
  const candidates = language === "ts"
    ? typeScriptCandidates(root, selection)
    : language === "php" ? phpCandidates(root) : pythonCandidates(root);
  const valid = candidates.flatMap((candidate) => {
    const directory = normalize(candidate);
    if (directory === undefined || isExcluded(directory, selection.excludes)) return [];
    if (!isDirectory(join(root, directory))) return [];
    return findSourceFiles(root, [directory], language, selection).length > 0 ? [directory] : [];
  });
  return reduceRoots(valid);
}
