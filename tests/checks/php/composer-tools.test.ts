import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  composerUnusedAdapter,
  composerUnusedFindings,
} from "../../../src/checks/php/composer-unused.ts";
import {
  requireCheckerAdapter,
  requireCheckerFindings,
} from "../../../src/checks/php/require-checker.ts";
import { checkContext } from "../../helpers/check-context.ts";

describe("composer tool synthetic parsers", () => {
  it("rejects strict composer-unused extra keys", () => {
    expect(() => composerUnusedFindings({ "unused-packages": [], errors: [] })).toThrow();
  });

  it("rejects non-string composer-unused package entries", () => {
    expect(() => composerUnusedFindings({ "unused-packages": [{ name: "psr/log" }] })).toThrow();
  });

  it("accepts a Symfony warning block before composer-unused JSON", async () => {
    const json = readFileSync(
      resolve("tests/fixtures/native/php-unused-composer-unused/stdout.json"),
      "utf8",
    );
    const findings = await composerUnusedAdapter.parse(checkContext("/r", "php"), {
      stdout: ` [WARNING] composer.json[autoload][psr-4] contains an empty namespace\n${json}`,
      stderr: "",
      exitCode: 0,
    });
    expect(Object.keys(findings)).toHaveLength(2);
  });

  it("rejects a require-checker version mismatch", () => {
    expect(() => requireCheckerFindings({
      _meta: { "composer-require-checker": { version: "4.23.0" }, date: "today" },
      "unknown-symbols": {},
    })).toThrow();
  });

  it("rejects require-checker output missing unknown-symbols", () => {
    expect(() => requireCheckerFindings({
      _meta: { "composer-require-checker": { version: "4.24.0" }, date: "today" },
    })).toThrow();
  });

  it("ignores parse errors in the require-checker command", () => {
    expect(requireCheckerAdapter.command(checkContext("/r", "php")).args).toContain(
      "--ignore-parse-errors",
    );
  });

  it("skips require-checker when no symbols are found", async () => {
    const context = checkContext("/r", "php");
    await expect(requireCheckerAdapter.parse(context, {
      stdout: "",
      stderr: "There were no symbols found, please check your configuration",
      exitCode: 1,
    })).resolves.toEqual({});
    expect(context.config.notices).toContain(
      "composer-require-checker found no symbols to analyse "
        + "(composer.json autoload does not cover the configured paths); check skipped",
    );
  });

  it("keeps other require-checker failures fatal", () => {
    expect(() => requireCheckerAdapter.parse(checkContext("/r", "php"), {
      stdout: "not-json", stderr: "tool failed", exitCode: 1,
    })).toThrow();
  });
});

for (const fixture of [
  {
    id: "php-unused-composer-unused",
    expected: {
      "composer.json | unused-package | psr/log": 1,
      "composer.json | unused-package | symfony/yaml": 1,
    },
  },
  {
    id: "php-unused-require-checker",
    expected: { "composer.json | unknown-symbol | Composer\\InstalledVersions": 1 },
  },
]) {
  const nativeFile = resolve(`tests/fixtures/native/${fixture.id}/stdout.json`);
  describe(`${fixture.id} captured fixture`, () => {
    it("produces the exact package findings", () => {
      const input = JSON.parse(readFileSync(nativeFile, "utf8")) as unknown;
      const parsed = fixture.id.endsWith("composer-unused")
        ? composerUnusedFindings(input) : requireCheckerFindings(input);
      expect(parsed).toEqual(fixture.expected);
    });
  });
}
