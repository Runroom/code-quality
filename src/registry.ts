import { fail } from "./core/errors.ts";
import { LOGICAL_IDS, type LogicalCheckId } from "./core/config/schema.ts";
import { jscpdAdapter } from "./checks/shared/jscpd.ts";
import { dependencyCruiserAdapter } from "./checks/ts/dependency-cruiser.ts";
import { fallowAdapter } from "./checks/ts/fallow.ts";
import { knipAdapter } from "./checks/ts/knip.ts";
import { oxlintAdapter } from "./checks/ts/oxlint.ts";
import { composerUnusedAdapter } from "./checks/php/composer-unused.ts";
import { deptracAdapter } from "./checks/php/deptrac.ts";
import { phpcsCognitiveAdapter } from "./checks/php/phpcs-cognitive.ts";
import { phpcsComplexityAdapter } from "./checks/php/phpcs-complexity.ts";
import { phpstanDeadCodeAdapter } from "./checks/php/phpstan-dead-code.ts";
import { requireCheckerAdapter } from "./checks/php/require-checker.ts";
import { complexipyAdapter } from "./checks/python/complexipy.ts";
import { deptryAdapter } from "./checks/python/deptry.ts";
import { importLinterAdapter } from "./checks/python/import-linter.ts";
import { ruffAdapter } from "./checks/python/ruff.ts";
import { vultureAdapter } from "./checks/python/vulture.ts";
import type { CheckAdapter, ToolPin } from "./core/types.ts";

export const TOOL_PINS: readonly ToolPin[] = [
  { bin: "oxlint", version: "1.82.0" },
  { bin: "fallow", version: "3.23.0" },
  { bin: "jscpd", version: "5.2.0" },
  { bin: "knip", version: "6.35.1" },
  { bin: "depcruise", version: "18.2.0" },
  { bin: "phpcs", version: "4.0.4" },
  { bin: "phpstan", version: "2.2.13" },
  { bin: "deptrac", version: "4.7.1" },
  { bin: "composer-unused", version: "0.9.6" },
  { bin: "composer-require-checker", version: "4.24.0" },
  { bin: "ruff", version: "0.16.6" },
  { bin: "complexipy", version: "8.0.1" },
  { bin: "vulture", version: "2.16" },
  { bin: "deptry", version: "0.25.1" },
  { bin: "lint-imports", version: "2.15" },
];

export const LIBRARY_PINS = [
  {
    name: "slevomat/coding-standard",
    version: "8.31.1",
    installed: "/opt/php/phpcs/vendor/composer/installed.json",
  },
  {
    name: "shipmonk/dead-code-detector",
    version: "1.4.0",
    installed: "/opt/php/phpstan/vendor/composer/installed.json",
  },
] as const;

export const GRAMMAR_ASSETS = [
  "web-tree-sitter.wasm",
  "tree-sitter-typescript.wasm",
  "tree-sitter-tsx.wasm",
  "tree-sitter-javascript.wasm",
  "tree-sitter-php.wasm",
  "tree-sitter-python.wasm",
] as const;

export const ADAPTERS: readonly CheckAdapter[] = [
  oxlintAdapter,
  fallowAdapter,
  jscpdAdapter("ts"),
  knipAdapter,
  dependencyCruiserAdapter,
  phpcsComplexityAdapter,
  phpcsCognitiveAdapter,
  jscpdAdapter("php"),
  composerUnusedAdapter,
  requireCheckerAdapter,
  phpstanDeadCodeAdapter,
  deptracAdapter,
  ruffAdapter,
  complexipyAdapter,
  jscpdAdapter("python"),
  vultureAdapter,
  deptryAdapter,
  importLinterAdapter,
  jscpdAdapter("web"),
];

function isLogicalId(value: string): value is LogicalCheckId {
  return LOGICAL_IDS.includes(value as LogicalCheckId);
}

export function parseLogicalIds(raw: string[]): LogicalCheckId[] {
  return raw.map((value) => {
    if (!isLogicalId(value)) {
      return fail(`Unknown check id '${value}'. Known: ${LOGICAL_IDS.join(", ")}`);
    }
    return value;
  });
}
