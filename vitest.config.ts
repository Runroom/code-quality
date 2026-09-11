import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./scripts/copy-assets.ts", "./scripts/build-launcher.ts"],
    env: { CODE_QUALITY_ASSETS_DIR: "dist/assets" },
    testTimeout: 30_000,
    passWithNoTests: true,
  },
});
