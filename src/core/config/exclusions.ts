import picomatch from "picomatch";

export const TEST_EXCLUSIONS = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
  "**/tests/**",
  "**/test/**",
  "**/*Test.php",
  "**/test_*.py",
  "**/*_test.py",
  "**/conftest.py",
] as const;

export const BUILTIN_EXCLUSIONS = [
  "**/node_modules/**",
  "**/vendor/**",
  "**/.venv/**",
  "**/dist/**",
  "**/artifacts/**",
  "**/public/build/**",
  "**/*.min.js",
  "**/*.min.css",
  "**/web/core/**",
  "**/docroot/core/**",
  "**/modules/contrib/**",
  "**/themes/contrib/**",
  "**/profiles/contrib/**",
  "**/libraries/**",
  "**/sites/*/files/**",
  "**/drush/**",
  "**/ddev.provision/**",
  "**/var/**",
] as const;

export const PAYLOAD_EXCLUSIONS = [
  "**/payload-types.ts",
  "**/importMap.js",
  "**/app/[(]payload[)]/**",
  "**/migrations/**",
  "**/migrations-*/**",
  "**/seed/**",
] as const;

export const NEXT_EXCLUSIONS = [".next/**", "next-env.d.ts"] as const;
export const PAYLOAD_NEXT_EXCLUSIONS = [...PAYLOAD_EXCLUSIONS, ...NEXT_EXCLUSIONS] as const;

function prefix(owner: string, pattern: string): string {
  return owner === "." ? pattern : `${owner}/${pattern}`;
}

export function nextExclusions(owner: string): string[] {
  return NEXT_EXCLUSIONS.map((pattern) => prefix(owner, pattern));
}

export function payloadExclusions(tsRoots: readonly string[]): string[] {
  return tsRoots.flatMap((root) => [
    ...PAYLOAD_EXCLUSIONS.map((pattern) => `${root}/${pattern}`),
    ...(root.split("/").at(-1) === "app" ? [`${root}/[(]payload[)]/**`] : []),
  ]);
}

export function payloadNextExclusions(tsRoots: readonly string[]): string[] {
  return [...payloadExclusions(tsRoots), ...nextExclusions(".")];
}

export function isExcluded(file: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => picomatch(pattern, { dot: true })(file));
}
