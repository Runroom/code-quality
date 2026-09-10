import { reportCommand as runReports } from "../../report/advisory.ts";
import type { CliDeps } from "../deps.ts";

export function reportCommand(deps: CliDeps): Promise<number> {
  return runReports(deps);
}
