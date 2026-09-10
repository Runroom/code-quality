import type { CliDeps } from "../deps.ts";
import { checkCommand } from "./check.ts";

export interface BaselineOptions {
  all?: boolean | undefined;
  artifacts?: string | undefined;
}

export function baselineCommand(deps: CliDeps, options: BaselineOptions = {}): Promise<number> {
  return checkCommand([], "update", deps, options);
}
