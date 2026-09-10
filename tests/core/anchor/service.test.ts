import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createAnchorService } from "../../../src/core/anchor/service.ts";

const FIXTURES = join(import.meta.dirname, "../../fixtures/anchor");
const service = createAnchorService();

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

function offsetOf(source: string, needle: string, occurrence = 0): number {
  let index = -1;
  for (let found = 0; found <= occurrence; found += 1) index = source.indexOf(needle, index + 1);
  if (index < 0) throw new Error(`Missing test needle '${needle}'.`);
  return Buffer.byteLength(source.slice(0, index));
}

describe("TypeScript anchors", () => {
  const source = fixture("sample.ts");

  it.each([
    ["return a", 0, "/function:first"],
    ["return 1", 0, "/class:Foo/method:bar"],
    ["=> 1", 0, "/class:Foo/method:baz/function[0]"],
    ["=> 2", 0, "/class:Foo/method:baz/function[1]"],
    ["=> x", 0, "/function:named"],
    ["return 0", 0, "/function:key"],
  ])("anchors %s occurrence %i as %s", async (needle, occurrence, expected) => {
    await expect(service.anchor("sample.ts", source, offsetOf(source, needle, occurrence), false)).resolves.toBe(expected);
  });

  it("freezes the TypeScript block chain", async () => {
    await expect(service.anchor("sample.ts", source, offsetOf(source, "break"), true)).resolves.toBe(
      "/class:Foo/method:bar/if/block/for",
    );
  });

  it("preserves anchors across unrelated line shifts and Unicode", async () => {
    const shifted = `// café 🎨\nconst unrelated = 1;\n${source}`;
    await expect(service.anchor("sample.ts", shifted, offsetOf(shifted, "=> 1"), false)).resolves.toBe(
      "/class:Foo/method:baz/function[0]",
    );
  });
});

describe("other grammar anchors", () => {
  it("anchors TSX functions and anonymous callbacks", async () => {
    const source = fixture("sample.tsx");
    await expect(service.anchor("sample.tsx", source, offsetOf(source, "x()"), false)).resolves.toBe(
      "/function:Component/function",
    );
  });

  it("anchors JavaScript functions", async () => {
    const source = fixture("sample.js");
    await expect(service.anchor("sample.js", source, offsetOf(source, "return"), false)).resolves.toBe("/function:a");
  });
});

describe("PHP anchors", () => {
  const source = fixture("sample.php");

  it.each([
    ["if ($a)", 0, "/class:Foo/method:bar"],
    ["function ($v)", 0, "/class:Foo/method:baz/function[0]"],
    ["fn($v)", 0, "/class:Foo/method:baz/function[1]"],
    ["return 1", 0, "/function:top"],
  ])("anchors %s occurrence %i as %s", async (needle, occurrence, expected) => {
    await expect(service.anchor("sample.php", source, offsetOf(source, needle, occurrence), false)).resolves.toBe(expected);
  });

  it("freezes the PHP block chain", async () => {
    await expect(service.anchor("sample.php", source, offsetOf(source, "return $x"), true)).resolves.toBe(
      "/class:Foo/method:bar/block/if/block/foreach",
    );
  });
});

describe("Python anchors", () => {
  const source = fixture("sample.py");

  it.each([
    ["if a", 0, "/class:Foo/method:bar"],
    ["lambda v", 0, "/class:Foo/method:baz/function[0]"],
    ["lambda v", 1, "/class:Foo/method:baz/function[1]"],
    ["def baz", 0, "/class:Foo/method:baz"],
    ["return 1", 0, "/function:top"],
  ])("anchors %s occurrence %i as %s", async (needle, occurrence, expected) => {
    await expect(service.anchor("sample.py", source, offsetOf(source, needle, occurrence), false)).resolves.toBe(expected);
  });

  it("freezes the Python block chain", async () => {
    await expect(service.anchor("sample.py", source, offsetOf(source, "return x"), true)).resolves.toBe(
      "/class:Foo/method:bar/block/if/block/for/block",
    );
  });
});

describe("anchor errors", () => {
  it("rejects top-level whitespace in function mode", async () => {
    const source = fixture("sample.ts");
    await expect(service.anchor("sample.ts", source, offsetOf(source, "\n"), false)).rejects.toThrow("cannot identify");
  });

  it("rejects files with syntax errors", async () => {
    await expect(service.anchor("sample.py", "def broken(:", 0, false)).rejects.toThrow("could not parse");
  });

  it("rejects unsupported grammars", async () => {
    await expect(service.anchor("file.rb", "def a; end", 0, false)).rejects.toThrow("unsupported grammar");
  });
});
