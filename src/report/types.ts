import type { RunDeps } from "../core/runner/run-adapter.ts";

export interface ReportDeps {
  run: RunDeps;
  cwd: string;
  stderr: (value: string) => void;
}
