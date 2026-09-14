import { resolve } from "node:path";

import { reportCommand as runReports } from "../../report/advisory.ts";
import type { CliDeps } from "../deps.ts";

interface ReportOptions {
  output?: string | undefined;
  coverage?: string | undefined;
}

const DEFAULT_OUTPUT = "artifacts/quality";

export function reportCommand(deps: CliDeps, options: ReportOptions = {}): Promise<number> {
  return runReports({
    ...deps,
    output: resolve(deps.cwd, options.output ?? DEFAULT_OUTPUT),
    coverage: options.coverage,
  });
}
