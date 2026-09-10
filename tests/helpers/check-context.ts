import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createAnchorService } from "../../src/core/anchor/service.ts";
import type { CheckContext, Language } from "../../src/core/types.ts";

export function checkContext(
  root: string,
  language: Language = "ts",
  sources: Readonly<Record<string, string>> = {},
): CheckContext {
  return {
    root,
    config: {
      root,
      languages: [language],
      paths: { [language]: ["src"] },
      exclude: [],
      disabled: [],
      architecture: {},
      configHash: "a".repeat(64),
    },
    language,
    paths: ["src"],
    tempDir: "/tmp/quality",
    artifactDir: "/tmp/artifacts",
    readSource: (file) => sources[file] ?? readFileSync(join(root, file), "utf8"),
    anchor: createAnchorService(),
  };
}
