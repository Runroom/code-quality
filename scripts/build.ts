import { build } from "esbuild";
import { chmodSync } from "node:fs";
import { buildLauncher } from "./build-launcher.ts";
import { copyAssets } from "./copy-assets.ts";

await build({
  entryPoints: ["src/cli/main.ts"], bundle: true, platform: "node", target: "node24",
  format: "esm", outfile: "dist/cli.js", legalComments: "none", sourcemap: false,
  banner: { js: '#!/usr/bin/env node\nimport { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);' },
});
await buildLauncher();
copyAssets();
chmodSync("dist/cli.js", 0o755);
