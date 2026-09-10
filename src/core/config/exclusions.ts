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
] as const;

export function isExcluded(file: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => picomatch(pattern, { dot: true })(file));
}
