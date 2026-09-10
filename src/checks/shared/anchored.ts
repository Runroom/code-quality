import { firstNonBlankByteOffset, lineColumnToByteOffset } from "../../core/anchor/offsets.ts";
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
}

function byteOffset(source: string, location: Location): number {
  if ("offset" in location) return location.offset;
  if (location.column !== undefined) {
    return lineColumnToByteOffset(source, location.line, location.column);
  }
  return firstNonBlankByteOffset(source, location.line);
}

async function resolveAnchor(
  ctx: CheckContext,
  input: {
    file: string; source: string; offset: number; blockMode: boolean;
    fallback?: string | undefined;
  },
): Promise<string> {
  try {
    return await ctx.anchor.anchor(input.file, input.source, input.offset, input.blockMode);
  } catch (error) {
    if (input.fallback !== undefined && error instanceof Error
      && error.message.includes("cannot identify diagnostic anchor")) return input.fallback;
    throw error;
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
  const anchor = await resolveAnchor(ctx, {
    file, source, offset: byteOffset(source, input), blockMode: input.blockMode,
    fallback: input.fallbackAnchor,
  });
  findings.add(file, input.rule, `${anchor}${input.anchorSuffix ?? ""}`, input.value);
}
