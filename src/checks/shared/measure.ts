import { fail } from "../../core/errors.ts";

export function extractMeasurement(pattern: RegExp, message: string, context: string): number {
  const match = pattern.exec(message);
  const value = match?.[1];
  if (value === undefined) return fail(`Unparsable metric message (${context}): ${message}`);
  return Number.parseInt(value, 10);
}
