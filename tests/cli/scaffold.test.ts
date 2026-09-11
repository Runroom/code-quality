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

  it("does not overwrite consumer files and extends an existing Makefile", () => {
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
    expect(readFileSync(join(root, "Makefile"), "utf8")).toBe(
      `${existingMakefile}\n${MAKEFILE_SNIPPET}`,
    );
    expect(logs).toContain("Updated Makefile (make quality)");
    expect(existsSync(join(root, "quality"))).toBe(true);
    expect(existsSync(join(root, ".github/workflows/quality.yml"))).toBe(true);
    expect(existsSync(join(root, ".dependency-cruiser.cjs"))).toBe(false);
  });
});

describe("consumer Makefile scaffold", () => {
  it("keeps going when the Makefile cannot be read", () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-scaffold-"));
    roots.push(root);
    mkdirSync(join(root, "Makefile"));
    const logs: string[] = [];

    scaffold(root, config(), (value) => logs.push(value));

    expect(logs).toContain("Kept Makefile: could not read it (EISDIR)");
  });

  it("creates Makefile when absent", () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-scaffold-"));
    roots.push(root);
    const logs: string[] = [];

    scaffold(root, config(), (value) => logs.push(value));

    expect(readFileSync(join(root, "Makefile"), "utf8")).toBe(MAKEFILE_SNIPPET);
    expect(logs).toContain("Created Makefile (make quality)");
  });

  it("appends the snippet to an empty existing Makefile", () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-scaffold-"));
    roots.push(root);
    writeFileSync(join(root, "Makefile"), "", "utf8");
    const logs: string[] = [];

    scaffold(root, config(), (value) => logs.push(value));

    expect(readFileSync(join(root, "Makefile"), "utf8")).toBe(MAKEFILE_SNIPPET);
  });

  it("appends the snippet with a separator when the Makefile lacks a trailing newline", () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-scaffold-"));
    roots.push(root);
    const existing = "custom:\n\techo custom";
    writeFileSync(join(root, "Makefile"), existing, "utf8");
    const logs: string[] = [];

    scaffold(root, config(), (value) => logs.push(value));

    expect(readFileSync(join(root, "Makefile"), "utf8")).toBe(
      `${existing}\n\n${MAKEFILE_SNIPPET}`,
    );
    expect(logs).toContain("Updated Makefile (make quality)");
  });

  it("keeps a Makefile byte-identical when CODE_QUALITY is already defined", () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-scaffold-"));
    roots.push(root);
    writeFileSync(join(root, "Makefile"), MAKEFILE_SNIPPET, "utf8");
    const logs: string[] = [];

    scaffold(root, config(), (value) => logs.push(value));

    expect(readFileSync(join(root, "Makefile"), "utf8")).toBe(MAKEFILE_SNIPPET);
    expect(logs).toContain("Kept Makefile");
  });
});

describe("consumer Makefile scaffold conflicts", () => {
  it.each([
    "quality-all:\n\techo custom\n",
    "quality-baseline:\n\techo custom\n",
    "quality-report:\n\techo custom\n",
    "quality-doctor:\n\techo custom\n",
    "  quality:\n\techo custom\n",
    ".PHONY: quality\n",
  ])("keeps a Makefile that conflicts with the quality scaffold: %s", (existing) => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-scaffold-"));
    roots.push(root);
    writeFileSync(join(root, "Makefile"), existing, "utf8");
    const logs: string[] = [];

    scaffold(root, config(), (value) => logs.push(value));

    expect(readFileSync(join(root, "Makefile"), "utf8")).toBe(existing);
    expect(logs).toContain(
      "Kept Makefile: it already defines a quality target or a custom recipe prefix. Add these targets by hand; recipe lines must start with a tab:",
    );
    expect(logs).toContain(MAKEFILE_SNIPPET);
  });

  it("keeps a Makefile with a custom recipe prefix", () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-scaffold-"));
    roots.push(root);
    const existing = ".RECIPEPREFIX := >\nbuild:\n\t>echo build\n";
    writeFileSync(join(root, "Makefile"), existing, "utf8");
    const logs: string[] = [];

    scaffold(root, config(), (value) => logs.push(value));

    expect(readFileSync(join(root, "Makefile"), "utf8")).toBe(existing);
    expect(logs).toContain(
      "Kept Makefile: it already defines a quality target or a custom recipe prefix. Add these targets by hand; recipe lines must start with a tab:",
    );
    expect(logs).toContain(MAKEFILE_SNIPPET);
  });
});

describe("consumer Makefile scaffold assignments", () => {
  it("keeps a Makefile when CODE_QUALITY is already defined", () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-scaffold-"));
    roots.push(root);
    const existing = "CODE_QUALITY := docker run x\n";
    writeFileSync(join(root, "Makefile"), existing, "utf8");
    const logs: string[] = [];

    scaffold(root, config(), (value) => logs.push(value));

    expect(readFileSync(join(root, "Makefile"), "utf8")).toBe(existing);
    expect(logs).toContain("Kept Makefile");
  });

  it("appends when only CODE_QUALITY_IMAGE is defined", () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-scaffold-"));
    roots.push(root);
    const existing = "CODE_QUALITY_IMAGE ?= x\n";
    writeFileSync(join(root, "Makefile"), existing, "utf8");
    const logs: string[] = [];

    scaffold(root, config(), (value) => logs.push(value));

    expect(readFileSync(join(root, "Makefile"), "utf8")).toBe(
      `${existing}\n${MAKEFILE_SNIPPET}`,
    );
  });

  it("keeps an exported CODE_QUALITY assignment", () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-scaffold-"));
    roots.push(root);
    const existing = "export CODE_QUALITY = x\n";
    writeFileSync(join(root, "Makefile"), existing, "utf8");
    const logs: string[] = [];

    scaffold(root, config(), (value) => logs.push(value));

    expect(readFileSync(join(root, "Makefile"), "utf8")).toBe(existing);
    expect(logs).toContain("Kept Makefile");
  });
});

describe("consumer Makefile scaffold edge cases", () => {
  it("keeps a pasted snippet with space-indented recipes and reports the line", () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-scaffold-"));
    roots.push(root);
    const existing = "CODE_QUALITY = docker run x\nquality:\n        $(CODE_QUALITY) check\n";
    writeFileSync(join(root, "Makefile"), existing, "utf8");
    const logs: string[] = [];

    scaffold(root, config(), (value) => logs.push(value));

    expect(readFileSync(join(root, "Makefile"), "utf8")).toBe(existing);
    expect(logs.join("\n")).toMatch(/indented with spaces/);
    expect(logs).toContain(
      "Kept Makefile: quality recipes at line 3 are indented with spaces; Make needs a tab (fix: replace the leading spaces with one tab).",
    );
  });

  it("uses GNUmakefile when it is the first existing makefile", () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-scaffold-"));
    roots.push(root);
    const existing = "custom:\n\techo custom\n";
    writeFileSync(join(root, "GNUmakefile"), existing, "utf8");
    const logs: string[] = [];

    scaffold(root, config(), (value) => logs.push(value));

    expect(readFileSync(join(root, "GNUmakefile"), "utf8")).toBe(
      `${existing}\n${MAKEFILE_SNIPPET}`,
    );
    expect(existsSync(join(root, "Makefile"))).toBe(false);
    expect(logs).toContain("Updated GNUmakefile (make quality)");
  });

  it("does not add a second blank line when the Makefile already has one", () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-scaffold-"));
    roots.push(root);
    const existing = "custom:\n\techo custom\n\n";
    writeFileSync(join(root, "Makefile"), existing, "utf8");
    const logs: string[] = [];

    scaffold(root, config(), (value) => logs.push(value));

    expect(readFileSync(join(root, "Makefile"), "utf8")).toBe(
      `${existing}${MAKEFILE_SNIPPET}`,
    );
  });

  it("preserves CRLF line endings when appending", () => {
    const root = mkdtempSync(join(tmpdir(), "code-quality-scaffold-"));
    roots.push(root);
    const existing = "custom:\r\n\techo custom\r\n";
    writeFileSync(join(root, "Makefile"), existing, "utf8");
    const logs: string[] = [];

    scaffold(root, config(), (value) => logs.push(value));

    expect(readFileSync(join(root, "Makefile"), "utf8")).toBe(
      `${existing}\r\n${MAKEFILE_SNIPPET.replaceAll("\n", "\r\n")}`,
    );
    expect(logs).toContain("Updated Makefile (make quality)");
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
