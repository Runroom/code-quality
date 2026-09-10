import { isAbsolute, relative, sep } from "node:path";

import { fail } from "../../core/errors.ts";
import { BUILTIN_EXCLUSIONS, TEST_EXCLUSIONS } from "../../core/config/exclusions.ts";
import type { ResolvedConfig } from "../../core/config/types.ts";

function portable(path: string): string {
  return path.split(sep).join("/");
}

export function relativize(root: string, file: string): string {
  if (!isAbsolute(file)) return portable(file);
  const result = portable(relative(root, file));
  if (result === ".." || result.startsWith("../") || isAbsolute(result)) {
    return fail(`${file} escapes repository root ${root}`);
  }
  return result;
}

export function relativizeFrom(root: string, file: string, mountRoot = "/work"): string {
  if (!isAbsolute(file)) return relativize(root, file);
  const rooted = portable(relative(root, file));
  if (rooted !== ".." && !rooted.startsWith("../") && !isAbsolute(rooted)) return rooted;
  const mounted = portable(relative(mountRoot, file));
  if (mounted !== ".." && !mounted.startsWith("../") && !isAbsolute(mounted)) {
    return mounted;
  }
  return relativize(root, file);
}

function within(file: string, path: string): boolean {
  const normalized = path.replace(/\/$/u, "");
  return file === normalized || file.startsWith(`${normalized}/`);
}

export function isInScope(file: string, paths: readonly string[]): boolean {
  return paths.some((path) => within(file, path));
}

export function assertInScope(
  file: string,
  paths: readonly string[],
  extra: readonly string[] = [],
): void {
  if (isInScope(file, paths) || extra.includes(file)) return;
  return fail(`${file} is outside configured paths`);
}

export function excludeGlobs(config: ResolvedConfig, withTests: boolean): string[] {
  const tests = withTests ? TEST_EXCLUSIONS : [];
  return [...BUILTIN_EXCLUSIONS, ...config.exclude, ...tests];
}
