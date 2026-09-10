export const POLICY_VERSION = "2026-09-11.1";

export const POLICY = {
  complexity: 10,
  maxLinesPerFunction: 60,
  maxParams: 4,
  maxDepth: 3,
  maxNestedCallbacks: 3,
  cognitive: 15,
  duplication: { mode: "mild", minTokens: 50, minLines: 5 },
  advisoryDuplication: { mode: "semantic", near: true, minTokens: 50, minLines: 5 },
} as const;
