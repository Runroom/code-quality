import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { deptracFindings } from "../../../src/checks/php/deptrac.ts";
import { checkContext } from "../../helpers/check-context.ts";

const root = resolve("fixtures/php-project");
const nativeFile = resolve("tests/fixtures/native/php-architecture/deptrac.json");
const source = "<?php\nfinal class Entity {\n    public function save(): void {}\n}\n";

function report(message: string, violations = 1): unknown {
  return {
    Report: {
      Violations: violations, "Skipped violations": 0, Uncovered: 0,
      Allowed: 0, Warnings: 0, Errors: 0,
    },
    files: { "src/a.php": { violations: 1, messages: [{
      message, line: 3, type: "error",
    }] } },
  };
}

describe("deptrac synthetic parser", () => {
  it("rejects a violation count mismatch", async () => {
    await expect(deptracFindings(
      checkContext("/r", "php", { "src/a.php": source }),
      report("Domain must not depend on Infrastructure (A on B)", 2),
    )).rejects.toThrow("count mismatch");
  });

  it("rejects an unknown message shape", async () => {
    await expect(deptracFindings(
      checkContext("/r", "php", { "src/a.php": source }), report("changed output"),
    )).rejects.toThrow("Unknown deptrac message shape");
  });

  it("falls back to the depending class for a module-only violation", async () => {
    const outsideClass = "<?php\nuse Infrastructure\\Repo;\nfinal class Entity {}\n";
    const input = report(
      "Domain\\Entity must not depend on Infrastructure\\Repo (Domain on Infrastructure)",
    ) as { files: Record<string, { messages: Array<{ line: number }> }> };
    input.files["src/a.php"]!.messages[0]!.line = 2;
    await expect(deptracFindings(
      checkContext("/r", "php", { "src/a.php": outsideClass }), input,
    )).resolves.toEqual({
      "src/a.php | deptrac:Domain-on-Infrastructure | Domain\\Entity": 1,
    });
  });

  it("propagates unrelated anchor errors", async () => {
    const ctx = checkContext("/r", "php", { "src/a.php": source });
    ctx.anchor.anchor = () => Promise.reject(new Error("grammar parse failed"));
    await expect(deptracFindings(
      ctx, report("Domain must not depend on Infrastructure (A on B)"),
    )).rejects.toThrow("grammar parse failed");
  });
});

describe("deptrac captured fixture", () => {
  it("finds both layer violations", async () => {
    const parsed = await deptracFindings(
      checkContext(root, "php"), JSON.parse(readFileSync(nativeFile, "utf8")) as unknown,
    );
    expect(parsed).toEqual({
      "src/Domain/Entity.php | deptrac:Domain-on-Infrastructure | /class:Entity/method:save": 1,
      "src/Infrastructure/Repo.php | deptrac:Infrastructure-on-Domain | /class:Repo/method:store": 1,
    });
  });
});
