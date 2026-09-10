import { join } from "node:path";

import { createAnchorService, type AnchorService } from "../../core/anchor/service.ts";
import { parseVersion } from "../../core/runner/verify.ts";
import { GRAMMAR_ASSETS, LIBRARY_PINS, TOOL_PINS } from "../../registry.ts";

export interface DoctorProbe {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorDeps {
  probe: (bin: string) => string;
  exists: (path: string) => boolean;
  readInstalled: (path: string) => unknown;
  assets: string;
}

interface InstalledPackage {
  name?: unknown;
  version?: unknown;
}

interface InstalledData {
  packages?: unknown;
}

interface GrammarSource {
  file: string;
  source: string;
}

const GRAMMAR_SOURCES: readonly GrammarSource[] = [
  { file: "doctor.ts", source: "function smoke() { return 1; }\n" },
  { file: "doctor.tsx", source: "function smoke() { return <div />; }\n" },
  { file: "doctor.js", source: "function smoke() { return 1; }\n" },
  { file: "doctor.php", source: "<?php function smoke(): int { return 1; }\n" },
  { file: "doctor.py", source: "def smoke():\n    return 1\n" },
];

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function versionResult(name: string, expected: string, actual: string): DoctorProbe {
  if (actual === expected) return { name, ok: true, detail: actual };
  return { name, ok: false, detail: `expected ${expected}, received ${actual}` };
}

function versionProbe(
  pin: { bin: string; version: string },
  deps: DoctorDeps,
): DoctorProbe {
  try {
    return versionResult(pin.bin, pin.version, parseVersion(deps.probe(pin.bin)));
  } catch (error) {
    return { name: pin.bin, ok: false, detail: errorDetail(error) };
  }
}

function asInstalledData(value: unknown): InstalledData {
  return typeof value === "object" && value !== null ? value as InstalledData : {};
}

function packageVersion(value: unknown, name: string): string | undefined {
  const packages = asInstalledData(value).packages;
  if (!Array.isArray(packages)) return undefined;
  const match = packages.find((item) => {
    if (typeof item !== "object" || item === null) return false;
    const packageInfo = item as InstalledPackage;
    return packageInfo.name === name;
  }) as InstalledPackage | undefined;
  return typeof match?.version === "string" ? match.version : undefined;
}

function libraryProbe(
  pin: (typeof LIBRARY_PINS)[number],
  deps: DoctorDeps,
): DoctorProbe {
  try {
    const actual = packageVersion(deps.readInstalled(pin.installed), pin.name) ?? "unknown";
    return versionResult(pin.name, pin.version, actual);
  } catch (error) {
    return { name: pin.name, ok: false, detail: errorDetail(error) };
  }
}

function assetProbe(asset: string, deps: DoctorDeps): DoctorProbe {
  const path = join(deps.assets, asset);
  return deps.exists(path)
    ? { name: asset, ok: true, detail: "present" }
    : { name: asset, ok: false, detail: `missing ${path}` };
}

export function runDoctor(deps: DoctorDeps): DoctorProbe[] {
  const tools = TOOL_PINS.map((pin) => versionProbe(pin, deps));
  const libraries = LIBRARY_PINS.map((pin) => libraryProbe(pin, deps));
  const assets = GRAMMAR_ASSETS.map((asset) => assetProbe(asset, deps));
  return [...tools, ...libraries, ...assets];
}

async function grammarProbe(service: AnchorService, input: GrammarSource): Promise<DoctorProbe> {
  try {
    const byteOffset = input.source.indexOf("smoke");
    await service.anchor(input.file, input.source, byteOffset, false);
    return { name: `grammar:${input.file}`, ok: true, detail: "parsed" };
  } catch (error) {
    return { name: `grammar:${input.file}`, ok: false, detail: errorDetail(error) };
  }
}

export async function grammarProbes(assets: string): Promise<DoctorProbe[]> {
  const service = createAnchorService(assets);
  const probes: DoctorProbe[] = [];
  for (const source of GRAMMAR_SOURCES) probes.push(await grammarProbe(service, source));
  return probes;
}

export function doctorLine(probe: DoctorProbe): string {
  return `${probe.ok ? "OK  " : "FAIL "}${probe.name} ${probe.detail}`;
}
