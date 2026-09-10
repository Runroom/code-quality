module.exports = {
  forbidden: [
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    { name: "core-independent", severity: "error", from: { path: "^src/core" }, to: { path: "^src/(checks|cli|registry|report)" } },
    { name: "checks-no-cli", severity: "error", from: { path: "^src/checks" }, to: { path: "^src/(cli|report)" } },
    { name: "registry-no-cli", severity: "error", from: { path: "^src/registry\\.ts$" }, to: { path: "^src/(cli|report)" } },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" },
  },
};
