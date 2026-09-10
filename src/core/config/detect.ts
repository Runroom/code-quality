import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Language } from "./schema.ts";
import type { ArchitectureSelection } from "./types.ts";

const MANIFESTS: Record<Language, string[]> = {
  ts: ["package.json"],
  php: ["composer.json"],
  python: ["pyproject.toml", "setup.py"],
};

const CONVENTIONAL_RULES: Record<Language, string> = {
  ts: ".dependency-cruiser.cjs",
  php: "deptrac.yaml",
  python: ".importlinter",
};

const DEFAULT_PATHS: Record<Language, string[]> = {
  ts: ["src"],
  php: ["src", "lib", "app"],
  python: ["src"],
};

export function detectLanguages(root: string): Language[] {
  return (Object.keys(MANIFESTS) as Language[]).filter((language) =>
    MANIFESTS[language].some((manifest) => existsSync(join(root, manifest))),
  );
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
  if (existsSync(join(root, rulesFile))) return { kind: "file", rulesFile };
  return explicit === undefined ? { kind: "skip" } : { kind: "missing", rulesFile };
}
