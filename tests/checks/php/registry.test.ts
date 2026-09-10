import { expect, it } from "vitest";

import { ADAPTERS } from "../../../src/registry.ts";

it("registers every PHP adapter", () => {
  const ids = ADAPTERS.filter((adapter) => adapter.language === "php")
    .map((adapter) => adapter.id);
  expect(ids).toEqual([
    "php-complexity-phpmd",
    "php-complexity-phpcs",
    "php-cognitive",
    "php-duplication",
    "php-unused-composer-unused",
    "php-unused-require-checker",
    "php-unused-phpstan",
    "php-architecture",
  ]);
});
