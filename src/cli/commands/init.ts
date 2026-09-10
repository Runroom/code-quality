import { loadConfig } from "../../core/config/load.ts";
import type { CliDeps } from "../deps.ts";
import { scaffold } from "../scaffold.ts";
import { checkCommand } from "./check.ts";

export async function initCommand(deps: CliDeps): Promise<number> {
  const config = loadConfig(deps.cwd);
  if (config.languages.length === 0) {
    return checkCommand([], "initialize", deps, { keepExisting: true, config });
  }
  scaffold(deps.cwd, config, (line) => deps.stdout(line + "\n"));
  return checkCommand([], "initialize", deps, { keepExisting: true, config });
}
