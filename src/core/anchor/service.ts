import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { Language, Parser, type Node, type Tree } from "web-tree-sitter";

import { fail } from "../errors.ts";
import { KINDS, grammarFor, labelFor, type Grammar } from "./kinds.ts";
import { byteOffsetToIndex } from "./offsets.ts";
import { structuralPath } from "./path.ts";

export interface AnchorService {
  anchor(file: string, source: string, byteOffset: number, blockMode: boolean): Promise<string>;
}

export function assetsDir(): string {
  return process.env.CODE_QUALITY_ASSETS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "assets");
}

function isBlock(grammar: Grammar, node: Node): boolean {
  return Object.hasOwn(KINDS[grammar].blocks, node.type);
}

function isGenericBlock(grammar: Grammar, node: Node): boolean {
  return (grammar === "php" && node.type === "compound_statement") ||
    (grammar !== "php" && grammar !== "python" && node.type === "statement_block");
}

function blockTarget(grammar: Grammar, node: Node): Node | null {
  let current: Node | null = node;
  while (current) {
    if (isBlock(grammar, current)) {
      const parentIsControl = current.parent && isBlock(grammar, current.parent) && !isGenericBlock(grammar, current.parent);
      if (grammar === "python" || !isGenericBlock(grammar, current) || !parentIsControl) return current;
    }
    current = current.parent;
  }
  return null;
}

function functionTarget(grammar: Grammar, node: Node, source: string): Node | null {
  let container: Node | null = null;
  let current: Node | null = node;
  while (current) {
    if (Object.hasOwn(KINDS[grammar].functions, current.type)) return current;
    if (!container && Object.hasOwn(KINDS[grammar].containers, current.type) && labelFor(grammar, current, source)) {
      container = current;
    }
    current = current.parent;
  }
  return container;
}

export function createAnchorService(dir = assetsDir()): AnchorService {
  const languages = new Map<Grammar, Promise<Language>>();
  let ready: Promise<void> | undefined;
  const init = (): Promise<void> =>
    (ready ??= Parser.init({ locateFile: () => join(dir, "web-tree-sitter.wasm") }));
  const load = (grammar: Grammar): Promise<Language> => {
    const cached = languages.get(grammar);
    if (cached) return cached;
    const loaded = init().then(() => Language.load(join(dir, `tree-sitter-${grammar}.wasm`)));
    languages.set(grammar, loaded);
    return loaded;
  };
  return {
    async anchor(file, source, byteOffset, blockMode) {
      const grammar = grammarFor(file);
      const language = await load(grammar);
      const parser = new Parser();
      let tree: Tree | null;
      try {
        parser.setLanguage(language);
        tree = parser.parse(source);
      } finally {
        parser.delete();
      }
      if (!tree) return fail(`${file}: grammar could not parse the file`);
      if (tree.rootNode.hasError) {
        tree.delete();
        return fail(`${file}: grammar could not parse the file`);
      }
      try {
        const index = byteOffsetToIndex(source, byteOffset);
        const leaf = tree.rootNode.descendantForIndex(index) ?? fail(
          `${file}: cannot identify diagnostic anchor at byte ${byteOffset}`,
        );
        const target = blockMode ? blockTarget(grammar, leaf) : functionTarget(grammar, leaf, source);
        if (!target) return fail(`${file}: cannot identify diagnostic anchor at byte ${byteOffset}`);
        return structuralPath(grammar, target, source);
      } finally {
        tree.delete();
      }
    },
  };
}
