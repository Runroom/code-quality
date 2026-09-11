import type { Regression, StaleEntry } from "../core/compare.ts";
import type { SkippedEntry } from "../core/gate/select.ts";
import type { GateOutcome } from "../core/gate/types.ts";
import { parseFindingKey } from "../core/types.ts";
import type { DuplicateDetail, FindingDetail, LogicalCheckId } from "../core/types.ts";
import { GLYPH, type Style } from "./style.ts";

export interface OutcomeRow { outcome: GateOutcome; check: LogicalCheckId; }

interface FindingOutput {
  body: string;
  file: string;
  line?: number | undefined;
  column?: number | undefined;
  rule: string;
  anchor: string;
  tag: string;
  tagKind: "new" | "new?" | "worsened" | "stale" | "improved" | "baselined";
}

const STRIPPED_RANGES = [
  [0, 8],
  [11, 31],
  [0x7F, 0x9F],
  [0x202A, 0x202E],
  [0x2066, 0x2069],
] as const;
const STRIPPED_POINTS = new Set([0x200E, 0x200F]);

function isStrippedControl(code: number): boolean {
  return STRIPPED_POINTS.has(code)
    || STRIPPED_RANGES.some(([minimum, maximum]) => code >= minimum && code <= maximum);
}

export function sanitizeLine(value: string): string {
  let sanitized = "";
  let newline = false;
  for (const character of value) {
    if (character === "\r" || character === "\n") {
      if (!newline) sanitized += " ";
      newline = true;
      continue;
    }
    newline = false;
    if (isStrippedControl(character.codePointAt(0) ?? 0)) continue;
    sanitized += character;
  }
  return neutralizeCommandPrefix(sanitized).replaceAll("##[", "%23%23[");
}

const LEADING_WHITESPACE = /^[\p{White_Space}\u180E\uFEFF]*/u;
function neutralizeCommandPrefix(line: string): string {
  const leading = LEADING_WHITESPACE.exec(line)?.[0].length ?? 0;
  if (!line.startsWith("::", leading)) return line;
  return `${line.slice(0, leading)}%3A%3A${line.slice(leading + 2)}`;
}

function location(detail: FindingDetail): string {
  if (detail.line === undefined) return detail.file;
  if (detail.column === undefined) return `${detail.file}:${detail.line}`;
  return `${detail.file}:${detail.line}:${detail.column}`;
}

function findingMessage(detail: FindingDetail): string {
  return detail.message ?? `${detail.rule} ${detail.anchor}`;
}

function regressionTag(regression: Regression): string {
  return regression.kind === "new" ? "new" : `worsened ${regression.previous} → ${regression.value}`;
}

function tagKind(tag: string): FindingOutput["tagKind"] {
  return tag.startsWith("worsened") ? "worsened" : tag as FindingOutput["tagKind"];
}

function findingOutput(detail: FindingDetail, tag: string): FindingOutput {
  return {
    body: `${location(detail)}  ${detail.rule}  ${findingMessage(detail)}`,
    file: detail.file, line: detail.line, column: detail.column, rule: detail.rule,
    anchor: detail.anchor, tag, tagKind: tagKind(tag),
  };
}

function duplicateLocation(duplicate: DuplicateDetail): string {
  return `${duplicate.file}:${duplicate.line}-${duplicate.endLine} ↔ `
    + `${duplicate.secondFile}:${duplicate.secondLine}-${duplicate.secondEndLine}`;
}

function duplicateMessage(duplicate: DuplicateDetail): string {
  return `${duplicate.lines} lines, ${duplicate.tokens} tokens duplicated`;
}

function duplicateOutput(duplicate: DuplicateDetail, tag: string): FindingOutput {
  return {
    body: `${duplicateLocation(duplicate)}  duplication  ${duplicateMessage(duplicate)}`,
    file: duplicate.file, line: duplicate.line, rule: "duplication",
    anchor: duplicateLocation(duplicate), tag, tagKind: tagKind(tag),
  };
}

function staleParts(entry: StaleEntry): { file: string; rule: string; anchor?: string } {
  return parseFindingKey(entry.key) ?? { file: entry.key, rule: "duplication" };
}

function staleOutput(entry: StaleEntry): FindingOutput {
  const parts = staleParts(entry);
  const anchor = parts.anchor === undefined ? "" : `  ${parts.anchor}`;
  const tag = entry.value === undefined
    ? `stale (was ${entry.previous})`
    : `improved ${entry.previous} → ${entry.value}`;
  return {
    body: `${parts.file}  ${parts.rule}${anchor}`, file: parts.file,
    rule: parts.rule, anchor: parts.anchor ?? "",
    tag,
    tagKind: entry.value === undefined ? "stale" : "improved",
  };
}

function keyOutput(key: string, tag: string): FindingOutput {
  const parts = parseFindingKey(key) ?? { file: key, rule: "duplication", anchor: "" };
  const anchor = parts.anchor === "" ? "" : `  ${parts.anchor}`;
  return {
    body: `${parts.file}  ${parts.rule}${anchor}`, file: parts.file,
    rule: parts.rule, anchor: parts.anchor, tag, tagKind: tagKind(tag),
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareFinding(left: FindingOutput, right: FindingOutput): number {
  const file = compareText(left.file, right.file);
  if (file !== 0) return file;
  const line = (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER);
  if (line !== 0) return line;
  const column = (left.column ?? Number.MAX_SAFE_INTEGER) - (right.column ?? Number.MAX_SAFE_INTEGER);
  if (column !== 0) return column;
  const rule = compareText(left.rule, right.rule);
  return rule === 0 ? compareText(left.anchor, right.anchor) : rule;
}

function normalFindingLines(outcome: GateOutcome, all: boolean): FindingOutput[] {
  const outputs = outcome.regressions.map((regression) => {
    const detail = outcome.details[regression.key];
    const tag = regressionTag(regression);
    return detail === undefined ? keyOutput(regression.key, tag) : findingOutput(detail, tag);
  });
  outputs.push(...outcome.stale.map(staleOutput));
  if (all) {
    const regressions = new Set(outcome.regressions.map((entry) => entry.key));
    const stale = new Set(outcome.stale.map((entry) => entry.key));
    for (const key of Object.keys(outcome.details)) {
      const detail = outcome.details[key];
      if (!regressions.has(key) && !stale.has(key) && detail !== undefined) {
        outputs.push(findingOutput(detail, "baselined"));
      }
    }
  }
  return outputs.toSorted(compareFinding);
}

function duplicateFindingLines(outcome: GateOutcome, all: boolean): FindingOutput[] {
  const duplicates = outcome.duplicates ?? [];
  const hasRegressions = outcome.regressions.length > 0;
  const newDuplicates = hasRegressions ? duplicates.filter((entry) => entry.isNew) : [];
  const fallback = hasRegressions && newDuplicates.length === 0;
  const printed = fallback ? duplicates : newDuplicates;
  const lines = printed.map((entry) => duplicateOutput(entry, fallback ? "new?" : "new"));
  for (const regression of outcome.regressions) {
    if (regression.kind === "worsened") {
      const output = keyOutput(
        regression.key,
        `worsened ${regression.previous} → ${regression.value}`,
      );
      output.body = `${regression.key}  duplication  clone occurrences ${regression.previous} → `
        + `${regression.value}`;
      lines.push(output);
    }
  }
  lines.push(...outcome.stale.map(staleOutput));
  if (all) {
    const alreadyPrinted = new Set(printed);
    for (const duplicate of duplicates) {
      if (!alreadyPrinted.has(duplicate)) lines.push(duplicateOutput(duplicate, "baselined"));
    }
  }
  return lines;
}

function stripControls(value: string): string {
  return [...value]
    .filter((character) => character === "\r" || !isStrippedControl(character.codePointAt(0) ?? 0))
    .join("");
}
function escapeData(value: string): string {
  return stripControls(value)
    .replaceAll("%", "%25")
    .replaceAll("##[", "%23%23[")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}
function escapeProperty(value: string): string {
  return escapeData(value).replaceAll(",", "%2C").replaceAll(":", "%3A");
}
function annotation(detail: FindingDetail, id: string): string {
  const line = detail.line === undefined ? "" : `,line=${detail.line}`;
  const column = detail.column === undefined ? "" : `,col=${detail.column}`;
  const title = escapeProperty(`${id} ${detail.rule}`);
  return `::error file=${escapeProperty(detail.file)}${line}${column},title=${title}::`
    + escapeData(findingMessage(detail));
}
function duplicateAnnotation(duplicate: DuplicateDetail, id: string): string {
  return `::error file=${escapeProperty(duplicate.file)},line=${duplicate.line},title=`
    + `${escapeProperty(`${id} duplication`)}::${escapeData(duplicateMessage(duplicate))}`;
}
function annotationLines(outcome: GateOutcome, check: LogicalCheckId): string[] {
  if (check === "duplication") {
    const duplicates = outcome.duplicates ?? [];
    if (outcome.regressions.length === 0) return [];
    const selected = duplicates.some((entry) => entry.isNew)
      ? duplicates.filter((entry) => entry.isNew) : duplicates;
    return selected.map((entry) => duplicateAnnotation(entry, outcome.id));
  }
  return outcome.regressions.flatMap((entry) => {
    const detail = outcome.details[entry.key];
    return detail === undefined ? [] : [annotation(detail, outcome.id)];
  });
}

function styledFinding(output: FindingOutput, style: Style): string {
  const body = sanitizeLine(output.body);
  const tag = sanitizeLine(output.tag);
  if (output.tagKind === "new" || output.tagKind === "new?") {
    return `${body}  ${style.bold(style.red(tag))}`;
  }
  if (output.tagKind === "worsened") return `${body}  ${style.red(tag)}`;
  if (output.tagKind === "baselined") return `${body}  ${style.gray(tag)}`;
  return `${body}  ${style.yellow(tag)}`;
}

export function plural(count: number, singular: string, pluralNoun = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralNoun}`;
}

export function fieldLine(
  label: string,
  value: string,
  style: Style,
  boldLabel = false,
): string {
  const padded = sanitizeLine(label).padEnd(8);
  return ` ${boldLabel ? style.bold(padded) : padded} ${value}`;
}

function errorMessage(outcome: GateOutcome): string | undefined {
  if (outcome.ok || outcome.message === undefined) return undefined;
  if (outcome.regressions.length > 0 || outcome.stale.length > 0) return undefined;
  const prefix = `${outcome.id}: `;
  return outcome.message.startsWith(prefix) ? outcome.message.slice(prefix.length) : outcome.message;
}

export function renderHeader(
  input: { version: string; languages: readonly string[]; checks: number },
  style: Style,
): string {
  const title = sanitizeLine(`code-quality ${input.version}`);
  const suffix = sanitizeLine(` · ${input.languages.join(", ")} · ${plural(input.checks, "check")}`);
  return ` ${style.bold(title)}${style.dim(suffix)}`;
}

export function renderCheck(
  row: OutcomeRow,
  options: { all: boolean; githubActions: boolean; idWidth: number; toolWidth: number },
  style: Style,
): string[] {
  const { outcome } = row;
  const glyph = outcome.ok ? style.green(GLYPH.pass) : style.red(GLYPH.fail);
  const id = style.bold(sanitizeLine(outcome.id).padEnd(options.idWidth));
  const error = errorMessage(outcome);
  let status: string;
  if (error !== undefined) {
    status = ` ${glyph} ${id}  ${style.bold(style.red("ERROR"))}  ${sanitizeLine(error)}`;
  } else {
    let counts = row.check === "duplication"
      ? plural(outcome.count, "clone")
      : plural(outcome.count, "finding");
    if (outcome.regressions.length > 0) {
      counts += ` · ${style.bold(style.red(`${outcome.regressions.length} new`))}`;
    }
    if (outcome.stale.length > 0) counts += ` · ${style.yellow(`${outcome.stale.length} stale`)}`;
    const tool = style.dim(sanitizeLine(outcome.tool).padEnd(options.toolWidth));
    status = ` ${glyph} ${id}  ${tool}  ${counts}`;
  }
  const outputs = row.check === "duplication"
    ? duplicateFindingLines(outcome, options.all)
    : normalFindingLines(outcome, options.all);
  const findings = outputs.map((output) => `   ${GLYPH.branch} ${styledFinding(output, style)}`);
  if (options.githubActions) findings.push(...annotationLines(outcome, row.check));
  return [status, ...findings];
}

export function renderSkipped(entry: SkippedEntry, idWidth: number, style: Style): string {
  return style.dim(` ${GLYPH.skip} ${sanitizeLine(entry.id).padEnd(idWidth)}  skipped: ${sanitizeLine(entry.reason)}`);
}

export function renderSummary(rows: readonly OutcomeRow[], skipped: readonly SkippedEntry[], style: Style): string[] {
  const passed = rows.filter((row) => row.outcome.ok).length;
  const failed = rows.length - passed;
  const regressions = rows.reduce((total, row) => total + row.outcome.regressions.length, 0);
  const stale = rows.reduce((total, row) => total + row.outcome.stale.length, 0);
  const lines = [""];
  let checks = `${passed} passed`;
  if (failed > 0) checks += ` · ${style.red(`${failed} failed`)}`;
  lines.push(fieldLine("Checks", checks, style));
  if (regressions > 0) {
    lines.push(fieldLine("Blocking", style.red(`${plural(regressions, "new finding")}`), style));
  }
  if (stale > 0) {
    lines.push(fieldLine(
      "Stale",
      style.yellow(`${plural(stale, "baseline entry", "baseline entries")} to tighten`),
      style,
    ));
  }
  if (skipped.length > 0) lines.push(style.dim(fieldLine("Skipped", String(skipped.length), style)));
  const result = failed === 0 ? style.bold(style.green("PASS")) : style.bold(style.red("FAIL"));
  lines.push(fieldLine("Result", result, style));
  return lines;
}

export function renderNotice(message: string, style: Style): string {
  return ` ${style.yellow(GLYPH.bullet)} ${style.dim(`Notice: ${sanitizeLine(message)}`)}`;
}
