import { lstatSync, readdirSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

import { isExcluded } from "./exclusions.ts";
import type { Language } from "./schema.ts";

export const LANGUAGE_EXTENSIONS: Readonly<Record<Language, readonly string[]>> = {
  ts: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  php: [".php"],
  python: [".py"],
  web: [".twig", ".html", ".css", ".scss", ".less"],
};

function portable(path: string): string {
  return path.split(sep).join("/");
}

export function findSourceFiles(
  root: string,
  paths: readonly string[],
  language: Language,
  excludes: readonly string[],
): string[] {
  const pending = paths.map((path) => join(root, path));
  const extensions = new Set(LANGUAGE_EXTENSIONS[language]);
  const files: string[] = [];
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
    if (stats.isFile() && extensions.has(extname(candidate))) files.push(relativePath);
  }
  return files.toSorted();
}
