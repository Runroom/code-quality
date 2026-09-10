import { readFileSync, writeFileSync } from "node:fs";

import { z } from "zod";

import { fail } from "./errors.ts";
import type { Findings } from "./types.ts";

export const findingsSchema = z.record(z.string().min(1), z.number().int().positive());
const snapshotSchema = z.strictObject({
  version: z.literal(1),
  tool: z.string().regex(/^[a-z0-9-]+@\d+\.\d+(\.\d+)?$/),
  configHash: z.string().regex(/^[0-9a-f]{64}$/),
  findings: findingsSchema,
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export function readSnapshot(file: string): Snapshot {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return fail(`Invalid quality snapshot '${file}'.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(`Invalid quality snapshot ${file}: malformed JSON (${message})`);
  }
  const parsed = snapshotSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.slice(0, 3)
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  return fail(`Invalid quality snapshot ${file}: ${issues}`);
}

export function writeSnapshot(file: string, snapshot: Snapshot): void {
  const parsed = snapshotSchema.safeParse(snapshot);
  if (!parsed.success) fail(`Invalid quality snapshot '${file}'.`);
  const ordered = { ...parsed.data, findings: sortFindings(parsed.data.findings) };
  writeFileSync(file, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
}

export function sortFindings(findings: Findings): Findings {
  return Object.fromEntries(
    Object.keys(findings)
      .toSorted()
      .map((key) => [key, findings[key]!]),
  );
}
