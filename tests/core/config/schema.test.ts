import { describe, expect, it } from "vitest";

import { consumerConfigSchema } from "../../../src/core/config/schema.ts";

describe("consumerConfigSchema", () => {
  it("parses the full configuration example", () => {
    const config = consumerConfigSchema.parse({
      languages: ["ts", "php", "python", "web"],
      paths: {
        ts: ["src", "packages/ui"],
        php: ["src", "lib", "app"],
        python: ["src"],
        web: ["templates", "assets"],
      },
      exclude: ["**/generated/**", "**/vendor/**", "**/.venv/**"],
      checks: {
        disabled: [{ id: "architecture", reason: "No approved rules yet." }],
      },
      architecture: {
        ts: { rulesFile: ".dependency-cruiser.cjs" },
        php: { rulesFile: "deptrac.yaml" },
        python: { rulesFile: ".importlinter" },
      },
      report: { coverage: "coverage/coverage-final.json" },
    });

    expect(config.languages).toEqual(["ts", "php", "python", "web"]);
  });

  it("rejects threshold overrides and unknown fields", () => {
    expect(() => consumerConfigSchema.parse({ thresholds: { complexity: 20 } })).toThrow(
      /Unrecognized key/,
    );
  });

  it("accepts report coverage and rejects invalid report shapes", () => {
    expect(consumerConfigSchema.parse({ report: { coverage: "coverage" } }).report)
      .toEqual({ coverage: "coverage" });
    for (const report of ["coverage", { coverage: "/abs" }, { coverage: "../map.json" },
      { coverage: "-x" }, { coverage: "a:b" }, { unknown: true }]) {
      expect(() => consumerConfigSchema.parse({ report })).toThrow();
    }
  });

  it.each([
    ["empty language list", { languages: [] }],
    ["unsupported language", { languages: ["go"] }],
    ["empty path list", { paths: { ts: [] } }],
    ["absolute path", { paths: { ts: ["/abs"] } }],
    ["long option path", { paths: { ts: ["--webpack-config"] } }],
    ["short option path", { paths: { ts: ["-c"] } }],
    ["parent directory", { paths: { ts: [".."] } }],
    ["normalized parent directory", { paths: { ts: ["./.."] } }],
    ["path normalizing to current directory", { paths: { ts: ["src/.."] } }],
    ["colon in path", { paths: { ts: ["a:b"] } }],
    ["empty exclusion", { exclude: [""] }],
    ["blank disable reason", { checks: { disabled: [{ id: "complexity", reason: "  " }] } }],
    ["unsupported disabled check", { checks: { disabled: [{ id: "lint", reason: "reason" }] } }],
  ])("rejects %s", (_name, value) => {
    expect(() => consumerConfigSchema.parse(value)).toThrow();
  });
});
