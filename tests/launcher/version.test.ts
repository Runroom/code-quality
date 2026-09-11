import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { runCli } from "../../src/cli/program.ts";
import { fakeDeps } from "../helpers/fake-adapter.ts";
import { createStyle } from "../../src/cli/style.ts";

describe("launcher version", () => {
  it("matches the package and native CLI versions", async () => {
    const root = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    const launcher = JSON.parse(readFileSync("launcher/package.json", "utf8")) as { version: string };
    const stdout: string[] = [];

    expect(await runCli(["node", "code-quality", "--version"], {
      registry: [],
      run: fakeDeps(),
      env: {},
      cwd: process.cwd(),
      stdout: (value) => stdout.push(value),
      stderr: () => {},
      style: createStyle(false),
    })).toBe(0);
    expect(launcher.version).toBe(root.version);
    expect(stdout.join("").trim()).toBe(root.version);
  });
});
