import { loadConfig } from "../../core/config/load.ts";
import type { CliDeps } from "../deps.ts";
import { scaffold } from "../scaffold.ts";
import { checkCommand } from "./check.ts";
import { GLYPH } from "../style.ts";
import { fieldLine, sanitizeLine } from "../render.ts";
import { CLI_VERSION } from "../version.ts";

export interface InitOptions {
  artifacts?: string | undefined;
}

export async function initCommand(deps: CliDeps, options: InitOptions = {}): Promise<number> {
  const config = loadConfig(deps.cwd);
  const title = deps.style.bold(sanitizeLine(`code-quality ${CLI_VERSION}`));
  const detail = deps.style.dim(sanitizeLine(` · init · ${config.languages.join(", ")}`));
  deps.stdout(` ${title}${detail}\n`);
  if (config.languages.length === 0) {
    deps.stdout("\n");
    return checkCommand([], "initialize", deps, {
      ...options, keepExisting: true, config, header: false,
    });
  }
  scaffold(deps.cwd, config, (line) => {
    if (line.startsWith("Created ") || line.startsWith("Updated ")) {
      deps.stdout(` ${deps.style.green(GLYPH.pass)} ${sanitizeLine(line)}\n`);
    } else if (line.startsWith("Kept ")) {
      deps.stdout(` ${deps.style.dim(`${GLYPH.bullet} ${sanitizeLine(line)}`)}\n`);
    } else {
      deps.stdout(`${line}\n`);
    }
  });
  deps.stdout("\n");
  const code = await checkCommand([], "initialize", deps, {
    ...options, keepExisting: true, config, header: false,
  });
  if (code === 0) {
    deps.stdout("\n");
    deps.stdout(`${fieldLine(
      "Next",
      "review .code-quality.yml, run make quality, commit quality/",
      deps.style,
      true,
    )}\n`);
  }
  return code;
}
