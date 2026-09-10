import { fail } from "../errors.ts";

interface LineInfo {
  start: number;
  text: string;
}

function lineInfo(source: string, line: number): LineInfo {
  if (!Number.isInteger(line) || line < 1) fail(`line ${line} is invalid`);
  const lines = source.split("\n");
  if (line > lines.length) fail(`line ${line} is beyond end of file`);
  const before = lines.slice(0, line - 1).join("\n");
  return {
    start: line === 1 ? 0 : Buffer.byteLength(`${before}\n`),
    text: lines[line - 1]!,
  };
}

export function lineColumnToByteOffset(source: string, line: number, column: number): number {
  const info = lineInfo(source, line);
  if (!Number.isInteger(column) || column < 1 || column > info.text.length + 1) {
    return fail(`column ${column} is invalid for line ${line}`);
  }
  return info.start + Buffer.byteLength(info.text.slice(0, column - 1));
}

export function firstNonBlankByteOffset(source: string, line: number): number {
  const info = lineInfo(source, line);
  const leadingBlank = info.text.match(/^\s*/u)?.[0] ?? "";
  return info.start + Buffer.byteLength(leadingBlank);
}

export function byteOffsetToIndex(source: string, byteOffset: number): number {
  if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset > Buffer.byteLength(source)) {
    return fail(`byte offset ${byteOffset} is beyond end of file`);
  }
  return Buffer.from(source).subarray(0, byteOffset).toString().length;
}
