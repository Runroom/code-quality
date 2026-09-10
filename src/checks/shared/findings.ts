import { fail } from "../../core/errors.ts";
import { sortFindings } from "../../core/snapshot.ts";
import type { Findings } from "../../core/types.ts";

export class FindingsBuilder {
  readonly #findings: Record<string, number> = {};

  add(file: string, rule: string, anchor: string, value: number): void {
    this.addRaw(`${file} | ${rule} | ${anchor}`, value);
  }

  addRaw(key: string, value: number): void {
    if (!Number.isInteger(value) || value <= 0) {
      return fail(`Finding value must be a positive integer: ${key}`);
    }
    if (Object.hasOwn(this.#findings, key)) {
      return fail(`Ambiguous duplicate diagnostic: ${key}`);
    }
    this.#findings[key] = value;
  }

  build(): Findings {
    return sortFindings(this.#findings);
  }
}
