import { isAtLeast, PYTHON_314_BIN, pythonTarget } from "../../core/config/runtime.ts";
import type { CheckContext, ToolInvocation } from "../../core/types.ts";

export const PYTHON_VENV_TOOLS = [
  "ruff", "complexipy", "vulture", "deptry", "lint-imports",
] as const;

export function pythonInvocation(
  ctx: CheckContext,
  invocation: ToolInvocation,
): ToolInvocation {
  const target = pythonTarget(ctx.root);
  if (target === undefined || !isAtLeast(target.version, "3.14")) return invocation;
  return {
    ...invocation,
    env: {
      ...invocation.env,
      PATH: [PYTHON_314_BIN, process.env.PATH].filter(Boolean).join(":"),
    },
  };
}
