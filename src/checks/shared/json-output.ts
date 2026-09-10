import { fail } from "../../core/errors.ts";

const MAX_LINES = 3;
const MAX_LINE_LENGTH = 200;

function outputSummary(stdout: string, stderr: string): string {
  const lines = `${stdout}\n${stderr}`.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_LINES)
    .map((line) => line.slice(0, MAX_LINE_LENGTH));
  return lines.length === 0 ? "" : `: ${lines.join(" | ")}`;
}

export function parseJsonOutput(stdout: string, toolName: string, stderr = ""): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    const lines = stdout.split(/\r?\n/u);
    const start = lines.findIndex((line) => line.startsWith("{") || line.startsWith("["));
    if (start === -1) {
      return fail(`${toolName}: no JSON document in output${outputSummary(stdout, stderr)}`);
    }
    return JSON.parse(lines.slice(start).join("\n")) as unknown;
  }
}
