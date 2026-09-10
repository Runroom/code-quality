module.exports = {
  forbidden: [{
    name: "no-ui-to-db",
    severity: "error",
    from: { path: "^src/ui" },
    to: { path: "^src/db" },
  }],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" },
  },
};
