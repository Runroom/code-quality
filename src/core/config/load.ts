import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";
import { ZodError } from "zod";

import { fail } from "../errors.ts";
import { BUILTIN_EXCLUSIONS, TEST_EXCLUSIONS } from "./exclusions.ts";
import { configHash } from "./hash.ts";
import { defaultPaths, detectLanguages, isDrupalProject, selectArchitecture } from "./detect.ts";
import {
  discoverSourceRoots,
  findMinifiedFiles,
  findSourceFiles,
  LANGUAGE_EXTENSIONS,
} from "./sources.ts";
import {
  LANGUAGES,
  consumerConfigSchema,
  type ConsumerConfig,
  type Language,
} from "./schema.ts";
import type { ArchitectureSelection, ResolvedConfig } from "./types.ts";

const DETECTION_MANIFESTS: Partial<Record<Language, readonly string[]>> = {
  ts: ["package.json"],
  php: ["composer.json"],
  python: ["pyproject.toml", "setup.py"],
};

const LANGUAGE_LABELS: Record<Language, string> = {
  ts: "TS",
  php: "PHP",
  python: "Python",
  web: "web",
};

const DEFAULT_CANDIDATES: Record<Language, string> = {
  ts: "src, assets",
  php: "src, lib, app",
  python: "src",
  web: "templates, assets",
};

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

interface LanguageResolution {
  languages: Language[];
  explicit: Set<Language>;
}

function configuredPathLanguages(config: ConsumerConfig): Language[] {
  return LANGUAGES.filter((language) => config.paths?.[language] !== undefined);
}

function resolveLanguages(root: string, config: ConsumerConfig): LanguageResolution {
  const configuredPaths = configuredPathLanguages(config);
  const detected = detectLanguages(root);
  const languages = config.languages ?? [...new Set([...detected, ...configuredPaths])];
  return {
    languages: [...languages],
    explicit: new Set([...config.languages ?? [], ...configuredPaths]),
  };
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

function detectedManifest(root: string, language: Language): string {
  const manifests = DETECTION_MANIFESTS[language] ?? [];
  return manifests.find((manifest) => existsSync(join(root, manifest)))
    ?? manifests.join(" or ");
}

function noSourceNotice(root: string, language: Language, paths: string[]): string {
  const roots = paths.length > 0
    ? paths.join(", ")
    : DEFAULT_CANDIDATES[language];
  return `${language}: ${detectedManifest(root, language)} detected but no ${language} source files under `
    + `${roots}; add paths.${language} to .code-quality.yml to enable ${LANGUAGE_LABELS[language]} checks`;
}

function noDefaultPath(language: Language): never {
  const candidates = DEFAULT_CANDIDATES[language];
  return fail(
    `${language}: no usable source path (${candidates}). Create .code-quality.yml with `
      + `paths.${language} listing your source roots, e.g. paths: { ${language}: [app, lib] }`,
  );
}

function discoveredRootsNotice(language: Language, roots: string[]): string {
  return `${language}: no ${language} sources under ${DEFAULT_CANDIDATES[language].split(", ")[0]}; `
    + `using detected roots ${roots.join(", ")}`;
}

interface LanguagePathResolution {
  path?: string[];
  notice?: string;
}

interface LanguagePathContext {
  root: string;
  language: Language;
  explicit: ReadonlySet<Language>;
  config: ConsumerConfig;
  excludes: readonly string[];
}

function resolveLanguagePath(context: LanguagePathContext): LanguagePathResolution {
  const { root, language, explicit, config, excludes } = context;
  const configured = config.paths?.[language];
  if (configured !== undefined) {
    const paths = ensureConfiguredPaths(root, language, configured);
    ensureSourceFiles(root, language, paths, excludes);
    return { path: paths };
  }

  const defaults = defaultPaths(root, language);
  if (explicit.has(language) && defaults.length === 0) return { path: noDefaultPath(language) };
  if (defaults.length > 0 && findSourceFiles(root, defaults, language, excludes).length > 0) {
    return { path: defaults };
  }
  if (explicit.has(language)) {
    ensureSourceFiles(root, language, defaults, excludes);
    return { path: defaults };
  }

  const discovered = discoverSourceRoots(root, language, excludes);
  if (discovered.length > 0) {
    return { path: discovered, notice: discoveredRootsNotice(language, discovered) };
  }
  return { notice: noSourceNotice(root, language, defaults) };
}

function resolvePaths(
  root: string,
  languages: Language[],
  explicit: ReadonlySet<Language>,
  config: ConsumerConfig,
): { paths: Partial<Record<Language, string[]>>; notices: string[] } {
  const paths: Partial<Record<Language, string[]>> = {};
  const notices: string[] = [];
  const excludes = [...BUILTIN_EXCLUSIONS, ...config.exclude ?? [], ...TEST_EXCLUSIONS];
  for (const language of languages) {
    const resolution = resolveLanguagePath({ root, language, explicit, config, excludes });
    if (resolution.path !== undefined) paths[language] = resolution.path;
    if (resolution.notice !== undefined) notices.push(resolution.notice);
  }
  if (isDrupalProject(root)) {
    notices.push(
      "Drupal profile: using custom module, theme, and profile roots while excluding core, "
        + "contrib, generated, and runtime paths",
    );
  }
  return { paths, notices };
}

function minifiedNotice(files: string[]): string {
  const displayed = files.slice(0, 5).join(", ");
  const remainder = files.length > 5 ? ` (+${files.length - 5} more)` : "";
  return `skipping minified/vendored files: ${displayed}${remainder}`;
}

function resolveMinifiedFiles(
  root: string,
  paths: Partial<Record<Language, string[]>>,
  consumerExcludes: readonly string[],
): string[] {
  const roots = [...new Set(Object.values(paths).flatMap((entries) => entries ?? []))];
  const excludes = [...BUILTIN_EXCLUSIONS, ...consumerExcludes, ...TEST_EXCLUSIONS];
  return findMinifiedFiles(root, roots, excludes);
}

function resolveArchitecture(
  root: string,
  languages: Language[],
  config: ConsumerConfig,
): Partial<Record<Language, ArchitectureSelection>> {
  const architecture: Partial<Record<Language, ArchitectureSelection>> = {};
  for (const language of languages) {
    if (language === "web") {
      architecture.web = { kind: "skip" };
      continue;
    }
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
  const isDrupal = isDrupalProject(root);
  const languageResolution = resolveLanguages(root, consumer);
  const pathResolution = resolvePaths(
    root,
    languageResolution.languages,
    languageResolution.explicit,
    consumer,
  );
  const languages = languageResolution.languages.filter(
    (language) => pathResolution.paths[language] !== undefined,
  );
  const paths = pathResolution.paths;
  const minified = resolveMinifiedFiles(root, paths, consumer.exclude ?? []);
  if (minified.length > 0) pathResolution.notices.push(minifiedNotice(minified));
  const architecture = resolveArchitecture(root, languages, consumer);
  const resolved = {
    isDrupal,
    languages,
    paths,
    exclude: [...consumer.exclude ?? [], ...minified],
    disabled: consumer.checks?.disabled ?? [],
    architecture,
    notices: pathResolution.notices,
  };
  return { root, ...resolved, configHash: configHash(resolved) };
}
