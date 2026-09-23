import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { parse as parseToml } from "smol-toml";

import { readRecord, uvWorkspaceMemberDirectories } from "./workspaces.ts";

export const PYTHON_314_BIN = "/opt/venv314/bin";
export const PYTHON_314_VERSION = "3.14.7";

export interface PythonTarget {
  version: string;
  source: string;
}

function majorMinor(value: string): string | undefined {
  const match = /^(?<major>\d+)\.(?<minor>\d+)/u.exec(value);
  return match?.groups ? `${match.groups.major}.${match.groups.minor}` : undefined;
}

export function compareMajorMinor(left: string, right: string): number {
  const [leftMajor, leftMinor] = left.split(".").map(Number);
  const [rightMajor, rightMinor] = right.split(".").map(Number);
  return leftMajor! - rightMajor! || leftMinor! - rightMinor!;
}

function maximumVersion(versions: readonly string[]): string | undefined {
  return versions.toSorted(compareMajorMinor).at(-1);
}

type LowerPythonBound =
  | { kind: "invalid" }
  | { kind: "bound"; version: string }
  | { kind: "none" };

const MAX_PYTHON_VERSION_FILE_SIZE = 4 * 1024;

function pinnedPythonVersion(value: string): string | undefined {
  if (/^(?:pypy|graalpy)/iu.test(value)) return undefined;
  const versionPattern = "\\d+\\.\\d+(?:\\.\\d+)?(?:a\\d+|b\\d+|rc\\d+)?";
  const exact = new RegExp(`^(?<version>${versionPattern})$`, "u");
  const uvPin = new RegExp(`^(?<version>${versionPattern})(?:-[\\w.-]+)?$`, "u");
  const candidate = value.startsWith("cpython@")
    ? exact.exec(value.slice("cpython@".length))
    : value.startsWith("cpython-")
      ? uvPin.exec(value.slice("cpython-".length))
      : exact.exec(value);
  const version = candidate?.groups?.version;
  return version ? majorMinor(version) : undefined;
}

function pythonVersionFile(root: string): PythonTarget | undefined {
  const path = join(root, ".python-version");
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_PYTHON_VERSION_FILE_SIZE) return undefined;
    const value = readFileSync(path, "utf8").split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line !== "" && !line.startsWith("#"));
    const version = value === undefined ? undefined : pinnedPythonVersion(value);
    return version === undefined ? undefined : { version, source: ".python-version" };
  } catch {
    return undefined;
  }
}

function lowerPythonBound(clause: string): LowerPythonBound {
  const match = /^(?<operator>>=|<=|~=|==|!=|>|<)\s*(?<version>\d+(?:\.\d+){0,2}(?:\.\*)?)$/u.exec(clause);
  if (!match?.groups) return { kind: "invalid" };
  if (![">=", ">", "~=", "=="].includes(match.groups.operator!)) return { kind: "none" };
  const version = majorMinor(match.groups.version!);
  return version === undefined ? { kind: "invalid" } : { kind: "bound", version };
}

function requiresPythonField(root: string): string | undefined {
  const project = readRecord(join(root, "pyproject.toml"), parseToml)?.project;
  if (typeof project !== "object" || project === null || Array.isArray(project)) return undefined;
  const field = (project as Record<string, unknown>)["requires-python"];
  return typeof field === "string" ? field : undefined;
}

function requiresPython(root: string): PythonTarget | undefined {
  const field = requiresPythonField(root);
  if (field === undefined) return undefined;
  const bounds: string[] = [];
  for (const clause of field.split(",").map((value) => value.trim())) {
    const bound = lowerPythonBound(clause);
    if (bound.kind === "invalid") return undefined;
    if (bound.kind === "bound") bounds.push(bound.version);
  }
  const version = maximumVersion(bounds);
  return version === undefined ? undefined : { version, source: "requires-python" };
}

function localPythonTarget(root: string): PythonTarget | undefined {
  return pythonVersionFile(root) ?? requiresPython(root);
}

export function pythonTarget(root: string): PythonTarget | undefined {
  const local = localPythonTarget(root);
  if (local !== undefined) return local;
  const members = uvWorkspaceMemberDirectories(root).flatMap((member) => {
    const target = localPythonTarget(join(root, member));
    return target === undefined ? [] : [{
      version: target.version,
      source: `${member}/${target.source}`,
    }];
  });
  return members.toSorted((left, right) => compareMajorMinor(right.version, left.version))[0];
}

export function isAtLeast(version: string, minimum: string): boolean {
  return compareMajorMinor(version, minimum) >= 0;
}
