import { z } from "zod";

import { assertInScope, excludeGlobs, FindingsBuilder, relativizeFrom, toolOutput } from "../shared/kit.ts";
import type { CheckAdapter, CheckContext, Findings } from "../shared/kit.ts";

const reportSchema = z.array(z.looseObject({
  error: z.looseObject({
    code: z.enum(["DEP001", "DEP002", "DEP003", "DEP004", "DEP005"]),
    message: z.string(),
  }),
  module: z.string(),
  location: z.looseObject({
    file: z.string(),
    line: z.number().int().positive().nullable(),
    column: z.number().int().nullable(),
  }),
}));

function escapeCharacter(character: string): string {
  return /[\\.^$+{}()|[\]]/u.test(character) ? `\\${character}` : character;
}

function globSegmentRegex(segment: string): string {
  let result = "";
  for (const character of segment) {
    if (character === "*") result += "[^/]*";
    else if (character === "?") result += "[^/]";
    else result += escapeCharacter(character);
  }
  return result;
}

export function deptryExcludeRegex(glob: string): string {
  const segments = glob.split("/");
  const leadingGlobstar = segments[0] === "**";
  const trailingGlobstar = segments.at(-1) === "**";
  const start = leadingGlobstar ? 1 : 0;
  const end = trailingGlobstar ? -1 : undefined;
  const body = segments.slice(start, end).map(globSegmentRegex).join("/");
  const prefix = leadingGlobstar ? "(^|/)" : "^";
  const suffix = trailingGlobstar ? "(/|$)" : "$";
  return `${prefix}${body}${suffix}`;
}

export function deptryFindings(ctx: CheckContext, input: unknown): Findings {
  const report = reportSchema.parse(input);
  const findings = new FindingsBuilder();
  for (const diagnostic of report) {
    const file = relativizeFrom(ctx.root, diagnostic.location.file);
    assertInScope(file, ctx.paths, ["pyproject.toml", "setup.py"]);
    findings.add(file, `deptry-${diagnostic.error.code}`, diagnostic.module, 1);
  }
  return findings.build();
}

export const deptryAdapter: CheckAdapter = {
  id: "python-unused-deptry", check: "unused", language: "python",
  tool: { bin: "deptry", version: "0.25.1" },
  applicability: () => ({ kind: "run" }),
  configFiles: (ctx) => toolOutput(ctx, "deptry.json").clear(),
  command: (ctx) => ({
    bin: "deptry",
    args: [...ctx.paths, "--json-output", toolOutput(ctx, "deptry.json").path, "--no-ansi",
      ...excludeGlobs(ctx.config, true).flatMap((glob) => [
        "--exclude", deptryExcludeRegex(glob),
      ])],
    exitCodes: [0, 1],
  }),
  artifactOutputs: (ctx) => toolOutput(ctx, "deptry.json").outputs(),
  parse: (ctx) => Promise.resolve(deptryFindings(
    ctx, JSON.parse(toolOutput(ctx, "deptry.json").read("deptry")) as unknown,
  )),
};
