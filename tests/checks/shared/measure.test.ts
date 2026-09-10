import { describe, expect, it } from "vitest";

import { extractMeasurement } from "../../../src/checks/shared/measure.ts";

describe("extractMeasurement", () => {
  it("extracts the first capture", () => {
    expect(extractMeasurement(/value (\d+)/u, "value 17", "rule")).toBe(17);
  });

  it("fails closed when the message does not match", () => {
    expect(() => extractMeasurement(/value (\d+)/u, "changed", "rule"))
      .toThrow("Unparsable metric message (rule): changed");
  });
});
