import { describe, expect, it } from "vitest";

import { parseJsonOutput } from "../../../src/checks/shared/json-output.ts";

describe("parseJsonOutput", () => {
  it("parses clean JSON output", () => {
    expect(parseJsonOutput('{"ok":true}', "tool")).toEqual({ ok: true });
  });

  it("parses JSON after a leading console warning block", () => {
    const stdout = " [WARNING] composer.json contains an empty namespace\n\n{\n  \"ok\": true\n}\n";
    expect(parseJsonOutput(stdout, "composer-unused")).toEqual({ ok: true });
  });

  it("fails clearly when output contains no JSON document", () => {
    expect(() => parseJsonOutput(" [WARNING] nothing followed\n", "composer-unused"))
      .toThrow("composer-unused: no JSON document in output: [WARNING] nothing followed");
  });

  it("includes bounded stdout and stderr context when JSON is missing", () => {
    const long = "x".repeat(250);
    expect(() => parseJsonOutput(
      "\nExtension \"apcu\" does not exist\nsecond stdout\n",
      "composer-require-checker",
      `${long}\nfourth line\n`,
    )).toThrow(
      'composer-require-checker: no JSON document in output: Extension "apcu" does not exist'
        + ` | second stdout | ${"x".repeat(200)}`,
    );
  });
});
