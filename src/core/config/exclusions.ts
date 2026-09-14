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

export const PAYLOAD_NEXT_EXCLUSIONS = [
  "**/payload-types.ts",
  "**/importMap.js",
  "**/app/[(]payload[)]/**",
  "**/migrations/**",
  "**/migrations-*/**",
  "**/seed/**",
  ".next/**",
  "next-env.d.ts",
] as const;

export function payloadNextExclusions(tsRoots: readonly string[]): string[] {
  const scoped = PAYLOAD_NEXT_EXCLUSIONS.slice(0, -2);
  return [
    ...tsRoots.flatMap((root) => scoped.map((pattern) => `${root}/${pattern}`)),
    ...PAYLOAD_NEXT_EXCLUSIONS.slice(-2),
  ];
}

export function isExcluded(file: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => picomatch(pattern, { dot: true })(file));
}
