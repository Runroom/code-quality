import { describe, expect, it } from "vitest";

import {
  assertMountableCwd,
  buildDockerArgs,
  dockerHint,
  imageFor,
  LauncherError,
  resolveOutcome,
  type LaunchContext,
} from "../../launcher/src/args.ts";

const DEFAULT_IMAGE = "ghcr.io/runroom/code-quality:v1.1.5";

function context(overrides: Partial<LaunchContext> = {}): LaunchContext {
  return {
    argv: [],
    cwd: "/repo",
    env: {},
    platform: "darwin",
    image: DEFAULT_IMAGE,
    isTTY: false,
    ...overrides,
  };
}

describe("launcher image", () => {
  it("uses the launcher version for the default image", () => {
    expect(imageFor("1.2.3", {})).toBe("ghcr.io/runroom/code-quality:v1.2.3");
  });

  it.each([
    "ghcr.io/runroom/code-quality:v1",
    "code-quality:dev",
    "code-quality",
    `registry.example.com:5000/team/img@sha256:${"a".repeat(64)}`,
  ])("accepts image reference %s", (image) => {
    expect(imageFor("1.2.3", { CODE_QUALITY_IMAGE: image })).toBe(image);
  });

  it.each(["--privileged", "-v", "foo bar", "Image:dev"])(
    "rejects invalid image reference %s",
    (image) => {
      expect(() => imageFor("1.2.3", { CODE_QUALITY_IMAGE: image }))
        .toThrow(LauncherError);
    },
  );

  it("falls back to the default image for an empty override", () => {
    expect(imageFor("1.2.3", { CODE_QUALITY_IMAGE: "" }))
      .toBe("ghcr.io/runroom/code-quality:v1.2.3");
  });
});

describe("launcher Docker arguments", () => {
  it("adds the uid and gid on Linux", () => {
    expect(buildDockerArgs(context({ platform: "linux", uid: 1000, gid: 1001 })))
      .toContain("1000:1001");
  });

  it("never adds a user on macOS", () => {
    expect(buildDockerArgs(context({ platform: "darwin", uid: 1000, gid: 1001 })))
      .not.toContain("--user");
  });

  it("does not add a user on Linux without a uid", () => {
    expect(buildDockerArgs(context({ platform: "linux", gid: 1001 })))
      .not.toContain("--user");
  });

  it("does not add a user on Linux without a gid", () => {
    expect(buildDockerArgs(context({ platform: "linux", uid: 1000 })))
      .not.toContain("--user");
  });

  it("forwards defined CI variables", () => {
    expect(buildDockerArgs(context({ env: { CI: "", GITHUB_ACTIONS: "true" } }))).toEqual([
      "run", "--rm", "-v", "/repo:/work",
      "-e", "CI", "-e", "GITHUB_ACTIONS", DEFAULT_IMAGE,
    ]);
  });

  it("forwards defined color variables", () => {
    expect(buildDockerArgs(context({ env: { NO_COLOR: "", FORCE_COLOR: "0" } }))).toEqual([
      "run", "--rm", "-v", "/repo:/work",
      "-e", "NO_COLOR", "-e", "FORCE_COLOR", DEFAULT_IMAGE,
    ]);
  });

  it("enables color for a TTY when no color environment variable is set", () => {
    expect(buildDockerArgs(context({ isTTY: true }))).toContain("FORCE_COLOR=1");
  });

  it("does not inject color when non-empty NO_COLOR is set", () => {
    expect(buildDockerArgs(context({ isTTY: true, env: { NO_COLOR: "1" } })))
      .not.toContain("FORCE_COLOR=1");
  });

  it("injects color when NO_COLOR is empty", () => {
    expect(buildDockerArgs(context({ isTTY: true, env: { NO_COLOR: "" } })))
      .toContain("FORCE_COLOR=1");
  });

  it("does not inject color without a TTY", () => {
    expect(buildDockerArgs(context({ isTTY: false }))).not.toContain("FORCE_COLOR=1");
  });

  it("does not forward undefined CI variables", () => {
    expect(buildDockerArgs(context())).not.toContain("-e");
  });

  it("places argv verbatim after the image", () => {
    expect(buildDockerArgs(context({ argv: ["check", "--update"] }))).toEqual([
      "run", "--rm", "-v", "/repo:/work", DEFAULT_IMAGE, "check", "--update",
    ]);
  });

  it("includes the image in the Docker hint", () => {
    expect(dockerHint("code-quality:test")).toContain("code-quality:test");
  });
});

describe("launcher validation and outcomes", () => {
  it("rejects working directories containing colons", () => {
    expect(() => assertMountableCwd("/tmp/a:b")).toThrow(LauncherError);
  });

  it("accepts working directories containing spaces", () => {
    expect(() => assertMountableCwd("/tmp/a b")).not.toThrow();
  });

  it("maps Docker launch errors", () => {
    const missing = Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" });
    const denied = Object.assign(new Error("spawn docker EACCES"), { code: "EACCES" });

    expect(resolveOutcome({ error: missing, status: null, signal: null }, DEFAULT_IMAGE)).toEqual({
      exitCode: 127,
      message: dockerHint(DEFAULT_IMAGE),
    });
    expect(resolveOutcome({ error: denied, status: null, signal: null }, DEFAULT_IMAGE))
      .toMatchObject({ exitCode: 127 });
  });

  it.each([
    ["SIGTERM", 143],
    ["SIGINT", 130],
  ] as const)("maps %s to exit code %i", (signal, exitCode) => {
    expect(resolveOutcome({ status: null, signal }, DEFAULT_IMAGE)).toEqual({ exitCode });
  });

  it("passes through statuses and defaults missing outcomes", () => {
    expect(resolveOutcome({ status: 3, signal: null }, DEFAULT_IMAGE)).toEqual({ exitCode: 3 });
    expect(resolveOutcome({ status: null, signal: null }, DEFAULT_IMAGE)).toEqual({ exitCode: 1 });
  });
});
