import { extname } from "node:path";

import type { Node } from "web-tree-sitter";

import { fail } from "../errors.ts";

export type Grammar = "typescript" | "tsx" | "javascript" | "php" | "python";

export interface KindTable {
  functions: Record<string, "function" | "method">;
  containers: Record<string, string>;
  blocks: Record<string, string>;
  transparent: ReadonlySet<string>;
}

const JS_FUNCTIONS: KindTable["functions"] = {
  function_declaration: "function",
  generator_function_declaration: "function",
  method_definition: "method",
  arrow_function: "function",
  function_expression: "function",
  generator_function: "function",
};
const JS_CONTAINERS = {
  class_declaration: "class",
  abstract_class_declaration: "class",
  class: "class",
};
const JS_BLOCKS = {
  statement_block: "block",
  if_statement: "if",
  for_statement: "for",
  for_in_statement: "for_in",
  while_statement: "while",
  do_statement: "do",
  switch_statement: "switch",
  try_statement: "try",
  with_statement: "with",
};
const JS_KINDS: KindTable = {
  functions: JS_FUNCTIONS,
  containers: JS_CONTAINERS,
  blocks: JS_BLOCKS,
  transparent: new Set<string>(),
};

const TS_KINDS: KindTable = {
  functions: {
    ...JS_FUNCTIONS,
    function_type: "function",
    method_signature: "method",
    function_signature: "function",
    abstract_method_signature: "method",
    construct_signature: "function",
  },
  containers: {
    ...JS_CONTAINERS,
    interface_declaration: "interface",
    type_alias_declaration: "type",
    enum_declaration: "enum",
  },
  blocks: JS_BLOCKS,
  transparent: new Set(["object_type"]),
};

export const KINDS: Record<Grammar, KindTable> = {
  typescript: TS_KINDS,
  tsx: TS_KINDS,
  javascript: JS_KINDS,
  php: {
    functions: {
      function_definition: "function",
      method_declaration: "method",
      anonymous_function: "function",
      arrow_function: "function",
    },
    containers: {
      class_declaration: "class",
      interface_declaration: "interface",
      trait_declaration: "trait",
      enum_declaration: "enum",
    },
    blocks: {
      compound_statement: "block",
      if_statement: "if",
      for_statement: "for",
      foreach_statement: "foreach",
      while_statement: "while",
      do_statement: "do",
      switch_statement: "switch",
      try_statement: "try",
    },
    transparent: new Set<string>(),
  },
  python: {
    functions: { function_definition: "function", lambda: "function" },
    containers: { class_definition: "class" },
    blocks: {
      block: "block",
      if_statement: "if",
      for_statement: "for",
      while_statement: "while",
      try_statement: "try",
      with_statement: "with",
      match_statement: "match",
    },
    transparent: new Set(["decorated_definition"]),
  },
};

const EXTENSIONS: Readonly<Record<string, Grammar>> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".php": "php",
  ".py": "python",
};

export function grammarFor(file: string): Grammar {
  return EXTENSIONS[extname(file)] ?? fail(`${file}: unsupported grammar`);
}

function nodeName(node: Node, source: string): string | null {
  const name = node.childForFieldName("name");
  return name ? source.slice(name.startIndex, name.endIndex) : null;
}

const NAMED_ASSIGNMENT_PARENTS = new Set([
  "variable_declarator", "property_signature", "method_signature",
]);

function pairName(node: Node, source: string): string | null {
  const key = node.childForFieldName("key");
  return key ? source.slice(key.startIndex, key.endIndex) : null;
}

function assignedName(node: Node, source: string): string | null {
  const parent = node.parent;
  if (parent && NAMED_ASSIGNMENT_PARENTS.has(parent.type)) return nodeName(parent, source);
  if (parent?.type === "type_annotation" && parent.parent?.type === "property_signature") {
    return nodeName(parent.parent, source);
  }
  if (parent?.type === "pair") return pairName(parent, source);
  return null;
}

function nearestPythonOwner(node: Node): "class" | "function" | null {
  let current = node.parent;
  while (current) {
    if (current.type === "class_definition") return "class";
    if (current.type === "function_definition" || current.type === "lambda") return "function";
    current = current.parent;
  }
  return null;
}

function functionLabel(grammar: Grammar, node: Node, source: string, prefix: string): string {
  if (grammar === "python" && node.type === "function_definition" && nearestPythonOwner(node) === "class") {
    return `method:${nodeName(node, source) ?? ""}`;
  }
  const assigned = assignedName(node, source);
  const name = nodeName(node, source) ?? assigned;
  const label = node.type === "function_type" && assigned ? "method" : prefix;
  return name ? `${label}:${name}` : label;
}

export function labelFor(grammar: Grammar, node: Node, source: string): string | null {
  if (!node.isNamed) return null;
  const kinds = KINDS[grammar];
  const functionPrefix = kinds.functions[node.type];
  if (functionPrefix) return functionLabel(grammar, node, source, functionPrefix);
  const containerPrefix = kinds.containers[node.type];
  if (containerPrefix) {
    const name = nodeName(node, source);
    return name ? `${containerPrefix}:${name}` : containerPrefix;
  }
  return kinds.blocks[node.type] ?? null;
}
