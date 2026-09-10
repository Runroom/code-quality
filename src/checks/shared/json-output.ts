import { fail } from "../../core/errors.ts";

export function parseJsonOutput(stdout: string, toolName: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    const lines = stdout.split(/\r?\n/u);
    const start = lines.findIndex((line) => line.startsWith("{") || line.startsWith("["));
    if (start === -1) return fail(`${toolName}: no JSON document in output`);
    return JSON.parse(lines.slice(start).join("\n")) as unknown;
  }
}
