import { fail } from "../../core/errors.ts";
import { sortFindings } from "../../core/snapshot.ts";
import type {
  DuplicateDetail,
  FindingDetail,
  ParsedFindings,
} from "../../core/types.ts";
import { buildFindingKey } from "../../core/types.ts";

type AddDetail = Partial<Pick<FindingDetail, "line" | "column" | "message" | "threshold">>;
type FindingInput = Pick<FindingDetail, "file" | "rule" | "anchor" | "value"> & AddDetail;

export class FindingsBuilder {
  readonly #findings: Record<string, number> = {};
  readonly #details: Record<string, FindingDetail> = {};
  #duplicates: DuplicateDetail[] | undefined;

  add(input: FindingInput): void {
    this.addRaw(buildFindingKey(input), input.value, input);
  }

  addRaw(key: string, value: number, detail: Partial<FindingDetail> = {}): void {
    if (!Number.isInteger(value) || value <= 0) {
      return fail(`Finding value must be a positive integer: ${key}`);
    }
    if (Object.hasOwn(this.#findings, key)) {
      return fail(`Ambiguous duplicate diagnostic: ${key}`);
    }
    this.#findings[key] = value;
    this.#details[key] = {
      file: detail.file ?? key,
      rule: detail.rule ?? "duplication",
      anchor: detail.anchor ?? key,
      ...detail,
      value,
    };
  }

  setDuplicates(list: DuplicateDetail[]): void {
    this.#duplicates = list;
  }

  build(): ParsedFindings {
    const findings = sortFindings(this.#findings);
    const details = Object.fromEntries(Object.keys(findings).map((key) => [key, this.#details[key]!]));
    return {
      findings,
      details,
      ...(this.#duplicates === undefined ? {} : { duplicates: this.#duplicates }),
    };
  }
}
