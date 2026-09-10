import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";

import { isExcluded } from "./exclusions.ts";
import type { Language } from "./schema.ts";

const DISCOVERY_EXCLUDED_ROOTS = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "out",
  "public",
  "coverage",
  "var",
  "artifacts",
  "tests",
  "test",
  "__tests__",
  "spec",
  "docs",
  "storage",
  "tmp",
]);

export const LANGUAGE_EXTENSIONS: Readonly<Record<Language, readonly string[]>> = {
  ts: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  php: [".php"],
  python: [".py"],
  web: [".twig", ".html", ".css", ".scss", ".less"],
};

const MINIFIED_NAME = /(?:[.-]min\.(?:js|css)$|^[a-z-]+-\d+(?:\.\d+)*\.js$)/u;
const MINIFIED_GLOBS = new Set(["**/*.min.js", "**/*.min.css"]);
const SOURCE_EXTENSIONS = new Set(Object.values(LANGUAGE_EXTENSIONS).flat());

function portable(path: string): string {
  return path.split(sep).join("/");
}

function hasLongLine(content: string): boolean {
  let length = 0;
  for (const character of content) {
    if (character === "\n" || character === "\r") length = 0;
    else if (++length > 1000) return true;
  }
  return false;
}

function isMinifiedFile(file: string): boolean {
  return MINIFIED_NAME.test(basename(file)) || hasLongLine(readFileSync(file, "utf8"));
}

interface WalkedSourceFile {
  absolute: string;
  relative: string;
}

function* walkSourceFiles(
  root: string,
  paths: readonly string[],
  language: Language | undefined,
  excludes: readonly string[],
): Generator<WalkedSourceFile> {
  const pending = paths.map((path) => join(root, path));
  const extensions = language === undefined
    ? SOURCE_EXTENSIONS
    : new Set(LANGUAGE_EXTENSIONS[language]);
  while (pending.length > 0) {
    const candidate = pending.pop()!;
    const relativePath = portable(relative(root, candidate));
    if (isExcluded(relativePath, excludes)) continue;
    const stats = lstatSync(candidate);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(candidate, { withFileTypes: true })) {
        pending.push(join(candidate, entry.name));
      }
      continue;
    }
    if (stats.isFile() && extensions.has(extname(candidate))) {
      yield { absolute: candidate, relative: relativePath };
    }
  }
}

export function findSourceFiles(
  root: string,
  paths: readonly string[],
  language: Language,
  excludes: readonly string[],
): string[] {
  const files: string[] = [];
  for (const file of walkSourceFiles(root, paths, language, excludes)) {
    if (!isMinifiedFile(file.absolute)) files.push(file.relative);
  }
  return files.toSorted();
}

export function findMinifiedFiles(
  root: string,
  paths: readonly string[],
  excludes: readonly string[],
): string[] {
  const effectiveExcludes = excludes.filter((pattern) => !MINIFIED_GLOBS.has(pattern));
  const files: string[] = [];
  for (const file of walkSourceFiles(root, paths, undefined, effectiveExcludes)) {
    if (isMinifiedFile(file.absolute)) {
      files.push(file.relative);
    }
  }
  return [...new Set(files)].toSorted();
}

export function discoverSourceRoots(
  root: string,
  language: Language,
  excludes: readonly string[],
): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith(".") && !DISCOVERY_EXCLUDED_ROOTS.has(name))
    .filter((name) => findSourceFiles(root, [name], language, excludes).length > 0)
    .toSorted();
}
