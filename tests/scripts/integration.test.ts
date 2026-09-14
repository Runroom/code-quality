import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import {
  applyMutation,
  copyFixture,
  formatResultRow,
  formatResultTable,
  dockerArgs,
  MUTATIONS,
  mutationEvidenceOk,
  plannedDependencyInstalls,
  shouldCopyFixturePath,
} from "../../scripts/integration.ts";

it("runs mounted Docker fixtures as the host user when IDs are available", () => {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  const args = dockerArgs("code-quality:test", ["check"], "/fixture");

  if (uid !== undefined && gid !== undefined) {
    expect(args).toContain("--user");
    expect(args).toContain(`${uid}:${gid}`);
  }
});

const tsInstall = {
  fixture: "ts-project",
  entrypoint: "npm",
  command: ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
};
const payloadInstall = {
  fixture: "payload-project",
  entrypoint: "npm",
  command: ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
};
const phpInstall = {
  fixture: "php-project",
  entrypoint: "composer",
  command: ["install", "--no-interaction"],
};

const dependencyInstallCases = [
  [{ tsNodeModules: false, phpVendor: false, payloadNodeModules: false }, [tsInstall, phpInstall, payloadInstall]],
  [{ tsNodeModules: true, phpVendor: false, payloadNodeModules: false }, [phpInstall, payloadInstall]],
  [{ tsNodeModules: true, phpVendor: true, payloadNodeModules: false }, [payloadInstall]],
  [{ tsNodeModules: false, phpVendor: false, payloadNodeModules: true }, [tsInstall, phpInstall]],
  [{ tsNodeModules: true, phpVendor: false, payloadNodeModules: true }, [phpInstall]],
  [{ tsNodeModules: false, phpVendor: true, payloadNodeModules: true }, [tsInstall]],
  [{ tsNodeModules: false, phpVendor: true, payloadNodeModules: false }, [tsInstall, payloadInstall]],
  [{ tsNodeModules: true, phpVendor: true, payloadNodeModules: true }, []],
] as const;

it.each(dependencyInstallCases)("plans installs only for missing dependencies (%#)", (state, expected) => {
  expect(plannedDependencyInstalls(state)).toEqual(expected);
});

function withTempRoot(action: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "code-quality-integration-test-"));
  try {
    action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it("filters generated artifacts and temporary files but keeps evidence", () => {
  expect(shouldCopyFixturePath("artifacts/quality/check.json")).toBe(false);
  expect(shouldCopyFixturePath(".code-quality-tmp/jscpd.json")).toBe(false);
  expect(shouldCopyFixturePath("quality/ts-complexity-baseline.json")).toBe(true);
  expect(shouldCopyFixturePath("Makefile")).toBe(true);
  expect(shouldCopyFixturePath(".github/workflows/quality.yml")).toBe(true);
});

it("copies a fixture without artifacts or temporary files", () => {
  withTempRoot((root) => {
    const source = join(root, "source");
    const destination = join(root, "destination");
    mkdirSync(join(source, "quality"), { recursive: true });
    mkdirSync(join(source, "artifacts"), { recursive: true });
    mkdirSync(join(source, ".code-quality-tmp"), { recursive: true });
    writeFileSync(join(source, "quality", "baseline.json"), "evidence", "utf8");
    writeFileSync(join(source, "artifacts", "report.json"), "generated", "utf8");
    writeFileSync(join(source, ".code-quality-tmp", "config.json"), "generated", "utf8");

    copyFixture(source, destination);

    expect(readFileSync(join(destination, "quality", "baseline.json"), "utf8")).toBe("evidence");
    expect(existsSync(join(destination, "artifacts"))).toBe(false);
    expect(existsSync(join(destination, ".code-quality-tmp"))).toBe(false);
  });
});

it("applies append mutations", () => {
  withTempRoot((root) => {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "append.ts"), "before", "utf8");
    applyMutation(root, {
      fixture: "ts-project",
      file: "src/append.ts",
      append: " after",
      expect: "regressions",
    });
    expect(readFileSync(join(root, "src", "append.ts"), "utf8")).toBe("before after");
  });
});

it("applies content mutations", () => {
  withTempRoot((root) => {
    applyMutation(root, {
      fixture: "ts-project",
      file: "src/content.ts",
      content: "content\n",
    });
    expect(readFileSync(join(root, "src", "content.ts"), "utf8")).toBe("content\n");
  });
});

it("applies copy mutations", () => {
  withTempRoot((root) => {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "source.ts"), "source\n", "utf8");
    applyMutation(root, {
      fixture: "ts-project",
      file: "src/copy.ts",
      copyFrom: "src/source.ts",
      expect: "regressions",
    });
    expect(readFileSync(join(root, "src", "copy.ts"), "utf8")).toBe("source\n");
  });
});

it("defines a web duplication copy mutation", () => {
  expect(MUTATIONS).toContainEqual({
    fixture: "web-project",
    file: "templates/page-c.twig",
    copyFrom: "templates/page-a.twig",
    expect: "regressions",
  });
});

it("defines Drupal, Payload, and monorepo mutations", () => {
  expect(MUTATIONS).toContainEqual(expect.objectContaining({
    fixture: "drupal-project",
    file: "web/modules/custom/demo/demo.module",
    expect: "regressions",
  }));
  expect(MUTATIONS).toContainEqual(expect.objectContaining({
    fixture: "drupal-project",
    file: "web/modules/custom/demo/demo_copy.module",
    copyFrom: "web/modules/custom/demo/demo.module",
    expect: "regressions",
  }));
  expect(MUTATIONS).toContainEqual(expect.objectContaining({
    fixture: "payload-project",
    file: "src/payload-types.ts",
    expect: "regressions",
    exitCode: 0,
  }));
  expect(MUTATIONS).toContainEqual(expect.objectContaining({
    fixture: "monorepo-project",
    file: "packages/core/src/orphan.ts",
    expect: "regressions",
  }));
});

it("checks mutation stderr in both exit-code branches with an optional expectation", () => {
  const failure = { fixture: "ts-project", file: "src/x.ts", expect: "custom failure" } as const;
  const allowed = { fixture: "ts-project", file: "src/x.ts", exitCode: 0 } as const;
  expect(mutationEvidenceOk(failure, "custom failure found")).toBe(true);
  expect(mutationEvidenceOk(failure, "regressions found")).toBe(false);
  expect(mutationEvidenceOk(allowed, "all clear")).toBe(true);
  expect(mutationEvidenceOk(allowed, "regressions found")).toBe(false);
});

it("formats result rows and result tables", () => {
  const passing = { label: "versions", exitCode: 0, expectedExitCode: 0, stderr: "" };
  const failing = {
    label: "ts-project src/orphan2.ts",
    exitCode: 1,
    expectedExitCode: 1,
    stderr: "ts-unused regressions:",
    expectedStderr: "regressions",
  };

  expect(formatResultRow(passing)).toBe("versions | exit 0 | ok");
  expect(formatResultRow(failing)).toBe("ts-project src/orphan2.ts | exit 1 | ok");
  expect(formatResultTable([passing, failing])).toBe([
    "result | status",
    "versions | exit 0 | ok",
    "ts-project src/orphan2.ts | exit 1 | ok",
  ].join("\n"));
});
