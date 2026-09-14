import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";

import { isRelativePath } from "../core/config/schema.ts";
import { fail } from "../core/errors.ts";

const MAX_COVERAGE_SIZE = 256 * 1024 * 1024;
const ISTANBUL_ERROR = "is not an Istanbul coverage map (expected the coverage-final.json written "
  + "by the vitest or jest json reporter; raw V8 output is not supported)";

interface CoverageResolution {
  file: string;
  root?: string;
  unmatchedKey?: string;
}

interface RootCandidate {
  root?: string;
  matched: number;
  depth: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ENTRY_OBJECTS = ["s", "f", "fnMap"] as const;

function coverageEntry(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return typeof value.path === "string" && ENTRY_OBJECTS.every((key) => isPlainObject(value[key]));
}

function readCoverageKeys(file: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fail(`${file} ${ISTANBUL_ERROR}`);
  }
  if (!isPlainObject(parsed) || !Object.values(parsed).every(coverageEntry)) {
    return fail(`${file} ${ISTANBUL_ERROR}`);
  }
  const keys = Object.keys(parsed);
  if (keys.length === 0) return fail(`${file} contains no files.`);
  return keys;
}

function rejectUnsupportedKey(key: string): void {
  if (/^[A-Za-z]:[\\/]/u.test(key)) {
    fail("Windows-style coverage paths are not supported; generate coverage in CI");
  }
  if (key.startsWith("file:")) fail("file:// coverage paths are not supported");
}

function candidatePrefixes(key: string): string[] {
  const segments = key.split("/");
  const prefixes = ["/"];
  for (let index = 1; index < segments.length - 1; index += 1) {
    prefixes.push(segments.slice(0, index + 1).join("/"));
  }
  return prefixes;
}

function prefixScore(
  prefix: string,
  keys: readonly string[],
  root: string,
  exists: (path: string) => boolean,
): number {
  return keys.filter((key) =>
    (prefix === "/" || key.startsWith(`${prefix}/`)) &&
    exists(join(root, key.slice(prefix.length))),
  ).length;
}

export function deriveCoverageRoot(
  keys: readonly string[],
  root: string,
  exists: (path: string) => boolean,
): { root?: string; matched: number } {
  const sample = keys.slice(0, 50);
  sample.forEach(rejectUnsupportedKey);
  if (sample.every((key) => !isAbsolute(key))) {
    return { matched: sample.filter((key) => exists(join(root, key))).length };
  }

  const absoluteKeys = sample.filter(isAbsolute);
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  const candidates: RootCandidate[] = [{
    matched: absoluteKeys.filter((key) => key.startsWith(rootPrefix) && exists(key)).length,
    depth: root.length,
  }];
  const prefixes = [...new Set(absoluteKeys.flatMap(candidatePrefixes))].toSorted();
  for (const prefix of prefixes) {
    candidates.push({
      root: prefix,
      matched: prefixScore(prefix, absoluteKeys, root, exists),
      depth: prefix.length,
    });
  }
  const best = candidates.reduce((winner, candidate) =>
    candidate.matched > winner.matched ||
      (candidate.matched === winner.matched && candidate.depth > winner.depth)
      ? candidate
      : winner,
  );
  if (best.matched === 0) return { matched: 0 };
  return best.root === undefined
    ? { matched: best.matched }
    : { root: best.root, matched: best.matched };
}

function coverageFile(root: string, value: string): string {
  if (!isRelativePath(value)) {
    return fail(`Invalid --coverage path "${value}": must be repository-relative and must not start with -`);
  }
  const candidate = resolve(root, value);
  if (!existsSync(candidate)) return fail(`Coverage file ${candidate} does not exist.`);
  const file = statSync(candidate).isDirectory() ? join(candidate, "coverage-final.json") : candidate;
  if (!existsSync(file)) return fail(`Coverage file ${file} does not exist.`);
  return file;
}

export function resolveCoverage(root: string, value: string): CoverageResolution {
  const file = coverageFile(root, value);
  const realRoot = realpathSync(root);
  const realFile = realpathSync(file);
  const containmentPrefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
  if (!realFile.startsWith(containmentPrefix)) {
    return fail(`Coverage file ${file} resolves outside the repository`);
  }
  const stats = statSync(realFile);
  if (!stats.isFile()) return fail(`Coverage file ${file} is not a regular file`);
  if (stats.size > MAX_COVERAGE_SIZE) return fail(`Coverage file ${file} is larger than 256 MiB`);
  const keys = readCoverageKeys(realFile);
  const derived = deriveCoverageRoot(keys, realRoot, existsSync);
  if (derived.matched === 0) return { file: realFile, unmatchedKey: keys[0]! };
  return { file: realFile, ...(derived.root === undefined ? {} : { root: derived.root }) };
}
