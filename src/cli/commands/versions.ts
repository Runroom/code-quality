import type { ToolPin } from "../../core/types.ts";
import { ADAPTERS, LIBRARY_PINS, TOOL_PINS } from "../../registry.ts";
import { createStyle, type Style } from "../style.ts";

interface LibraryPin { name: string; version: string; }

const LANGUAGE_GROUPS = [
  { language: "ts", label: "TS/JS" },
  { language: "php", label: "PHP" },
  { language: "python", label: "Python" },
] as const;

function pinLine(name: string, version: string, width: number, style: Style): string {
  return `   ${name.padEnd(width)}  ${style.dim(version)}`;
}

export function versionsText(
  pins: readonly ToolPin[] = TOOL_PINS,
  libraries: readonly LibraryPin[] = LIBRARY_PINS,
  style: Style = createStyle(false),
): string[] {
  const lines = [` ${style.bold("Tools")}`];
  const remaining = new Set(pins);
  const toolWidth = Math.max(...pins.map((pin) => pin.bin.length), 0);
  for (const group of LANGUAGE_GROUPS) {
    const bins = new Set(ADAPTERS
      .filter((adapter) => adapter.language === group.language)
      .map((adapter) => adapter.tool.bin));
    const selected = pins.filter((pin) => remaining.has(pin) && bins.has(pin.bin));
    if (selected.length === 0) continue;
    lines.push(` ${style.bold(group.label)}`);
    for (const pin of selected) {
      lines.push(pinLine(pin.bin, pin.version, toolWidth, style));
      remaining.delete(pin);
    }
  }
  if (remaining.size > 0) {
    lines.push(` ${style.bold("Other")}`);
    for (const pin of remaining) {
      lines.push(pinLine(pin.bin, pin.version, toolWidth, style));
    }
  }
  lines.push(` ${style.bold("Libraries")}`);
  const libraryWidth = Math.max(...libraries.map((pin) => pin.name.length), 0);
  for (const pin of libraries) {
    lines.push(pinLine(pin.name, pin.version, libraryWidth, style));
  }
  return lines;
}
