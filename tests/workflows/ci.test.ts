import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  "working-directory"?: string;
  with?: Record<string, unknown>;
};

type Job = {
  needs?: string[];
  steps: Step[];
};

type Workflow = {
  jobs: {
    unit: Job;
    actionlint: Job;
    image: Job;
  };
};

function workflow(): Workflow {
  const file = join(process.cwd(), ".github/workflows/ci.yml");
  return parse(readFileSync(file, "utf8")) as Workflow;
}

describe("repository CI workflow", () => {
  it("pins every action to a commit SHA", () => {
    const actionSteps = Object.values(workflow().jobs).flatMap((job) => job.steps)
      .filter((step) => step.uses !== undefined);

    expect(actionSteps).not.toHaveLength(0);
    for (const step of actionSteps) expect(step.uses).toMatch(/@[0-9a-f]{40}$/u);
  });

  it("defines unit, actionlint, and image jobs", () => {
    expect(Object.keys(workflow().jobs)).toEqual(["unit", "actionlint", "image"]);
  });

  it("runs all unit commands and actionlint in Docker", () => {
    const jobs = workflow().jobs;
    const unitRuns = jobs.unit.steps.map((step) => step.run ?? "");

    expect(unitRuns).toEqual([
      "",
      "",
      "",
      "pnpm install --frozen-lockfile",
      "pnpm typecheck",
      "pnpm lint",
      "pnpm test",
      "pnpm build",
      "npm pack --dry-run",
    ]);
    expect(jobs.unit.steps.find((step) => step.run === "npm pack --dry-run")?.["working-directory"])
      .toBe("launcher");
    expect(jobs.actionlint.steps[1]?.run).toBe(
      'docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -color',
    );
  });
});

describe("repository CI image job", () => {
  it("makes the image job depend on unit and actionlint", () => {
    expect(workflow().jobs.image.needs).toEqual(["unit", "actionlint"]);
    const imageSteps = workflow().jobs.image.steps;
    expect(imageSteps[1]?.uses).toBe(workflow().jobs.unit.steps[1]?.uses);
    expect(imageSteps[1]?.with).toEqual({ version: "10.17.1" });
    expect(imageSteps[2]?.uses).toBe(workflow().jobs.unit.steps[2]?.uses);
    expect(imageSteps[2]?.with).toEqual({ "node-version-file": ".nvmrc", cache: "pnpm" });
    expect(imageSteps[3]?.run).toBe("pnpm install --frozen-lockfile");
    expect(imageSteps[4]?.uses).toMatch(
      /^docker\/setup-buildx-action@[0-9a-f]{40}$/u,
    );
    expect(imageSteps[5]?.with).toMatchObject({ load: true, tags: "code-quality:ci" });
  });

  it("runs versions, doctor, integration, and dogfood against the loaded image", () => {
    const steps = workflow().jobs.image.steps;
    const runs = steps.map((step) => step.run ?? "").join("\n");

    expect(steps.map((step) => step.name ?? step.uses)).toEqual([
      expect.stringMatching(/^actions\/checkout@[0-9a-f]{40}$/u),
      expect.stringMatching(/^pnpm\/action-setup@[0-9a-f]{40}$/u),
      expect.stringMatching(/^actions\/setup-node@[0-9a-f]{40}$/u),
      undefined,
      expect.stringMatching(/^docker\/setup-buildx-action@[0-9a-f]{40}$/u),
      expect.stringMatching(/^docker\/build-push-action@[0-9a-f]{40}$/u),
      undefined,
      undefined,
      "Fixture integration",
      "Dogfood",
      "Publish dogfood summary",
    ]);
    expect(runs).toContain("docker run --rm code-quality:ci versions");
    expect(runs).toContain("docker run --rm code-quality:ci doctor");
    expect(runs).toContain("CODE_QUALITY_IMAGE=code-quality:ci node scripts/integration.ts");
    expect(steps.find((step) => step.name === "Install PHP fixture dependencies")).toBeUndefined();
    expect(runs).not.toContain("--entrypoint composer code-quality:ci install --no-interaction");
    expect(runs).toContain('--user "$(id -u):$(id -g)"');
    expect(runs).toContain("-e GITHUB_ACTIONS=true");
    expect(runs).toContain("code-quality:ci check");
    const installIndex = steps.findIndex((step) => step.run === "pnpm install --frozen-lockfile");
    const dogfoodIndex = steps.findIndex((step) => step.name === "Dogfood");
    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(installIndex).toBeLessThan(dogfoodIndex);
    expect(steps[dogfoodIndex]?.run).toBe(
      'docker run --rm -v "$PWD:/work" --user "$(id -u):$(id -g)" -e GITHUB_ACTIONS=true -e GITHUB_STEP_SUMMARY=/work/artifacts/step-summary.md code-quality:ci check',
    );
    const summary = steps.find((step) => step.name === "Publish dogfood summary");
    expect(summary?.if).toBe("always()");
    expect(summary?.run).toBe(
      "[ -f artifacts/step-summary.md ] && cat artifacts/step-summary.md >> \"$GITHUB_STEP_SUMMARY\" || echo 'no dogfood summary'",
    );
  });

});
