import type { Regression, StaleEntry } from "../core/compare.ts";
import type { SkippedEntry } from "../core/gate/select.ts";
import type { GateOutcome } from "../core/gate/types.ts";
import { parseFindingKey } from "../core/types.ts";
import type { DuplicateDetail, FindingDetail, LogicalCheckId } from "../core/types.ts";

export interface OutcomeRow {
  outcome: GateOutcome;
  check: LogicalCheckId;
}

export interface RenderOptions {
  all?: boolean;
  githubActions?: boolean;
}

function isStrippedControl(code: number): boolean {
  return code <= 8 || (code >= 11 && code <= 31) || code === 127;
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
    const code = character.codePointAt(0) ?? 0;
    if (isStrippedControl(code)) continue;
    sanitized += character;
  }
  return neutralizeCommandPrefix(sanitized);
}

// The Actions runner (.NET) trims leading whitespace before looking for `::`; .NET treats more
// code points as whitespace than JS trimStart (e.g. U+0085), so match the Unicode property.
const LEADING_WHITESPACE = /^[\p{White_Space}\u180E\uFEFF]*/u;

function neutralizeCommandPrefix(line: string): string {
  const leading = LEADING_WHITESPACE.exec(line)?.[0].length ?? 0;
  if (!line.startsWith("::", leading)) return line;
  return `${line.slice(0, leading)}%3A%3A${line.slice(leading + 2)}`;
}

interface FindingOutput {
  text: string;
  file: string;
  line?: number | undefined;
  column?: number | undefined;
  rule: string;
  anchor: string;
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
  if (regression.kind === "new") return "[new]";
  return `[worsened ${regression.previous} → ${regression.value}]`;
}

function findingLine(detail: FindingDetail, tag: string): string {
  return `${location(detail)}  ${detail.rule}  ${findingMessage(detail)}  ${tag}`;
}

function duplicateLocation(duplicate: DuplicateDetail): string {
  return `${duplicate.file}:${duplicate.line}-${duplicate.endLine} ↔ `
    + `${duplicate.secondFile}:${duplicate.secondLine}-${duplicate.secondEndLine}`;
}

function duplicateMessage(duplicate: DuplicateDetail): string {
  return `${duplicate.lines} lines, ${duplicate.tokens} tokens duplicated`;
}

function duplicateLine(duplicate: DuplicateDetail, tag: string): string {
  return `${duplicateLocation(duplicate)}  duplication  ${duplicateMessage(duplicate)}  ${tag}`;
}

function staleParts(entry: StaleEntry): { file: string; rule: string; anchor?: string } {
  return parseFindingKey(entry.key) ?? { file: entry.key, rule: "duplication" };
}

function staleLine(entry: StaleEntry): string {
  const parts = staleParts(entry);
  const anchor = parts.anchor === undefined ? "" : `  ${parts.anchor}`;
  const tag = entry.value === undefined
    ? `[stale: was ${entry.previous}]`
    : `[improved ${entry.previous} → ${entry.value}]`;
  return `${parts.file}  ${parts.rule}${anchor}  ${tag}`;
}

function findingOutput(detail: FindingDetail, tag: string): FindingOutput {
  return {
    text: findingLine(detail, tag),
    file: detail.file,
    line: detail.line,
    column: detail.column,
    rule: detail.rule,
    anchor: detail.anchor,
  };
}

function staleOutput(entry: StaleEntry): FindingOutput {
  const parts = staleParts(entry);
  return {
    text: staleLine(entry),
    file: parts.file,
    rule: parts.rule,
    anchor: parts.anchor ?? "",
  };
}

function keyOutput(key: string, tag: string): FindingOutput {
  const parts = parseFindingKey(key) ?? { file: key, rule: "duplication", anchor: "" };
  const anchor = parts.anchor === "" ? "" : `  ${parts.anchor}`;
  return {
    text: `${parts.file}  ${parts.rule}${anchor}  ${tag}`,
    file: parts.file,
    rule: parts.rule,
    anchor: parts.anchor,
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
  const column = (left.column ?? Number.MAX_SAFE_INTEGER)
    - (right.column ?? Number.MAX_SAFE_INTEGER);
  if (column !== 0) return column;
  const rule = compareText(left.rule, right.rule);
  return rule === 0 ? compareText(left.anchor, right.anchor) : rule;
}

function normalFindingLines(outcome: GateOutcome, all: boolean): string[] {
  const outputs = outcome.regressions.map((regression) => {
    const detail = outcome.details[regression.key];
    if (detail !== undefined) return findingOutput(detail, regressionTag(regression));
    return keyOutput(regression.key, regressionTag(regression));
  });
  outputs.push(...outcome.stale.map(staleOutput));
  if (all) {
    const regressions = new Set(outcome.regressions.map((entry) => entry.key));
    const stale = new Set(outcome.stale.map((entry) => entry.key));
    for (const key of Object.keys(outcome.details)) {
      const detail = outcome.details[key];
      if (!regressions.has(key) && !stale.has(key) && detail !== undefined) {
        outputs.push(findingOutput(detail, "[baselined]"));
      }
    }
  }
  return outputs.toSorted(compareFinding).map((output) => output.text);
}

function duplicateFindingLines(outcome: GateOutcome, all: boolean): string[] {
  const duplicates = outcome.duplicates ?? [];
  const hasRegressions = outcome.regressions.length > 0;
  const newDuplicates = hasRegressions ? duplicates.filter((entry) => entry.isNew) : [];
  const fallback = hasRegressions && newDuplicates.length === 0;
  const printed = fallback ? duplicates : newDuplicates;
  const lines = printed.map((entry) => duplicateLine(entry, fallback ? "[new?]" : "[new]"));
  for (const regression of outcome.regressions) {
    if (regression.kind === "worsened") {
      lines.push(`${regression.key}  duplication  clone occurrences ${regression.previous} → `
        + `${regression.value}  ${regressionTag(regression)}`);
    }
  }
  lines.push(...outcome.stale.map(staleLine));
  if (all) {
    const alreadyPrinted = new Set(printed);
    for (const duplicate of duplicates) {
      if (!alreadyPrinted.has(duplicate)) lines.push(duplicateLine(duplicate, "[baselined]"));
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
  return stripControls(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
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
      ? duplicates.filter((entry) => entry.isNew)
      : duplicates;
    return selected.map((entry) => duplicateAnnotation(entry, outcome.id));
  }
  return outcome.regressions.flatMap((entry) => {
    const detail = outcome.details[entry.key];
    return detail === undefined ? [] : [annotation(detail, outcome.id)];
  });
}

export function renderOutcome(row: OutcomeRow, options: RenderOptions = {}): string[] {
  const lines = row.check === "duplication"
    ? duplicateFindingLines(row.outcome, options.all === true)
    : normalFindingLines(row.outcome, options.all === true);
  const safeLines = lines.map(sanitizeLine);
  if (options.githubActions === true) safeLines.push(...annotationLines(row.outcome, row.check));
  return safeLines;
}

function errorMessage(outcome: GateOutcome): string | undefined {
  if (outcome.ok || outcome.message === undefined) return undefined;
  if (outcome.regressions.length > 0 || outcome.stale.length > 0) return undefined;
  const prefix = `${outcome.id}: `;
  return outcome.message.startsWith(prefix) ? outcome.message.slice(prefix.length) : outcome.message;
}

function resultBody(row: OutcomeRow, toolWidth: number): string {
  const error = errorMessage(row.outcome);
  if (error !== undefined) return `ERROR: ${error}`;
  const noun = row.check === "duplication" ? "clone occurrences" : "findings";
  const counts = `${row.outcome.count} ${noun} · ${row.outcome.regressions.length} new · `
    + `${row.outcome.stale.length} stale`;
  return `${row.outcome.tool.padEnd(toolWidth)}  ${counts}  ${row.outcome.ok ? "OK" : "FAIL"}`;
}

export function renderSummary(rows: readonly OutcomeRow[], skipped: readonly SkippedEntry[]): string[] {
  const idWidth = Math.max(...[...rows.map((row) => row.outcome.id), ...skipped.map((row) => row.id)]
    .map((id) => id.length), 0);
  const toolWidth = Math.max(...rows.map((row) => row.outcome.tool.length), 0);
  const lines = rows.map((row) => `${row.outcome.id.padEnd(idWidth)}  ${resultBody(row, toolWidth)}`);
  lines.push(...skipped.map((row) => `${row.id.padEnd(idWidth)}  skipped: ${row.reason}`));
  const failures = rows.filter((row) => !row.outcome.ok).length;
  const total = rows.length;
  lines.push(failures === 0
    ? `code-quality: PASS (${total} checks)`
    : `code-quality: FAIL (${failures} of ${total} checks)`);
  return lines.map(sanitizeLine);
}
