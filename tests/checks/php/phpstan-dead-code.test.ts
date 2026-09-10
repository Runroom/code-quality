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
const propertiesSource = "<?php\nfinal class Dead {\n    private array $locales = [];\n    private array $settings = [];\n}\n";

function report(
  identifier = "shipmonk.deadMethod",
  errors: string[] = [],
  message = "Unused App\\Dead::never",
  line = 3,
): unknown {
  return {
    totals: { errors: errors.length, file_errors: 1 }, errors,
    files: { "src/a.php": { messages: [{ message, line, identifier }] } },
  };
}

function messagesReport(messages: Array<{ message: string; line: number; identifier: string }>): unknown {
  return {
    totals: { errors: 0, file_errors: 1 }, errors: [],
    files: { "src/a.php": { messages } },
  };
}

describe("phpstan dead-code synthetic parser", () => {
  it("accepts dotted ShipMonk dead-code identifiers", async () => {
    expect((await phpstanFindings(
      checkContext("/r", "php", { "src/a.php": source }),
      report("shipmonk.deadProperty.neverRead"),
    )).findings).toEqual({
      "src/a.php | dead-code | /class:Dead/method:never#shipmonk.deadProperty.neverRead#never": 1,
    });
  });

  it("disambiguates properties in the same class", async () => {
    expect((await phpstanFindings(
      checkContext("/r", "php", { "src/a.php": propertiesSource }),
      messagesReport([
        {
          message: "Property App\\Dead::$locales is never read",
          line: 3,
          identifier: "shipmonk.deadProperty.neverRead",
        },
        {
          message: "Property App\\Dead::$settings is never read",
          line: 4,
          identifier: "shipmonk.deadProperty.neverRead",
        },
      ]),
    )).findings).toEqual({
      "src/a.php | dead-code | /class:Dead#shipmonk.deadProperty.neverRead#$locales": 1,
      "src/a.php | dead-code | /class:Dead#shipmonk.deadProperty.neverRead#$settings": 1,
    });
  });

  it("rejects diagnostics without an FQN member token", async () => {
    await expect(phpstanFindings(
      checkContext("/r", "php", { "src/a.php": source }),
      report("shipmonk.deadMethod", [], "Dead method"),
    )).rejects.toThrow("Unbaselined PHPStan diagnostic shape: Dead method");
  });

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

  it("skips dead-code analysis for Drupal projects", () => {
    const context = checkContext("/r", "php");
    context.config.isDrupal = true;
    expect(phpstanDeadCodeAdapter.applicability(context.config)).toEqual({
      kind: "skip",
      reason: "Drupal project: PHPStan dead-code analysis is skipped "
        + "(the project's own PHPStan extensions are incompatible with the image)",
    });
  });
});

describe("phpstan captured fixture", () => {
  it("finds all five dead methods", async () => {
    const capturedReport = JSON.parse(readFileSync(nativeFile, "utf8")) as {
      files: Record<string, { messages: Array<{ message: string; line: number }> }>;
    };
    const { findings: parsed, details } = await phpstanFindings(
      checkContext(root, "php"), capturedReport,
    );
    expect(parsed).toEqual({
      "src/Domain/Entity.php | dead-code | /class:Entity/method:save#shipmonk.deadMethod#save": 1,
      "src/Service/Complex.php | dead-code | /class:Complex/method:run#shipmonk.deadMethod#run": 1,
      "src/Service/Dead.php | dead-code | /class:Dead/method:alive#shipmonk.deadMethod#alive": 1,
      "src/Service/Dead.php | dead-code | /class:Dead/method:never#shipmonk.deadMethod#never": 1,
      "src/Service/Uses.php | dead-code | /class:Uses/method:composerVersion#shipmonk.deadMethod#composerVersion": 1,
    });
    const message = capturedReport.files["/work/src/Service/Complex.php"]!.messages[0]!;
    expect(details["src/Service/Complex.php | dead-code | /class:Complex/method:run#shipmonk.deadMethod#run"])
      .toMatchObject({ line: message.line, message: message.message });
  });
});
