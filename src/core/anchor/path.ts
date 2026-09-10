import type { Node } from "web-tree-sitter";

import { KINDS, labelFor, type Grammar } from "./kinds.ts";

interface PathMode {
  blocks: boolean;
  grammar: Grammar;
}

function isFunctionBodyBlock(node: Node, mode: PathMode): boolean {
  if (mode.grammar === "python") {
    return node.type === "block" && node.parent?.type === "class_definition";
  }
  if (mode.grammar === "php") return false;
  if (node.type !== "statement_block") return false;
  const parentType = node.parent?.type ?? "";
  return Object.hasOwn(KINDS[mode.grammar].functions, parentType);
}

function isStructural(node: Node, source: string, mode: PathMode): boolean {
  if (!labelFor(mode.grammar, node, source)) return false;
  const isBlock = Object.hasOwn(KINDS[mode.grammar].blocks, node.type);
  if (!mode.blocks && isBlock) return false;
  return !isFunctionBodyBlock(node, mode);
}

function structuralParent(node: Node, source: string, mode: PathMode): Node | null {
  let current = node.parent;
  while (current && !isStructural(current, source, mode)) current = current.parent;
  return current;
}

function structuralChildren(parent: Node, source: string, mode: PathMode): Node[] {
  const result: Node[] = [];
  const stack = parent.namedChildren.toReversed();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (isStructural(current, source, mode)) result.push(current);
    else stack.push(...current.namedChildren.toReversed());
  }
  return result;
}

function rootOf(node: Node): Node {
  let root = node;
  while (root.parent) root = root.parent;
  return root;
}

function ordinalSuffix(node: Node, source: string, mode: PathMode): string {
  const label = labelFor(mode.grammar, node, source)!;
  const boundary = structuralParent(node, source, mode) ?? rootOf(node);
  const matches = structuralChildren(boundary, source, mode).filter(
    (candidate) => labelFor(mode.grammar, candidate, source) === label,
  );
  if (matches.length < 2) return "";
  return `[${matches.findIndex((candidate) => candidate.id === node.id)}]`;
}

export function structuralPath(grammar: Grammar, node: Node, source: string): string {
  const mode = { blocks: Object.hasOwn(KINDS[grammar].blocks, node.type), grammar };
  const parts: string[] = [];
  let current: Node | null = node;
  while (current) {
    if (isStructural(current, source, mode)) {
      parts.push(`${labelFor(grammar, current, source)!}${ordinalSuffix(current, source, mode)}`);
    }
    current = current.parent;
  }
  return `/${parts.toReversed().join("/")}`;
}
