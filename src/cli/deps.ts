import type { RunDeps } from "../core/runner/run-adapter.ts";
import type { CheckAdapter } from "../core/types.ts";
import type { Style } from "./style.ts";

export interface CliDeps {
  registry: readonly CheckAdapter[];
  run: RunDeps;
  env: NodeJS.ProcessEnv;
  cwd: string;
  stdout: (value: string) => void;
  stderr: (value: string) => void;
  style: Style;
}
