import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const ASSETS: ReadonlyArray<readonly [source: string, file: string]> = [
  [require.resolve("web-tree-sitter/web-tree-sitter.wasm"), "web-tree-sitter.wasm"],
  [require.resolve("tree-sitter-typescript/tree-sitter-typescript.wasm"), "tree-sitter-typescript.wasm"],
  [require.resolve("tree-sitter-typescript/tree-sitter-tsx.wasm"), "tree-sitter-tsx.wasm"],
  [require.resolve("tree-sitter-javascript/tree-sitter-javascript.wasm"), "tree-sitter-javascript.wasm"],
  [require.resolve("tree-sitter-php/tree-sitter-php.wasm"), "tree-sitter-php.wasm"],
  [require.resolve("tree-sitter-python/tree-sitter-python.wasm"), "tree-sitter-python.wasm"],
];

export function copyAssets(root = process.cwd(), out = join(root, "dist/assets")): void {
  mkdirSync(out, { recursive: true });
  for (const [source, file] of ASSETS) copyFileSync(source, join(out, file));
}
export default function setup(): void { copyAssets(); }
if (process.argv[1]?.endsWith("copy-assets.ts")) copyAssets();
