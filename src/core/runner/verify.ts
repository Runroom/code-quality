import { fail } from "../errors.ts";
import { spawnTool } from "./spawn.ts";
import type { ToolPin, ToolResult } from "../types.ts";

type VersionProbe = (bin: string) => ToolResult | string;

export function parseVersion(output: string): string {
  const line = output.split(/\r?\n/).find((value) => value.trim().length > 0);
  const version = line?.match(/\d+\.\d+(?:\.\d+)?/)?.[0];
  if (!version) return fail("Could not parse tool version.");
  return version;
}

function probeOutput(probe: VersionProbe, bin: string): string {
  const result = probe(bin);
  return typeof result === "string" ? result : result.stdout;
}

export function verifyTool(
  pin: ToolPin,
  probe: VersionProbe = (bin) =>
    spawnTool({ bin, args: ["--version"], exitCodes: [0] }, process.cwd()),
): void {
  const actual = parseVersion(probeOutput(probe, pin.bin));
  if (actual !== pin.version) {
    return fail(
      `Expected ${pin.bin} ${pin.version}, received ${actual}; review the tool upgrade and baselines together.`,
    );
  }
}
