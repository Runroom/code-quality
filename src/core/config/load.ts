import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";
import { ZodError } from "zod";

import { fail } from "../errors.ts";
import {
  BUILTIN_EXCLUSIONS,
  nextExclusions,
  payloadExclusions,
  TEST_EXCLUSIONS,
} from "./exclusions.ts";
import { configHash } from "./hash.ts";
import {
  defaultPaths,
  detectLanguages,
  isDrupalProject,
  projectProfiles,
  selectArchitecture,
} from "./detect.ts";
import {
  discoverSourceRoots,
  findMinifiedFiles,
  findSourceFiles,
  languageExtensions,
} from "./sources.ts";
import type { SourceSelection } from "./sources.ts";
import { ownerOf, workspaceRoots } from "./workspaces.ts";
import {
  LANGUAGES,
  consumerConfigSchema,
  type ConsumerConfig,
  type Language,
} from "./schema.ts";
import type { ArchitectureSelection, ResolvedConfig } from "./types.ts";
import { isAtLeast, PYTHON_314_VERSION, pythonTarget } from "./runtime.ts";

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
}

function configuredPathLanguages(config: ConsumerConfig): Language[] {
  return LANGUAGES.filter((language) => config.paths?.[language] !== undefined);
}

function resolveLanguages(root: string, config: ConsumerConfig): LanguageResolution {
  const configuredPaths = configuredPathLanguages(config);
  const detected = detectLanguages(root, config.exclude ?? []);
  const languages = config.languages ?? [...new Set([...detected, ...configuredPaths])];
  return { languages: [...languages] };
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
  selection: SourceSelection,
): void {
  if (findSourceFiles(root, paths, language, selection).length > 0) return;
  fail(
    `${language}: no ${language} source files found under ${paths.join(", ")} ` +
      `(extensions: ${selection.extensions.join(" ")})`,
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
  selection: SourceSelection;
  isDrupal: boolean;
}

function conventionalPaths(context: LanguagePathContext, defaults: string[]): string[] {
  const { root, language, selection } = context;
  if (defaults.length === 0) return [];
  return findSourceFiles(root, defaults, language, selection).length > 0 ? defaults : [];
}

function automaticPaths(
  context: LanguagePathContext,
  conventional: string[],
): LanguagePathResolution | undefined {
  const { root, language, explicit, selection, isDrupal } = context;
  const candidates = language === "php" && isDrupal ? [] : workspaceRoots(root, language, selection);
  const workspace = candidates.filter((candidate) =>
    !conventional.some((path) => candidate === path || candidate.startsWith(`${path}/`))
  );
  if (conventional.length + workspace.length === 0) return undefined;
  const discovered = conventional.length === 0 && !explicit.has(language)
    ? discoverSourceRoots(root, language, selection).filter((candidate) =>
      !workspace.some((rootPath) => rootPath === candidate || rootPath.startsWith(`${candidate}/`))
    )
    : [];
  const additional = [...new Set([...workspace, ...discovered])].toSorted();
  const path = [...conventional, ...additional];
  return workspace.length > 0
    ? { path, notice: `${language}: added workspace roots ${workspace.join(", ")}` }
    : { path };
}

function resolveLanguagePath(context: LanguagePathContext): LanguagePathResolution {
  const { root, language, explicit, config, selection } = context;
  const configured = config.paths?.[language];
  if (configured !== undefined) {
    const paths = ensureConfiguredPaths(root, language, configured);
    ensureSourceFiles(root, language, paths, selection);
    return { path: paths };
  }

  const defaults = defaultPaths(root, language);
  const conventional = conventionalPaths(context, defaults);
  const automatic = automaticPaths(context, conventional);
  if (automatic !== undefined) return automatic;
  if (explicit.has(language) && defaults.length === 0) return { path: noDefaultPath(language) };
  if (explicit.has(language)) {
    ensureSourceFiles(root, language, defaults, selection);
    return { path: defaults };
  }

  const discovered = discoverSourceRoots(root, language, selection);
  if (discovered.length > 0) {
    return { path: discovered, notice: discoveredRootsNotice(language, discovered) };
  }
  return { notice: noSourceNotice(root, language, defaults) };
}

function resolvePaths(
  root: string,
  config: ConsumerConfig,
  languages: Language[],
  options: { isDrupal: boolean; profileExclusions: readonly string[] },
): { paths: Partial<Record<Language, string[]>>; notices: string[] } {
  const { isDrupal, profileExclusions } = options;
  const paths: Partial<Record<Language, string[]>> = {};
  const notices: string[] = [];
  const baseExcludes = [...BUILTIN_EXCLUSIONS, ...config.exclude ?? [], ...TEST_EXCLUSIONS];
  const explicit = new Set([...config.languages ?? [], ...configuredPathLanguages(config)]);
  for (const language of languages) {
    const selection: SourceSelection = {
      excludes: language === "ts" ? [...baseExcludes, ...profileExclusions] : baseExcludes,
      extensions: languageExtensions(language, isDrupal),
    };
    const resolution = resolveLanguagePath({
      root,
      language,
      explicit,
      config,
      selection,
      isDrupal,
    });
    if (resolution.path !== undefined) paths[language] = resolution.path;
    if (resolution.notice !== undefined) notices.push(resolution.notice);
  }
  if (isDrupal) {
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
  profileExclusions: readonly string[],
): string[] {
  const roots = [...new Set(Object.values(paths).flatMap((entries) => entries ?? []))];
  const excludes = [
    ...BUILTIN_EXCLUSIONS,
    ...consumerExcludes,
    ...profileExclusions,
    ...TEST_EXCLUSIONS,
  ];
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

interface ProfileResolution {
  exclusions: string[];
  nextOwners: string[];
  payloadOwners: string[];
}

function resolveProfiles(root: string, tsRoots: readonly string[]): ProfileResolution {
  const rootsByOwner = new Map<string, string[]>();
  for (const path of tsRoots) {
    const owner = ownerOf(root, path);
    const paths = rootsByOwner.get(owner) ?? [];
    paths.push(path);
    rootsByOwner.set(owner, paths);
  }
  const resolution: ProfileResolution = { exclusions: [], nextOwners: [], payloadOwners: [] };
  for (const [owner, paths] of rootsByOwner) {
    const ownerRoot = owner === "." ? root : join(root, owner);
    const profiles = projectProfiles(ownerRoot);
    if (profiles.next) {
      resolution.nextOwners.push(owner);
      resolution.exclusions.push(...nextExclusions(owner));
    }
    if (profiles.payload) {
      resolution.payloadOwners.push(owner);
      resolution.exclusions.push(...payloadExclusions(paths));
    }
  }
  resolution.exclusions = [...new Set(resolution.exclusions)];
  return resolution;
}

function profileNotice(message: string, owners: readonly string[]): string {
  const nested = owners.filter((owner) => owner !== ".");
  return nested.length === owners.length ? `${message} (${nested.join(", ")})` : message;
}

function appendProfileNotices(
  notices: string[],
  minified: string[],
  profiles: ProfileResolution,
): void {
  if (minified.length > 0) notices.push(minifiedNotice(minified));
  if (profiles.nextOwners.length > 0) {
    notices.push(profileNotice(
      "Next profile: excluding Next build output", profiles.nextOwners,
    ));
  }
  if (profiles.payloadOwners.length > 0) {
    notices.push(profileNotice(
      "Payload profile: excluding generated Payload types, import map, admin route group, "
        + "migrations, and seed data",
      profiles.payloadOwners,
    ));
  }
}

function appendRuntimeNotice(root: string, languages: readonly Language[], notices: string[]): void {
  if (!languages.includes("python")) return;
  const target = pythonTarget(root);
  if (target === undefined || !isAtLeast(target.version, "3.14")) return;
  const newer = isAtLeast(target.version, PYTHON_314_VERSION)
    && target.version !== PYTHON_314_VERSION.slice(0, PYTHON_314_VERSION.lastIndexOf("."));
  const qualifier = newer ? ", newer than the image" : "";
  notices.push(`python: targeting ${target.version} (from ${target.source})${qualifier}; `
    + `tools run on CPython ${PYTHON_314_VERSION}`);
}

function resolvedExclusions(
  consumer: ConsumerConfig,
  minified: string[],
  profileExclusions: readonly string[],
): string[] {
  return [...consumer.exclude ?? [], ...minified, ...profileExclusions];
}

export function loadConfig(root: string): ResolvedConfig {
  const consumer = readYaml(root);
  const isDrupal = isDrupalProject(root);
  const languageResolution = resolveLanguages(root, consumer);
  const initialPaths = resolvePaths(
    root,
    consumer,
    languageResolution.languages,
    { isDrupal, profileExclusions: [] },
  );
  const initialProfiles = resolveProfiles(root, initialPaths.paths.ts ?? []);
  const pathResolution = initialProfiles.exclusions.length === 0 ? initialPaths : resolvePaths(
    root,
    consumer,
    languageResolution.languages,
    { isDrupal, profileExclusions: initialProfiles.exclusions },
  );
  const languages = languageResolution.languages.filter(
    (language) => pathResolution.paths[language] !== undefined,
  );
  const paths = pathResolution.paths;
  const profiles = resolveProfiles(root, paths.ts ?? []);
  const resolvedProfileExclusions = profiles.exclusions;
  const minified = resolveMinifiedFiles(root, paths, consumer.exclude ?? [], resolvedProfileExclusions);
  appendProfileNotices(pathResolution.notices, minified, profiles);
  appendRuntimeNotice(root, languages, pathResolution.notices);
  const architecture = resolveArchitecture(root, languages, consumer);
  const target = pythonTarget(root);
  const resolved = {
    isDrupal,
    languages,
    paths,
    exclude: resolvedExclusions(consumer, minified, resolvedProfileExclusions),
    disabled: consumer.checks?.disabled ?? [],
    architecture,
    notices: pathResolution.notices,
  };
  return {
    root,
    ...resolved,
    ...(consumer.report ? { report: consumer.report } : {}),
    configHash: configHash(target === undefined || !languages.includes("python")
      ? resolved
      : { ...resolved, runtime: { python: target.version } }),
  };
}
