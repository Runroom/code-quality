import type { CliDeps } from "../deps.ts";
import { checkCommand } from "./check.ts";

export function baselineCommand(deps: CliDeps): Promise<number> {
  return checkCommand([], "update", deps);
}
