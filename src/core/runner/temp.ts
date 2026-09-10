import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import type { GeneratedFile } from "../types.ts";

function removeTemp(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && "then" in value;
}

export function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "code-quality-"));
  try {
    const result = fn(dir);
    if (isPromiseLike(result)) {
      return Promise.resolve(result).finally(() => removeTemp(dir)) as T;
    }
    removeTemp(dir);
    return result;
  } catch (error) {
    removeTemp(dir);
    throw error;
  }
}

export function writeGenerated(dir: string, files: GeneratedFile[]): void {
  for (const file of files) {
    const target = join(dir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, "utf8");
  }
}
