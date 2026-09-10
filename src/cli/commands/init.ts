import { detectLanguages } from "../../core/config/detect.ts";
import { fail } from "../../core/errors.ts";
import { loadConfig } from "../../core/config/load.ts";
import type { CliDeps } from "../deps.ts";
import { scaffold } from "../scaffold.ts";
import { checkCommand } from "./check.ts";

export async function initCommand(deps: CliDeps): Promise<number> {
  if (detectLanguages(deps.cwd).length === 0) {
    return fail(
      `No supported manifest (package.json, composer.json, pyproject.toml, setup.py) found in ${deps.cwd}`,
    );
  }
  const config = loadConfig(deps.cwd);
  scaffold(deps.cwd, config, (line) => deps.stdout(line + "\n"));
  return checkCommand([], "initialize", deps, { keepExisting: true, config });
}
