import {
  byteOffsetToLineColumn,
  firstNonBlankByteOffset,
  lineColumnToByteOffset,
} from "../../core/anchor/offsets.ts";
import { AnchorError } from "../../core/anchor/service.ts";
import type { CheckContext } from "../../core/types.ts";
import { FindingsBuilder } from "./findings.ts";
import { assertInScope, relativize } from "./paths.ts";

type Location = { offset: number } | { line: number; column?: number };

interface AnchoredFinding {
  file: string;
  rule: string;
  value: number;
  blockMode: boolean;
  anchorSuffix?: string | undefined;
  fallbackAnchor?: string | undefined;
  symbol?: string | undefined;
  message?: string | undefined;
  threshold?: number | undefined;
}

function byteOffset(source: string, location: Location): number {
  if ("offset" in location) return location.offset;
  if (location.column !== undefined) {
    return lineColumnToByteOffset(source, location.line, location.column);
  }
  return firstNonBlankByteOffset(source, location.line);
}

function detailLocation(source: string, location: Location): { line: number; column?: number } {
  if ("line" in location) {
    return location.column === undefined
      ? { line: location.line }
      : { line: location.line, column: location.column };
  }
  return byteOffsetToLineColumn(source, location.offset);
}

async function resolveAnchor(
  ctx: CheckContext,
  input: {
    file: string; source: string; offset: number; blockMode: boolean;
    fallback?: string | undefined; symbol?: string | undefined; line?: number | undefined;
  },
): Promise<string> {
  try {
    return await ctx.anchor.anchor(input.file, input.source, input.offset, input.blockMode);
  } catch (error) {
    if (!(error instanceof AnchorError)) throw error;
    if (error.kind !== "unparsed" && error.kind !== "cannot identify") throw error;
    const reason = error.kind === "unparsed"
      ? "grammar could not parse the file" : "cannot identify diagnostic anchor";
    ctx.notice(`anchors for ${input.file} fall back to symbol/line keys (${reason})`);
    if (input.symbol !== undefined) return `~${input.symbol}`;
    if (input.fallback !== undefined) return input.fallback;
    return `~L${input.line ?? 1}`;
  }
}

export async function addAnchoredFinding(
  ctx: CheckContext,
  findings: FindingsBuilder,
  input: AnchoredFinding & Location,
): Promise<void> {
  const file = relativize(ctx.root, input.file);
  assertInScope(file, ctx.paths);
  const source = ctx.readSource(file);
  const location = detailLocation(source, input);
  const anchor = await resolveAnchor(ctx, {
    file, source, offset: byteOffset(source, input), blockMode: input.blockMode,
    fallback: input.fallbackAnchor, symbol: input.symbol,
    line: location.line,
  });
  const message = input.message === undefined ? {} : { message: input.message };
  const threshold = input.threshold === undefined ? {} : { threshold: input.threshold };
  findings.add({
    file, rule: input.rule, anchor: `${anchor}${input.anchorSuffix ?? ""}`, value: input.value,
    ...location, ...message, ...threshold,
  });
}
