import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { KNIP_PLUGIN_NAMES } from "../../../src/checks/ts/knip-plugins.ts";
import { knipAdapter } from "../../../src/checks/ts/knip.ts";
import { checkContext } from "../../helpers/check-context.ts";

const pluginNamesFile = resolve("node_modules/knip/dist/types/PluginNames.js");

async function installedPluginNames(): Promise<string[]> {
  const module = await import(pathToFileURL(pluginNamesFile).href) as { pluginNames: string[] };
  return [...module.pluginNames].toSorted();
}

const knipManifest = resolve("node_modules/knip/package.json");

describe.skipIf(!existsSync(knipManifest))("pinned Knip plugin list", () => {
  it("still finds the runtime plugin registry of the installed knip", () => {
    expect(existsSync(pluginNamesFile), `update pluginNamesFile after a knip upgrade: ${pluginNamesFile}`).toBe(true);
  });

  it("matches every unique plugin in the knip 6.35.1 runtime registry", async () => {
    expect(KNIP_PLUGIN_NAMES).toEqual(await installedPluginNames());
    expect(new Set(KNIP_PLUGIN_NAMES)).toHaveLength(KNIP_PLUGIN_NAMES.length);
  });
});

describe("generated Knip plugin flags", () => {
  it("sets every plugin false in flat and workspace shapes", () => {
    const flat = JSON.parse(knipAdapter.configFiles(checkContext("/r", "ts"))[0]!.content) as Record<string, unknown>;
    const root = mkdtempSync(join(tmpdir(), "knip-plugins-"));
    try {
      mkdirSync(join(root, "server/src"), { recursive: true });
      writeFileSync(join(root, "package.json"), "{}");
      writeFileSync(join(root, "server/package.json"), "{}");
      const workspaceContext = checkContext(root, "ts");
      workspaceContext.paths = ["server/src"];
      const workspace = JSON.parse(knipAdapter.configFiles(workspaceContext)[0]!.content) as Record<string, unknown>;
      expect(workspace).toHaveProperty("workspaces");
      for (const plugin of KNIP_PLUGIN_NAMES) {
        expect(flat[plugin], plugin).toBe(false);
        expect(workspace[plugin], plugin).toBe(false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
