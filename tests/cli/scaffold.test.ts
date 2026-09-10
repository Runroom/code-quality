import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import { consumerConfigSchema } from "../../src/core/config/schema.ts";
import type { ResolvedConfig } from "../../src/core/config/types.ts";
import {
  CALLER_WORKFLOW,
  MAKEFILE_SNIPPET,
  renderConsumerConfig,
  scaffold,
} from "../../src/cli/scaffold.ts";

const roots: string[] = [];

function config(): ResolvedConfig {
  return {
    root: "/tmp/consumer",
    isDrupal: false,
    languages: ["ts", "python"],
    paths: { ts: ["src"], python: ["app"] },
    exclude: [],
    disabled: [],
    architecture: {},
    notices: [],
    configHash: "a".repeat(64),
  };
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

describe("consumer scaffold", () => {
  it("renders a valid empty configuration when no languages resolve", () => {
    const parsed = parse(renderConsumerConfig({ ...config(), languages: [], paths: {} }));
    expect(consumerConfigSchema.parse(parsed)).toEqual({});
  });

  it("renders schema-compatible languages and concrete paths", () => {
    const parsed = parse(renderConsumerConfig(config()));
    expect(consumerConfigSchema.parse(parsed)).toMatchObject({
      languages: ["ts", "python"],
      paths: { ts: ["src"], python: ["app"] },
    });
  });

  it("renders the caller workflow and tab-indented Makefile targets", () => {
    const workflow = parse(CALLER_WORKFLOW);
    expect(workflow.permissions).toEqual({ contents: "read", packages: "read" });
    expect(workflow.jobs.quality.uses).toBe(
      "Runroom/code-quality/.github/workflows/quality.yml@v1",
    );
    const lines = MAKEFILE_SNIPPET.split("\n");
    const targets = ["quality", "quality-all", "quality-baseline", "quality-report", "quality-doctor"];
    expect(lines).toContain("CODE_QUALITY_IMAGE ?= ghcr.io/runroom/code-quality:v1");
    expect(lines).toContain(
      "# Must be a single image reference; it is interpolated into docker run unquoted.",
    );
    expect(lines).toContain(".PHONY: quality quality-all quality-baseline quality-report quality-doctor");
    for (const target of targets) expect(lines).toContain(`${target}:`);
    for (const [index, line] of lines.entries()) {
      if (!targets.some((target) => line === `${target}:`)) continue;
      expect(lines[index + 1]?.startsWith("\t")).toBe(true);
    }
  });

  it("does not overwrite consumer files and logs an existing Makefile snippet", () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-scaffold-"));
    roots.push(root);
    mkdirSync(join(root, "src"));
    const existingConfig = "languages: [ts]\npaths:\n  ts: [src]\n";
    const existingMakefile = "custom:\n\techo custom\n";
    writeFileSync(join(root, ".code-quality.yml"), existingConfig, "utf8");
    writeFileSync(join(root, "Makefile"), existingMakefile, "utf8");
    const logs: string[] = [];

    scaffold(root, config(), (value) => logs.push(value));

    expect(readFileSync(join(root, ".code-quality.yml"), "utf8")).toBe(existingConfig);
    expect(readFileSync(join(root, "Makefile"), "utf8")).toBe(existingMakefile);
    expect(logs).toContain("Kept existing Makefile; add these targets to it if you want make quality:");
    expect(logs).toContain(MAKEFILE_SNIPPET);
    expect(existsSync(join(root, "quality"))).toBe(true);
    expect(existsSync(join(root, ".github/workflows/quality.yml"))).toBe(true);
    expect(existsSync(join(root, ".dependency-cruiser.cjs"))).toBe(false);
  });
});

describe("consumer .gitignore scaffold", () => {
  it("creates .gitignore entries when the consumer file is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-scaffold-"));
    roots.push(root);
    const logs: string[] = [];

    scaffold(root, config(), (value) => logs.push(value));

    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(
      "# code-quality\nartifacts/quality/\n",
    );
    expect(logs).toContain("Updated .gitignore (artifacts/quality/)");
  });

  it("appends missing .gitignore entries without changing existing content", () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-scaffold-"));
    roots.push(root);
    const existing = "node_modules/\ncoverage/\n";
    writeFileSync(join(root, ".gitignore"), existing, "utf8");
    const logs: string[] = [];

    scaffold(root, config(), (value) => logs.push(value));

    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(
      `${existing}# code-quality\nartifacts/quality/\n`,
    );
    expect(logs).toContain("Updated .gitignore (artifacts/quality/)");
  });

  it("keeps an existing .gitignore byte-identical when entries are present", () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-scaffold-"));
    roots.push(root);
    const existing = "node_modules/\n# code-quality\nartifacts/quality/\n.code-quality-tmp/\n";
    writeFileSync(join(root, ".gitignore"), existing, "utf8");
    const logs: string[] = [];

    scaffold(root, config(), (value) => logs.push(value));

    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(existing);
    expect(logs).toContain("Kept .gitignore");
  });
});
