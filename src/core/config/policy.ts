export const POLICY_VERSION = "2026-09-23.2";

export const POLICY = {
  complexity: 10,
  maxLinesPerFunction: 60,
  maxParams: 4,
  maxDepth: 3,
  maxNestedCallbacks: 3,
  cognitive: 15,
  jsx: { complexity: 15, maxLinesPerFunction: 120 },
  duplication: { mode: "mild", minTokens: 50, minLines: 5 },
  advisoryDuplication: { mode: "semantic", near: true, minTokens: 50, minLines: 5 },
} as const;
