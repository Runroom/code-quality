import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

export function resolveModuleFile(root: string, paths: readonly string[], moduleId: string): string {
  const modulePath = moduleId.split(".").join("/");
  for (const sourcePath of paths) {
    const moduleFile = join(root, sourcePath, `${modulePath}.py`);
    if (existsSync(moduleFile)) return relative(root, moduleFile).split(sep).join("/");
    const packageFile = join(root, sourcePath, modulePath, "__init__.py");
    if (existsSync(packageFile)) return relative(root, packageFile).split(sep).join("/");
  }
  return moduleId;
}
