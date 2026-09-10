import { join } from "node:path";

import { z } from "zod";

import {
  assertInScope,
  excludeGlobs,
  fail,
  FindingsBuilder,
  lineColumnToByteOffset,
  relativize,
} from "../shared/kit.ts";
import type { CheckAdapter, CheckContext, Findings, GeneratedFile } from "../shared/kit.ts";

const itemSchema = z.looseObject({
  name: z.string(),
  line: z.number().int().positive().optional(),
  col: z.number().int().positive().optional(),
});
const issueSchema = z.object({
  file: z.string(),
  files: z.array(itemSchema).optional(),
  exports: z.array(itemSchema).optional(),
  types: z.array(itemSchema).optional(),
  dependencies: z.array(itemSchema).optional(),
  devDependencies: z.array(itemSchema).optional(),
}).catchall(z.array(z.unknown()));
const knipSchema = z.looseObject({ issues: z.array(issueSchema) });
const KNOWN_TYPES = new Set(["file", "files", "exports", "types", "dependencies", "devDependencies"]);
const TEST_ENTRIES = [
  "tests/**/*.{ts,tsx,js,mjs,cjs}",
  "test/**/*.{ts,tsx,js,mjs,cjs}",
  "**/__tests__/**/*.{ts,tsx,js,mjs,cjs}",
  "**/*.{test,spec}.{ts,tsx,js,mjs,cjs}",
];

function knipConfig(ctx: CheckContext): string {
  const entry = ctx.paths.flatMap((path) => [
    `${path}/**/{index,main,cli}.{ts,tsx,js,mjs,cjs}`,
    `${path}/**/bin/**/*.{ts,js,mjs,cjs}`,
  ]);
  return JSON.stringify({
    entry: [...entry, ...TEST_ENTRIES],
    project: [
      ...ctx.paths.map((path) => `${path}/**/*.{ts,tsx,js,jsx,mjs,cjs}`),
      ...TEST_ENTRIES,
    ],
    ignore: excludeGlobs(ctx.config, false),
    ignoreDependencies: [],
    vite: false,
    vitest: false,
  }, null, 2);
}

function knipConfigFile(ctx: CheckContext): GeneratedFile {
  return { path: "knip.json", content: knipConfig(ctx) };
}

function rejectUnknown(issue: z.infer<typeof issueSchema>): void {
  for (const [type, entries] of Object.entries(issue)) {
    if (!KNOWN_TYPES.has(type) && Array.isArray(entries) && entries.length > 0) {
      return fail(`Unknown knip issue type ${type} in ${issue.file}`);
    }
  }
}

async function exportAnchor(
  ctx: CheckContext,
  file: string,
  item: z.infer<typeof itemSchema>,
): Promise<string> {
  if (item.line === undefined || item.col === undefined) return "/";
  const source = ctx.readSource(file);
  const offset = lineColumnToByteOffset(source, item.line, item.col);
  try {
    return await ctx.anchor.anchor(file, source, offset, false);
  } catch (error) {
    if (error instanceof Error && error.message.includes("cannot identify diagnostic anchor")) {
      return "/";
    }
    throw error;
  }
}

function addFiles(ctx: CheckContext, issue: z.infer<typeof issueSchema>, out: FindingsBuilder): void {
  for (const item of issue.files ?? []) {
    const file = relativize(ctx.root, item.name);
    assertInScope(file, ctx.paths);
    out.add(file, "unused-file", file, 1);
  }
}

async function addExports(
  ctx: CheckContext,
  issue: z.infer<typeof issueSchema>,
  out: FindingsBuilder,
): Promise<void> {
  const file = relativize(ctx.root, issue.file);
  for (const item of [...(issue.exports ?? []), ...(issue.types ?? [])]) {
    assertInScope(file, ctx.paths);
    const anchor = await exportAnchor(ctx, file, item);
    out.add(file, "unused-export", `${anchor}#${item.name}`, 1);
  }
}

function addDependencies(issue: z.infer<typeof issueSchema>, out: FindingsBuilder): void {
  for (const item of [...(issue.dependencies ?? []), ...(issue.devDependencies ?? [])]) {
    const file = issue.file;
    assertInScope(file, [], ["package.json"]);
    out.add(file, "unused-dependency", item.name, 1);
  }
}

export async function knipFindings(ctx: CheckContext, input: unknown): Promise<Findings> {
  const report = knipSchema.parse(input);
  const findings = new FindingsBuilder();
  for (const issue of report.issues) {
    rejectUnknown(issue);
    addFiles(ctx, issue, findings);
    await addExports(ctx, issue, findings);
    addDependencies(issue, findings);
  }
  return findings.build();
}

export const knipAdapter: CheckAdapter = {
  id: "ts-unused",
  check: "unused",
  language: "ts",
  tool: { bin: "knip", version: "6.35.1" },
  applicability: () => ({ kind: "run" }),
  configFiles: (ctx) => [knipConfigFile(ctx)],
  command: (ctx) => ({
    bin: "knip",
    args: [
      "--config", join(ctx.tempDir, "knip.json"), "--reporter", "json",
      "--include", "files,dependencies,devDependencies,exports,types",
      "--no-progress", "--no-config-hints",
    ],
    exitCodes: [0, 1],
  }),
  parse: (ctx, result) => knipFindings(ctx, JSON.parse(result.stdout) as unknown),
};
