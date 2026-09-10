import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  phpstanDeadCodeAdapter,
  phpstanFindings,
} from "../../../src/checks/php/phpstan-dead-code.ts";
import { checkContext } from "../../helpers/check-context.ts";

const root = resolve("fixtures/php-project");
const nativeFile = resolve("tests/fixtures/native/php-unused-phpstan/stdout.json");
const source = "<?php\nfinal class Dead {\n    private function never(): void {}\n}\n";

function report(identifier = "shipmonk.deadMethod", errors: string[] = []): unknown {
  return {
    totals: { errors: errors.length, file_errors: 1 }, errors,
    files: { "src/a.php": { messages: [{ message: "Dead method", line: 3, identifier }] } },
  };
}

describe("phpstan dead-code synthetic parser", () => {
  it("rejects argument.type diagnostics", async () => {
    await expect(phpstanFindings(
      checkContext("/r", "php", { "src/a.php": source }), report("argument.type"),
    )).rejects.toThrow("Unbaselined PHPStan diagnostic");
  });

  it("rejects non-file errors", async () => {
    await expect(phpstanFindings(
      checkContext("/r", "php", { "src/a.php": source }), report(undefined, ["Internal error"]),
    )).rejects.toThrow("PHPStan errors");
  });

  it("explains the missing vendor prerequisite", () => {
    expect(phpstanDeadCodeAdapter.applicability(checkContext("/r", "php").config)).toMatchObject({
      kind: "error", message: expect.stringContaining("composer install"),
    });
  });
});

describe("phpstan captured fixture", () => {
  it("finds all five dead methods", async () => {
    const parsed = await phpstanFindings(
      checkContext(root, "php"), JSON.parse(readFileSync(nativeFile, "utf8")) as unknown,
    );
    expect(parsed).toEqual({
      "src/Domain/Entity.php | dead-code | /class:Entity/method:save#shipmonk.deadMethod": 1,
      "src/Service/Complex.php | dead-code | /class:Complex/method:run#shipmonk.deadMethod": 1,
      "src/Service/Dead.php | dead-code | /class:Dead/method:alive#shipmonk.deadMethod": 1,
      "src/Service/Dead.php | dead-code | /class:Dead/method:never#shipmonk.deadMethod": 1,
      "src/Service/Uses.php | dead-code | /class:Uses/method:composerVersion#shipmonk.deadMethod": 1,
    });
  });
});
