import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

type Step = {
  uses?: string;
  run?: string;
  "working-directory"?: string;
  with?: Record<string, unknown>;
};

type Job = {
  needs?: string[];
  permissions?: Record<string, string>;
  steps: Step[];
};

type Workflow = {
  on: { push: { tags: string[] } };
  permissions: Record<string, string>;
  jobs: { verify: Job; publish: Job; npm: Job };
};

function workflow(): Workflow {
  const file = join(process.cwd(), ".github/workflows/release.yml");
  return parse(readFileSync(file, "utf8")) as Workflow;
}

describe("release workflow", () => {
  it("pins every action to a commit SHA", () => {
    const actionSteps = Object.values(workflow().jobs).flatMap((job) => job.steps)
      .filter((step) => step.uses !== undefined);

    expect(actionSteps).not.toHaveLength(0);
    for (const step of actionSteps) expect(step.uses).toMatch(/@[0-9a-f]{40}$/u);
  });

  it("uses least-privilege job permissions and ordering", () => {
    const release = workflow();

    expect(release.on.push.tags).toEqual(["v*"]);
    expect(Object.keys(release.jobs)).toEqual(["verify", "publish", "npm"]);
    expect(release.permissions).toEqual({ contents: "read" });
    expect(release.jobs.publish.needs).toEqual(["verify"]);
    expect(release.jobs.publish.permissions).toEqual({ contents: "read", packages: "write" });
    expect(release.jobs.npm.needs).toEqual(["verify", "publish"]);
    expect(release.jobs.npm.permissions).toEqual({ contents: "read", "id-token": "write" });
  });

  it("checks the tag before building and uploads the launcher", () => {
    const steps = workflow().jobs.verify.steps;
    const versionIndex = steps.findIndex((step) =>
      step.run?.includes("GITHUB_REF_NAME#v") && step.run.includes("exit 1")
    );
    const buildIndex = steps.findIndex((step) => step.run === "pnpm build");
    const upload = steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));

    expect(versionIndex).toBeGreaterThanOrEqual(0);
    expect(versionIndex).toBeLessThan(buildIndex);
    expect(upload?.with).toMatchObject({ name: "launcher-dist" });
  });
});

describe("release publishers", () => {
  it("logs in to GHCR with the GitHub actor and token", () => {
    const login = workflow().jobs.publish.steps.find((step) =>
      step.uses?.startsWith("docker/login-action@")
    );

    expect(login?.with).toEqual({
      registry: "ghcr.io",
      username: "${{ github.actor }}",
      password: "${{ github.token }}",
    });
  });

  it("publishes both amd64 and arm64 semver tags", () => {
    const steps = workflow().jobs.publish.steps;
    const metadata = steps.find((step) => step.uses?.startsWith("docker/metadata-action@"));
    const build = steps.find((step) => step.uses?.startsWith("docker/build-push-action@"));
    const tags = String(metadata?.with?.tags);

    expect(tags).toContain("type=semver,pattern=v{{version}}");
    expect(tags).toContain("type=semver,pattern=v{{major}}");
    expect(String(build?.with?.platforms)).toContain("linux/amd64");
    expect(String(build?.with?.platforms)).toContain("linux/arm64");
    expect(build?.with).toMatchObject({ push: true });
  });

  it("downloads and publishes the npm launcher without pnpm", () => {
    const steps = workflow().jobs.npm.steps;
    const download = steps.find((step) => step.uses?.startsWith("actions/download-artifact@"));
    const npmInstall = steps.find((step) => step.run === "npm install -g npm@11.19.0");
    const publish = steps.find((step) => step.run?.includes("npm stage publish --provenance --access public --tag"));

    expect(download?.with).toMatchObject({ name: "launcher-dist", path: "launcher/dist" });
    expect(steps.some((step) => step.run?.startsWith("pnpm"))).toBe(false);
    expect(publish?.["working-directory"]).toBe("launcher");
    expect(npmInstall?.run).toBe("npm install -g npm@11.19.0");
    const npmInstallIndex = steps.findIndex((step) => step.run === "npm install -g npm@11.19.0");
    const publishIndex = steps.findIndex((step) => step.run?.includes("npm stage publish --provenance --access public --tag"));
    expect(npmInstallIndex).toBeLessThan(publishIndex);
  });

  it("does not configure an npm registry URL in an action", () => {
    const steps = Object.values(workflow().jobs).flatMap((job) => job.steps);
    expect(steps.every((step) => step.with?.["registry-url"] === undefined)).toBe(true);
  });
});
