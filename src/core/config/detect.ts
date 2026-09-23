import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BUILTIN_EXCLUSIONS, TEST_EXCLUSIONS } from "./exclusions.ts";
import { LANGUAGES, type Language } from "./schema.ts";
import { findSourceFiles, languageExtensions } from "./sources.ts";
import type { SourceSelection } from "./sources.ts";
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

const DRUPAL_PATHS: Record<"php" | "web", string[]> = {
  php: [
    "web/modules/custom", "web/themes/custom", "web/profiles/custom",
    "docroot/modules/custom", "docroot/themes/custom", "docroot/profiles/custom",
  ],
  web: ["web/themes/custom", "docroot/themes/custom"],
};

export const NEXT_CONFIGS = [
  "next.config.js",
  "next.config.mjs",
  "next.config.cjs",
  "next.config.ts",
  "next.config.mts",
] as const;

export const PAYLOAD_CONFIGS = [
  "payload.config.ts",
  "payload.config.js",
  "payload.config.mjs",
  "payload.config.mts",
  "src/payload.config.ts",
  "src/payload.config.js",
  "src/payload.config.mjs",
  "src/payload.config.mts",
] as const;

export const PAYLOAD_NEXT_CONFIGS = [...NEXT_CONFIGS, ...PAYLOAD_CONFIGS] as const;

export interface ProjectProfiles {
  next: boolean;
  payload: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDrupalProject(root: string): boolean {
  const file = join(root, "composer.json");
  if (!existsSync(file)) return false;
  try {
    const composer: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(composer) || !isRecord(composer.require)) return false;
    return Object.keys(composer.require).some((name) => name.startsWith("drupal/core"));
  } catch {
    return false;
  }
}

function hasPayloadDependency(root: string): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (!isRecord(parsed)) return false;
    return [parsed.dependencies, parsed.devDependencies]
      .some((dependencies) => isRecord(dependencies) && "payload" in dependencies);
  } catch {
    return false;
  }
}

export function projectProfiles(root: string): ProjectProfiles {
  return {
    next: NEXT_CONFIGS.some((file) => existsSync(join(root, file))),
    payload: PAYLOAD_CONFIGS.some((file) => existsSync(join(root, file)))
      || hasPayloadDependency(root),
  };
}

export function isPayloadNextProject(root: string): boolean {
  const profiles = projectProfiles(root);
  return profiles.next || profiles.payload;
}

function containsSources(root: string, paths: string[], language: Language): boolean {
  const excludes = [...BUILTIN_EXCLUSIONS, ...TEST_EXCLUSIONS];
  const selection: SourceSelection = { excludes, extensions: languageExtensions(language, false) };
  return paths.length > 0 && findSourceFiles(root, paths, language, selection).length > 0;
}

function drupalPaths(root: string, language: Language): string[] {
  if (!isDrupalProject(root) || language === "python") return [];
  const webPaths = DRUPAL_PATHS.web.filter((path) => existsSync(join(root, path)));
  if (language === "ts") return webPaths.filter((path) => containsSources(root, [path], "ts"));
  return DRUPAL_PATHS[language].filter((path) => existsSync(join(root, path)));
}

export function detectLanguages(root: string): Language[] {
  return LANGUAGES.filter((language) => {
    if (drupalPaths(root, language).length > 0) return true;
    return language === "web"
      ? webSourcesExist(root)
      : MANIFESTS[language]?.some((manifest) => existsSync(join(root, manifest))) === true;
  });
}

function webSourcesExist(root: string): boolean {
  const paths = defaultPaths(root, "web");
  const excludes = [...BUILTIN_EXCLUSIONS, ...TEST_EXCLUSIONS];
  return paths.length > 0 && findSourceFiles(root, paths, "web", {
    excludes,
    extensions: languageExtensions("web", false),
  }).length > 0;
}

export function defaultPaths(root: string, language: Language): string[] {
  const defaults = DEFAULT_PATHS[language].filter((path) => existsSync(join(root, path)));
  const drupal = drupalPaths(root, language);
  if (language === "ts") return [...new Set([...defaults, ...drupal])];
  return drupal.length > 0 ? drupal : defaults;
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
