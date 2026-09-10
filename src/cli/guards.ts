import { fail } from "../core/errors.ts";
import type { Mode } from "../core/gate/state.ts";

export function assertNotInCi(env: NodeJS.ProcessEnv, action: string): void {
  if (env.GITHUB_ACTIONS === "true") {
    return fail(
      `Refusing \`${action}\` in GitHub Actions: baselines change only through a reviewed local commit.`,
    );
  }
  if (["true", "1", "yes"].includes(env.CI ?? "")) {
    return fail(`Refusing ${action} in CI (CI=${env.CI})`);
  }
}

export function resolveMode(flags: { update?: boolean; initialize?: boolean }): Mode {
  if (flags.update && flags.initialize) {
    return fail("--update and --initialize are mutually exclusive");
  }
  if (flags.update) return "update";
  if (flags.initialize) return "initialize";
  return "check";
}
