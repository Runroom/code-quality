import { describe, expect, it } from "vitest";

import { selectAdapters } from "../../../src/core/gate/select.ts";
import type { ResolvedConfig } from "../../../src/core/config/types.ts";
import type { LogicalCheckId } from "../../../src/core/types.ts";
import { fakeAdapter } from "../../helpers/fake-adapter.ts";

function config(languages: ResolvedConfig["languages"]): ResolvedConfig {
  return {
    root: "/tmp/consumer",
    languages,
    paths: { ts: ["src"], php: ["src"] },
    exclude: [],
    disabled: [],
    architecture: {},
    configHash: "a".repeat(64),
  };
}

const registry = [
  fakeAdapter({ id: "ts-complexity", check: "complexity" }),
  fakeAdapter({ id: "ts-unused", check: "unused" }),
  fakeAdapter({ id: "php-complexity", language: "php", check: "complexity" }),
];

describe("selectAdapters", () => {
  it("filters adapters by configured language", () => {
    const selection = selectAdapters(registry, config(["ts"]), []);
    expect(selection.adapters.map((adapter) => adapter.id)).toEqual([
      "ts-complexity",
      "ts-unused",
    ]);
  });

  it("excludes disabled checks and records their reason", () => {
    const disabled = { ...config(["ts"]), disabled: [{ id: "unused" as const, reason: "Not ready" }] };
    const selection = selectAdapters(registry, disabled, []);
    expect(selection.adapters.map((adapter) => adapter.id)).toEqual(["ts-complexity"]);
    expect(selection.skipped).toEqual([{ id: "ts-unused", reason: "Not ready" }]);
  });

  it("filters by requested logical check", () => {
    const selection = selectAdapters(registry, config(["ts", "php"]), ["complexity"]);
    expect(selection.adapters.map((adapter) => adapter.id)).toEqual([
      "ts-complexity",
      "php-complexity",
    ]);
  });

  it("rejects an unknown check id", () => {
    expect(() => selectAdapters(registry, config(["ts"]), ["lint" as LogicalCheckId])).toThrow(
      "Unknown check id 'lint'. Known: complexity, cognitive, duplication, unused, architecture",
    );
  });

  it("records skipped applicability", () => {
    const skipped = fakeAdapter({
      id: "ts-skip",
      applicability: () => ({ kind: "skip", reason: "No rules file" }),
    });
    const selection = selectAdapters([skipped], config(["ts"]), []);
    expect(selection).toEqual({
      adapters: [], skipped: [{ id: "ts-skip", reason: "No rules file" }], failed: [],
    });
  });

  it("records applicability errors and keeps other adapters", () => {
    const broken = fakeAdapter({
      id: "ts-broken",
      applicability: () => ({ kind: "error", message: "vendor is missing" }),
    });
    const selection = selectAdapters([broken, registry[0]!], config(["ts"]), []);
    expect(selection.adapters).toEqual([registry[0]]);
    expect(selection.failed).toEqual([{ id: "ts-broken", message: "vendor is missing" }]);
  });
});
