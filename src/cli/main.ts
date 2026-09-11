import { createAnchorService } from "../core/anchor/service.ts";
import { spawnTool } from "../core/runner/spawn.ts";
import { verifyTool } from "../core/runner/verify.ts";
import { runCli } from "./program.ts";
import type { CliDeps } from "./deps.ts";
import { ADAPTERS } from "../registry.ts";
import { colorFlagFromArgv, createStyle, resolveColor } from "./style.ts";

const deps: CliDeps = {
  registry: ADAPTERS,
  run: {
    spawn: spawnTool,
    verify: verifyTool,
    anchor: createAnchorService(),
    env: process.env,
  },
  env: process.env,
  cwd: process.cwd(),
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
  style: createStyle(resolveColor({
    flag: colorFlagFromArgv(process.argv),
    env: process.env,
    isTTY: process.stdout.isTTY === true,
  })),
};

process.exitCode = await runCli(process.argv, deps);
