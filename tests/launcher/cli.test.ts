import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const cli = resolve("launcher/dist/cli.js");
const cwd = resolve("fixtures/ts-project");
const launcher = JSON.parse(readFileSync("launcher/package.json", "utf8")) as { version: string };

function fakeDocker(): { bin: string; log: string } {
  const bin = mkdtempSync(join(tmpdir(), "code-quality-docker-"));
  roots.push(bin);
  const docker = join(bin, "docker");
  const log = join(bin, "docker.log");
  writeFileSync(
    docker,
    '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$FAKE_DOCKER_LOG"\nexit "${FAKE_DOCKER_EXIT:-0}"\n',
    "utf8",
  );
  chmodSync(docker, 0o755);
  return { bin, log };
}

function run(
  args: string[],
  options: { docker?: { bin: string; log: string }; exit?: string; image?: string } = {},
) {
  const path = options.docker
    ? `${options.docker.bin}${delimiter}${dirname(process.execPath)}`
    : dirname(process.execPath);
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      PATH: path,
      ...(options.docker ? { FAKE_DOCKER_LOG: options.docker.log } : {}),
      ...(options.exit ? { FAKE_DOCKER_EXIT: options.exit } : {}),
      ...(options.image ? { CODE_QUALITY_IMAGE: options.image } : {}),
    },
  });
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

describe("launcher bundle", () => {
  it("passes arguments to the version-pinned image", () => {
    const docker = fakeDocker();
    const result = run(["check", "--update"], { docker });
    const args = readFileSync(docker.log, "utf8").trim().split("\n");

    expect(result.status).toBe(0);
    expect(args.slice(0, 4)).toEqual(["run", "--rm", "-v", `${cwd}:/work`]);
    expect(args).toContain(`ghcr.io/runroom/code-quality:v${launcher.version}`);
    expect(args.slice(-2)).toEqual(["check", "--update"]);
  });

  it("passes through Docker exit codes", () => {
    expect(run(["check"], { docker: fakeDocker(), exit: "3" }).status).toBe(3);
  });

  it("reports missing Docker", () => {
    const result = run(["check"]);

    expect(result.status).toBe(127);
    expect(result.stderr).toContain("docker not found");
  });

  it("rejects invalid image overrides before starting Docker", () => {
    const docker = fakeDocker();
    const result = run(["check"], { docker, image: "--privileged" });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Invalid CODE_QUALITY_IMAGE");
    expect(existsSync(docker.log)).toBe(false);
  });
});
