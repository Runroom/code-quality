import { describe, expect, it } from "vitest";

import { QualityError } from "../../../src/core/errors.ts";
import { spawnTool } from "../../../src/core/runner/spawn.ts";

describe("spawnTool", () => {
  it("captures stdout and the successful exit code", () => {
    const result = spawnTool(
      { bin: "node", args: ["-e", "console.log('ok')"], exitCodes: [0] },
      process.cwd(),
    );
    expect(result).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
  });

  it("rejects a disallowed exit code", () => {
    expect(() =>
      spawnTool({ bin: "node", args: ["-e", "process.exit(3)"], exitCodes: [0] }, process.cwd()),
    ).toThrow(QualityError);
    expect(() =>
      spawnTool({ bin: "node", args: ["-e", "process.exit(3)"], exitCodes: [0] }, process.cwd()),
    ).toThrow("exited with 3");
  });

  it("accepts an explicitly allowed non-zero exit code", () => {
    const result = spawnTool(
      { bin: "node", args: ["-e", "process.exit(3)"], exitCodes: [0, 3] },
      process.cwd(),
    );
    expect(result.exitCode).toBe(3);
  });

  it("accepts any exit code when configured", () => {
    const result = spawnTool(
      { bin: "node", args: ["-e", "process.exit(7)"], exitCodes: "any" },
      process.cwd(),
    );
    expect(result.exitCode).toBe(7);
  });

  it("reports a missing binary", () => {
    expect(() =>
      spawnTool({ bin: "definitely-not-a-bin", args: [], exitCodes: [0] }, process.cwd()),
    ).toThrow("not found");
  });

  it("reports termination by signal before checking accepted exit codes", () => {
    expect(() =>
      spawnTool(
        { bin: "node", args: ["-e", "process.kill(process.pid, 'SIGKILL')"], exitCodes: "any" },
        process.cwd(),
      ),
    ).toThrow("node terminated by SIGKILL");
  });
});

it("passes only allow-listed, constant, and invocation environment variables", () => {
  const originalSecret = process.env.CODE_QUALITY_TEST_SECRET;
  process.env.CODE_QUALITY_TEST_SECRET = "hidden";
  try {
    const result = spawnTool(
      {
        bin: "node",
        args: ["-e", "console.log(JSON.stringify(process.env))"],
        env: { CODE_QUALITY_EXPLICIT: "visible" },
        exitCodes: [0],
      },
      process.cwd(),
    );
    const env = JSON.parse(result.stdout) as Record<string, string>;
    expect(env.CODE_QUALITY_TEST_SECRET).toBeUndefined();
    expect(env.CODE_QUALITY_EXPLICIT).toBe("visible");
    expect(env.CI).toBe("true");
    expect(env.FALLOW_TELEMETRY_DISABLED).toBe("1");
    expect(env.JSCPD_NO_TIPS).toBe("1");
    expect(env.PATH).toBe(process.env.PATH);
  } finally {
    if (originalSecret === undefined) delete process.env.CODE_QUALITY_TEST_SECRET;
    else process.env.CODE_QUALITY_TEST_SECRET = originalSecret;
  }
});
