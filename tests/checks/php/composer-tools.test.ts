import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { composerUnusedFindings } from "../../../src/checks/php/composer-unused.ts";
import { requireCheckerFindings } from "../../../src/checks/php/require-checker.ts";

describe("composer tool synthetic parsers", () => {
  it("rejects strict composer-unused extra keys", () => {
    expect(() => composerUnusedFindings({ "unused-packages": [], errors: [] })).toThrow();
  });

  it("rejects non-string composer-unused package entries", () => {
    expect(() => composerUnusedFindings({ "unused-packages": [{ name: "psr/log" }] })).toThrow();
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
