import { expect, it } from "vitest";

import { ADAPTERS } from "../../../src/registry.ts";

it("registers every Python adapter", () => {
  const ids = ADAPTERS.filter((adapter) => adapter.language === "python")
    .map((adapter) => adapter.id);
  expect(ids).toEqual([
    "python-complexity",
    "python-cognitive",
    "python-duplication",
    "python-unused-vulture",
    "python-unused-deptry",
    "python-architecture",
  ]);
});
