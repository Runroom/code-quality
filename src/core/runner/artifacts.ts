import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ARTIFACT_ROOT = "artifacts/quality";

export function artifactDir(root: string, id: string): string {
  const directory = join(root, ARTIFACT_ROOT, id);
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function writeArtifact(dir: string, name: string, content: string): string {
  const file = join(dir, name);
  writeFileSync(file, content, "utf8");
  return file;
}
