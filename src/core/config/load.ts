import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";
import { ZodError } from "zod";

import { fail } from "../errors.ts";
import { BUILTIN_EXCLUSIONS, TEST_EXCLUSIONS } from "./exclusions.ts";
import { configHash } from "./hash.ts";
import { defaultPaths, detectLanguages, selectArchitecture } from "./detect.ts";
import { findSourceFiles, LANGUAGE_EXTENSIONS } from "./sources.ts";
import {
  consumerConfigSchema,
  type ConsumerConfig,
  type Language,
} from "./schema.ts";
import type { ArchitectureSelection, ResolvedConfig } from "./types.ts";

function issueText(issue: ZodError["issues"][number]): string {
  const path = issue.path.join(".");
  return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
}

function readYaml(root: string): ConsumerConfig {
  const file = join(root, ".code-quality.yml");
  if (!existsSync(file)) return {};
  try {
    return consumerConfigSchema.parse(parse(readFileSync(file, "utf8")) ?? {});
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.issues.map(issueText).join("; ");
      return fail(`Invalid configuration file '${file}': ${issues}`);
    }
    return fail(`Invalid configuration file '${file}'.`);
  }
}

function resolveLanguages(root: string, config: ConsumerConfig): Language[] {
  const languages = config.languages ?? detectLanguages(root);
  if (languages.length === 0) {
    return fail("No supported language detected; configure languages in .code-quality.yml.");
  }
  return [...languages];
}

function ensureConfiguredPaths(root: string, language: Language, paths: string[]): string[] {
  const missing = paths.find((path) => !existsSync(join(root, path)));
  if (missing !== undefined) return fail(`${language}: path ${missing} does not exist`);
  return [...paths];
}

function ensureSourceFiles(
  root: string,
  language: Language,
  paths: string[],
  excludes: readonly string[],
): void {
  if (findSourceFiles(root, paths, language, excludes).length > 0) return;
  fail(
    `${language}: no ${language} source files found under ${paths.join(", ")} ` +
      `(extensions: ${LANGUAGE_EXTENSIONS[language].join(" ")})`,
  );
}

function noDefaultPath(language: Language): never {
  const candidates = language === "php" ? "src, lib, app" : "src";
  return fail(
    `${language}: no usable source path (${candidates}). Create .code-quality.yml with `
      + `paths.${language} listing your source roots, e.g. paths: { ${language}: [app, lib] }`,
  );
}

function resolvePaths(
  root: string,
  languages: Language[],
  config: ConsumerConfig,
): Partial<Record<Language, string[]>> {
  const paths: Partial<Record<Language, string[]>> = {};
  const excludes = [...BUILTIN_EXCLUSIONS, ...config.exclude ?? [], ...TEST_EXCLUSIONS];
  for (const language of languages) {
    const configured = config.paths?.[language];
    if (configured !== undefined) {
      paths[language] = ensureConfiguredPaths(root, language, configured);
      ensureSourceFiles(root, language, paths[language], excludes);
      continue;
    }
    const defaults = defaultPaths(root, language);
    paths[language] = defaults.length > 0 ? defaults : noDefaultPath(language);
    ensureSourceFiles(root, language, paths[language], excludes);
  }
  return paths;
}

function resolveArchitecture(
  root: string,
  languages: Language[],
  config: ConsumerConfig,
): Partial<Record<Language, ArchitectureSelection>> {
  const architecture: Partial<Record<Language, ArchitectureSelection>> = {};
  for (const language of languages) {
    const explicit = config.architecture?.[language]?.rulesFile;
    const selection = selectArchitecture(root, language, explicit);
    if (selection.kind === "missing") {
      return fail(
        `architecture.${language}.rulesFile ${selection.rulesFile} does not exist`,
      );
    }
    architecture[language] = selection;
  }
  return architecture;
}

export function loadConfig(root: string): ResolvedConfig {
  const consumer = readYaml(root);
  const languages = resolveLanguages(root, consumer);
  const paths = resolvePaths(root, languages, consumer);
  const architecture = resolveArchitecture(root, languages, consumer);
  const resolved = {
    languages,
    paths,
    exclude: consumer.exclude ?? [],
    disabled: consumer.checks?.disabled ?? [],
    architecture,
  };
  return { root, ...resolved, configHash: configHash(resolved) };
}
