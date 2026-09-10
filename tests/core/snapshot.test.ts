import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { QualityError } from "../../src/core/errors.ts";
import { readSnapshot, writeSnapshot } from "../../src/core/snapshot.ts";

const snapshot = {
  version: 1 as const,
  tool: "oxlint@1.81.0",
  configHash: "a".repeat(64),
  findings: { "b | rule | /path": 2, "a | rule | /path": 1 },
};

function withTempFile(run: (file: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "code-quality-snapshot-"));
  const file = join(directory, "snapshot.json");
  try {
    run(file);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function expectInvalidSnapshot(value: unknown): void {
  withTempFile((file) => {
    writeFileSync(file, JSON.stringify(value));

    expect(() => readSnapshot(file)).toThrow(QualityError);
  });
}

function expectMalformedJson(): void {
  withTempFile((file) => {
    writeFileSync(file, "{ malformed");

    expect(() => readSnapshot(file)).toThrow(
      new RegExp(`Invalid quality snapshot ${file}: malformed JSON \\(.+\\)`),
    );
  });
}

function expectSchemaIssueDetails(): void {
  withTempFile((file) => {
    writeFileSync(file, JSON.stringify({
      version: 2,
      tool: "invalid",
      configHash: "invalid",
      findings: { only: 0 },
    }));

    let error: unknown;
    try {
      readSnapshot(file);
    } catch (caught) {
      error = caught;
    }
    const message = error instanceof Error ? error.message : "";
    expect(message).toMatch(/version: .+; tool: .+; configHash: .+/u);
    expect(message).not.toMatch(/findings\.only/u);
  });
}

describe("snapshot schema", () => {
  it("accepts the canonical object and round-trips it", () => {
    withTempFile((file) => {
      writeSnapshot(file, snapshot);

      expect(readSnapshot(file)).toEqual({ ...snapshot, findings: { ...snapshot.findings } });
    });
  });

  it.each([
    ["version: 2", { ...snapshot, version: 2 }],
    ["unknown top-level field", { ...snapshot, note: "unexpected" }],
    ["value 0", { ...snapshot, findings: { only: 0 } }],
    ["value 1.5", { ...snapshot, findings: { only: 1.5 } }],
    ["63-character config hash", { ...snapshot, configHash: "a".repeat(63) }],
    ["tool without @", { ...snapshot, tool: "oxlint" }],
  ])("rejects %s", (_name, value) => expectInvalidSnapshot(value));

  it("reports the file path and parser reason for malformed JSON", () => expectMalformedJson());

  it("reports the first three schema issues with their paths", () => expectSchemaIssueDetails());

  it("writes sorted findings with two-space JSON and a trailing newline", () => {
    withTempFile((file) => {
      writeSnapshot(file, snapshot);

      expect(readFileSync(file, "utf8")).toBe(
        `${JSON.stringify(
          { ...snapshot, findings: { "a | rule | /path": 1, "b | rule | /path": 2 } },
          null,
          2,
        )}\n`,
      );
    });
  });
});
