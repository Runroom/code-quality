import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

type Step = {
  uses?: string;
  with?: Record<string, unknown>;
};

type Workflow = {
  on: { push: { tags: string[] } };
  permissions: { packages: string };
  jobs: { publish: { steps: Step[] } };
};

function workflow(): Workflow {
  const file = join(process.cwd(), ".github/workflows/release.yml");
  return parse(readFileSync(file, "utf8")) as Workflow;
}

describe("release workflow", () => {
  it("pins every action to a commit SHA", () => {
    const actionSteps = workflow().jobs.publish.steps.filter((step) => step.uses !== undefined);

    expect(actionSteps).not.toHaveLength(0);
    for (const step of actionSteps) expect(step.uses).toMatch(/@[0-9a-f]{40}$/u);
  });

  it("runs for version tags and can publish packages", () => {
    const release = workflow();

    expect(release.on.push.tags).toEqual(["v*"]);
    expect(release.permissions.packages).toBe("write");
  });

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
});
