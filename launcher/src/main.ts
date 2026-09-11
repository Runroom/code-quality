import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import {
  assertMountableCwd,
  buildDockerArgs,
  imageFor,
  LauncherError,
  resolveOutcome,
} from "./args.ts";

try {
  const require = createRequire(import.meta.url);
  const { version } = require("../package.json") as { version: string };
  const env = process.env;
  const cwd = process.cwd();
  const image = imageFor(version, env);
  assertMountableCwd(cwd);
  const args = buildDockerArgs({
    argv: process.argv.slice(2),
    cwd,
    env,
    platform: process.platform,
    ...(process.getuid ? { uid: process.getuid() } : {}),
    ...(process.getgid ? { gid: process.getgid() } : {}),
    image,
  });
  const result = spawnSync("docker", args, { stdio: "inherit" });
  const outcome = resolveOutcome(result, image);
  if (outcome.message) process.stderr.write(`${outcome.message}\n`);
  process.exitCode = outcome.exitCode;
} catch (error) {
  if (error instanceof LauncherError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode;
  } else {
    throw error;
  }
}
