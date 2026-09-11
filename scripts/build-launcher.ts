import { chmodSync } from "node:fs";
import { join } from "node:path";

import { build } from "esbuild";

export async function buildLauncher(root = process.cwd()): Promise<void> {
  const outfile = join(root, "launcher/dist/cli.js");
  await build({
    absWorkingDir: root,
    entryPoints: ["launcher/src/main.ts"], bundle: true, platform: "node", target: "node18",
    format: "esm", outfile, legalComments: "none", sourcemap: false,
    banner: { js: "#!/usr/bin/env node" },
  });
  chmodSync(outfile, 0o755);
}

export default async function setup(): Promise<void> { await buildLauncher(); }
if (process.argv[1]?.endsWith("build-launcher.ts")) await buildLauncher();
