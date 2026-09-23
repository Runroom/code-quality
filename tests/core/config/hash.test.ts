import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import { canonicalJson, configHash } from "../../../src/core/config/hash.ts";
import type { ResolvedConfig } from "../../../src/core/config/types.ts";

const baseConfig: Omit<ResolvedConfig, "root" | "configHash"> = {
  isDrupal: false,
  languages: ["ts"],
  paths: { ts: ["src"] },
  exclude: [],
  disabled: [],
  architecture: { ts: { kind: "skip" } },
  notices: [],
};

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}');
  });

  it("sorts and deduplicates string arrays", () => {
    expect(canonicalJson(["b", "a", "a"])).toBe('["a","b"]');
  });

  it("sorts disabled checks by id", () => {
    expect(
      canonicalJson({
        disabled: [
          { id: "unused", reason: "unused reason" },
          { id: "architecture", reason: "architecture reason" },
        ],
      }),
    ).toBe(
      '{"disabled":[{"id":"architecture","reason":"architecture reason"},{"id":"unused","reason":"unused reason"}]}',
    );
  });
});

describe("configHash", () => {
  it("returns a lowercase SHA-256 digest", () => {
    expect(configHash(baseConfig)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the current policy hash when no runtime target is supplied", () => {
    expect(configHash(baseConfig)).toBe("5725438a068191a110bfba12477cad782ab11bb21f0077cb9c781244d80c9906");
  });

  it("changes when the derived Python runtime target changes", () => {
    expect(configHash({ ...baseConfig, runtime: { python: "3.12" } })).not.toBe(
      configHash({ ...baseConfig, runtime: { python: "3.14" } }),
    );
  });

  it("matches for equivalent YAML-shaped configurations", () => {
    const first = parse(`
      # The same values in flow notation.
      languages: [ts]
      paths: { ts: [src] }
    `) as Pick<ResolvedConfig, "languages" | "paths">;
    const second = parse(`
      paths:
        ts:
          - src
      # A comment and a different key order do not matter.
      languages:
        - ts
    `) as Pick<ResolvedConfig, "languages" | "paths">;
    expect(configHash({
      ...baseConfig,
      ...first,
    })).toBe(configHash({ ...baseConfig, ...second }));
  });

  it("changes when the policy version changes", async () => {
    vi.resetModules();
    vi.doMock("../../../src/core/config/policy.ts", () => ({ POLICY_VERSION: "changed-policy" }));
    const { configHash: mockedHash } = await import("../../../src/core/config/hash.ts");

    expect(mockedHash(baseConfig)).not.toBe(configHash(baseConfig));
    vi.doUnmock("../../../src/core/config/policy.ts");
    vi.resetModules();
  });

  it("changes when an exclusion is added", () => {
    expect(configHash(baseConfig)).not.toBe(
      configHash({ ...baseConfig, exclude: ["**/generated/**"] }),
    );
  });

  it("ignores notices when hashing", () => {
    expect(configHash(baseConfig)).toBe(
      configHash({ ...baseConfig, notices: ["ts: no sources"] }),
    );
  });

  it("rejects a missing architecture selection before hashing", () => {
    expect(
      () => configHash({
        ...baseConfig,
        architecture: { ts: { kind: "missing", rulesFile: "rules/arch.cjs" } },
      }),
    ).toThrow("missing architecture rules file");
  });
});
