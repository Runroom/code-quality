import { expect, it } from "vitest";

import { ADAPTERS } from "../../../src/registry.ts";

it("registers duplication as the only web adapter", () => {
  const webAdapters = ADAPTERS.filter((adapter) => adapter.language === "web");
  expect(webAdapters.map((adapter) => [adapter.id, adapter.check])).toEqual([
    ["web-duplication", "duplication"],
  ]);
});
