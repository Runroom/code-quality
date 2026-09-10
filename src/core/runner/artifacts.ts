import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function artifactDir(base: string, id: string): string {
  const directory = join(base, id);
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function writeArtifact(dir: string, name: string, content: string): string {
  const file = join(dir, name);
  writeFileSync(file, content, "utf8");
  return file;
}
