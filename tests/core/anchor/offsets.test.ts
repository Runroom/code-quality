import { describe, expect, it } from "vitest";

import {
  byteOffsetToIndex,
  firstNonBlankByteOffset,
  lineColumnToByteOffset,
} from "../../../src/core/anchor/offsets.ts";

describe("anchor offsets", () => {
  it("converts a line and column to a UTF-8 byte offset", () => {
    expect(lineColumnToByteOffset("// café\nfoo", 2, 1)).toBe(Buffer.byteLength("// café\n"));
  });

  it("converts a character column after a multibyte prefix", () => {
    expect(lineColumnToByteOffset("é=1;x", 1, 4)).toBe(4);
  });

  it("rejects a line beyond the end of the source", () => {
    expect(() => lineColumnToByteOffset("one\ntwo", 3, 1)).toThrow("line 3 is beyond end of file");
  });

  it("finds the first non-blank byte offset", () => {
    expect(firstNonBlankByteOffset("  \tfoo", 1)).toBe(3);
  });

  it("converts a UTF-8 byte offset to a string index", () => {
    expect(byteOffsetToIndex("é1", 2)).toBe(1);
  });
});
