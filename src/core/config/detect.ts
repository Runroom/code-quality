import { existsSync } from "node:fs";
import { join } from "node:path";

import { BUILTIN_EXCLUSIONS, TEST_EXCLUSIONS } from "./exclusions.ts";
import { LANGUAGES, type Language } from "./schema.ts";
import { findSourceFiles } from "./sources.ts";
import type { ArchitectureSelection } from "./types.ts";

const MANIFESTS: Partial<Record<Language, string[]>> = {
  ts: ["package.json"],
  php: ["composer.json"],
  python: ["pyproject.toml", "setup.py"],
};

const CONVENTIONAL_RULES: Partial<Record<Language, string>> = {
  ts: ".dependency-cruiser.cjs",
  php: "deptrac.yaml",
  python: ".importlinter",
};

const DEFAULT_PATHS: Record<Language, string[]> = {
  ts: ["src", "assets"],
  php: ["src", "lib", "app"],
  python: ["src"],
  web: ["templates", "assets"],
};

export function detectLanguages(root: string): Language[] {
  return LANGUAGES.filter((language) => language === "web"
    ? webSourcesExist(root)
    : MANIFESTS[language]?.some((manifest) => existsSync(join(root, manifest))) === true);
}

function webSourcesExist(root: string): boolean {
  const paths = defaultPaths(root, "web");
  const excludes = [...BUILTIN_EXCLUSIONS, ...TEST_EXCLUSIONS];
  return paths.length > 0 && findSourceFiles(root, paths, "web", excludes).length > 0;
}

export function defaultPaths(root: string, language: Language): string[] {
  return DEFAULT_PATHS[language].filter((path) => existsSync(join(root, path)));
}

export function selectArchitecture(
  root: string,
  language: Language,
  explicit?: string,
): ArchitectureSelection {
  const rulesFile = explicit ?? CONVENTIONAL_RULES[language];
  if (rulesFile === undefined) return { kind: "skip" };
  if (existsSync(join(root, rulesFile))) return { kind: "file", rulesFile };
  return explicit === undefined ? { kind: "skip" } : { kind: "missing", rulesFile };
}
