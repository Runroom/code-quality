import { createHash } from "node:crypto";

import { fail } from "../errors.ts";
import { POLICY_VERSION } from "./policy.ts";
import { LANGUAGES } from "./schema.ts";
import type { Language } from "./schema.ts";
import type { ArchitectureSelection, ResolvedConfig } from "./types.ts";

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareDisabled(left: unknown, right: unknown): number {
  const leftId = isRecord(left) && typeof left.id === "string" ? left.id : "";
  const rightId = isRecord(right) && typeof right.id === "string" ? right.id : "";
  return leftId.localeCompare(rightId);
}

function normalizeArray(values: readonly unknown[], property?: string): unknown[] {
  const normalized = values.map((value) => normalize(value));
  if (property === "disabled") return normalized.toSorted(compareDisabled);
  if (normalized.every((value) => typeof value === "string")) {
    return [...new Set(normalized)].toSorted();
  }
  return normalized;
}

function normalize(value: unknown, property?: string): unknown {
  if (Array.isArray(value)) return normalizeArray(value, property);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .toSorted()
      .map((key) => [key, normalize(value[key], key)]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value)) ?? "null";
}

function serializeSelection(selection: ArchitectureSelection | undefined): string | null {
  if (selection === undefined || selection.kind === "skip") return null;
  if (selection.kind === "missing") {
    return fail(`Cannot hash configuration with missing architecture rules file '${selection.rulesFile}'.`);
  }
  return selection.rulesFile;
}

function serializeArchitecture(
  architecture: ResolvedConfig["architecture"],
): Partial<Record<Language, string | null>> {
  const serialized: Partial<Record<Language, string | null>> = {};
  for (const language of LANGUAGES) {
    if (architecture[language] !== undefined) {
      serialized[language] = serializeSelection(architecture[language]);
    }
  }
  return serialized;
}

export function configHash(resolved: Omit<ResolvedConfig, "configHash" | "root">): string {
  const canonical = {
    ...resolved,
    architecture: serializeArchitecture(resolved.architecture),
  };
  return createHash("sha256")
    .update(`${POLICY_VERSION}\n${canonicalJson(canonical)}`)
    .digest("hex");
}
