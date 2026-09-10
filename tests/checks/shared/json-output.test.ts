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
      .toThrow("composer-unused: no JSON document in output");
  });
});
