import { spawnSync } from "node:child_process";

import { fail } from "../errors.ts";
import type { ToolInvocation, ToolResult } from "../types.ts";

const MAX_BUFFER = 256 * 1024 * 1024;
const INHERITED_ENV = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TERM",
  "NO_COLOR",
  "XDG_CACHE_HOME",
  "COMPOSER_HOME",
  "COMPOSER_ALLOW_SUPERUSER",
  "PYTHONPATH",
  "PYTHONDONTWRITEBYTECODE",
  "NODE_OPTIONS",
] as const;

function toolEnvironment(invocation: ToolInvocation): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of INHERITED_ENV) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return {
    ...env,
    CI: "true",
    FALLOW_TELEMETRY_DISABLED: "1",
    JSCPD_NO_TIPS: "1",
    ...invocation.env,
  };
}

function stderrTail(stderr: string): string {
  const text = stderr.trim();
  return text.length === 0 ? "" : `: ${text.slice(-2000)}`;
}

function processError(invocation: ToolInvocation, error: Error): never {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    return fail(`${invocation.bin} not found`);
  }
  return fail(`${invocation.bin} could not start: ${error.message}`);
}

function accepted(invocation: ToolInvocation, exitCode: number): boolean {
  return invocation.exitCodes === "any" || invocation.exitCodes.includes(exitCode);
}

export function spawnTool(invocation: ToolInvocation, root: string): ToolResult {
  const result = spawnSync(invocation.bin, invocation.args, {
    cwd: invocation.cwd ?? root,
    encoding: "utf8",
    env: toolEnvironment(invocation),
    maxBuffer: MAX_BUFFER,
  });
  if (result.error) return processError(invocation, result.error);
  if (result.signal) return fail(`${invocation.bin} terminated by ${result.signal}`);
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const exitCode = result.status ?? 1;
  if (!accepted(invocation, exitCode)) {
    return fail(`${invocation.bin} exited with ${exitCode}${stderrTail(stderr)}`);
  }
  return { stdout, stderr, exitCode };
}
