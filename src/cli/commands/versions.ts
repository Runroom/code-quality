import type { ToolPin } from "../../core/types.ts";
import {
  ADAPTERS,
  LIBRARY_PINS,
  RUNTIME_PINS,
  RUNTIME_PRESENCE,
  TOOL_PINS,
} from "../../registry.ts";
import { createStyle, type Style } from "../style.ts";

interface LibraryPin { name: string; version: string; }
interface RenderContext { lines: string[]; style: Style; }
interface SectionEntry { name: string; value: string; }

const LANGUAGE_GROUPS = [
  { language: "ts", label: "TS/JS" },
  { language: "php", label: "PHP" },
  { language: "python", label: "Python" },
] as const;

function pinLine(name: string, version: string, width: number, style: Style): string {
  return `   ${name.padEnd(width)}  ${style.dim(version)}`;
}

function appendSection(
  lines: string[],
  label: string,
  entries: readonly SectionEntry[],
  style: Style,
): void {
  if (entries.length === 0) return;
  lines.push(` ${style.bold(label)}`);
  const width = Math.max(...entries.map((entry) => entry.name.length), 0);
  for (const entry of entries) lines.push(pinLine(entry.name, entry.value, width, style));
}

function appendLanguageGroups(
  context: RenderContext,
  pins: readonly ToolPin[],
  remaining: Set<ToolPin>,
): void {
  for (const group of LANGUAGE_GROUPS) {
    const bins = new Set(ADAPTERS
      .filter((adapter) => adapter.language === group.language)
      .map((adapter) => adapter.tool.bin));
    const selected = pins.filter((pin) => remaining.has(pin) && bins.has(pin.bin));
    if (selected.length === 0) continue;
    appendSection(context.lines, group.label, selected.map((pin) => ({
      name: pin.bin, value: pin.version,
    })), context.style);
    for (const pin of selected) remaining.delete(pin);
  }
}

function appendOther(
  context: RenderContext,
  remaining: Set<ToolPin>,
): void {
  appendSection(context.lines, "Other", [...remaining].map((pin) => ({
    name: pin.bin, value: pin.version,
  })), context.style);
}

interface VersionsOptions {
  pins?: readonly ToolPin[];
  libraries?: readonly LibraryPin[];
  runtime?: readonly ToolPin[];
  style?: Style;
}

export function versionsText(options: VersionsOptions = {}): string[] {
  const pins = options.pins ?? TOOL_PINS;
  const libraries = options.libraries ?? LIBRARY_PINS;
  const runtime = options.runtime ?? RUNTIME_PINS;
  const style = options.style ?? createStyle(false);
  const lines = [` ${style.bold("Tools")}`];
  const remaining = new Set(pins);
  const context = { lines, style };
  appendLanguageGroups(context, pins, remaining);
  appendOther(context, remaining);
  appendSection(lines, "Runtime", [
    ...runtime.map((pin) => ({ name: pin.bin, value: pin.version })),
    ...RUNTIME_PRESENCE.map((bin) => ({ name: bin, value: "presence (verified by doctor)" })),
  ], style);
  appendSection(lines, "Libraries", libraries.map((pin) => ({
    name: pin.name, value: pin.version,
  })), style);
  return lines;
}
