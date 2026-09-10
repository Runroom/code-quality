import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { fail } from "../../core/errors.ts";
import type { CheckContext, GeneratedFile } from "../../core/types.ts";

export interface ToolOutput {
  path: string;
  clear(): GeneratedFile[];
  outputs(): string[];
  read(toolName: string): string;
}

export function toolOutput(ctx: CheckContext, fileName: string): ToolOutput {
  const path = join(ctx.artifactDir, fileName);
  return {
    path,
    clear: () => {
      rmSync(path, { force: true });
      return [];
    },
    outputs: () => [path],
    read: (toolName) => {
      if (!existsSync(path)) return fail(`${toolName} did not write ${fileName}`);
      return readFileSync(path, "utf8");
    },
  };
}
