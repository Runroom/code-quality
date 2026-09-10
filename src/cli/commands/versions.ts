import { LIBRARY_PINS, TOOL_PINS } from "../../registry.ts";
import type { ToolPin } from "../../core/types.ts";

interface LibraryPin {
  name: string;
  version: string;
}

function toolLines(pins: readonly ToolPin[]): string[] {
  return pins.map(({ bin, version }) => `${bin} ${version}`);
}

function libraryLines(libraries: readonly LibraryPin[]): string[] {
  return libraries.map(({ name, version }) => `${name} ${version} (library)`);
}

export function versionsText(
  pins: readonly ToolPin[] = TOOL_PINS,
  libraries: readonly LibraryPin[] = LIBRARY_PINS,
): string {
  return [...toolLines(pins), ...libraryLines(libraries)].join("\n");
}
