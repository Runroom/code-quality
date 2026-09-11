import type { RunDeps } from "../core/runner/run-adapter.ts";
import type { Style } from "../cli/style.ts";

export interface ReportDeps {
  run: RunDeps;
  cwd: string;
  output: string;
  stdout: (value: string) => void;
  stderr: (value: string) => void;
  style: Style;
}
