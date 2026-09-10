import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
};

type Workflow = {
  on: {
    workflow_call: {
      inputs: Record<string, {
        default?: string;
        description?: string;
        type?: string;
      }>;
    };
  };
  jobs: {
    quality: {
      container: {
        credentials: Record<string, string>;
        image: string;
        options: string;
      };
      steps: Step[];
    };
  };
};

function workflow(): Workflow {
  const file = join(process.cwd(), ".github/workflows/quality.yml");
  return parse(readFileSync(file, "utf8")) as Workflow;
}

describe("reusable quality workflow", () => {
  it("declares the four workflow_call inputs and their defaults", () => {
    const inputs = workflow().on.workflow_call.inputs;

    expect(Object.keys(inputs)).toEqual(["image-tag", "checks", "setup", "working-directory"]);
    expect(inputs["image-tag"]).toMatchObject({
      type: "string",
      default: "v1",
    });
    expect(inputs.checks).toMatchObject({ type: "string", default: "" });
    expect(inputs.setup).toMatchObject({ type: "string", default: "" });
    expect(inputs["working-directory"]).toMatchObject({ type: "string", default: "." });
  });

  it("uses the requested container credentials and root options", () => {
    const container = workflow().jobs.quality.container;

    expect(container.image).toBe("ghcr.io/runroom/code-quality:${{ inputs.image-tag }}");
    expect(container.credentials).toEqual({
      username: "${{ github.actor }}",
      password: "${{ github.token }}",
    });
    expect(container.options).toBe("--user root");
  });

  it("orders checkout, setup, validation, and check", () => {
    const steps = workflow().jobs.quality.steps;

    expect(steps.map((step) => step.name ?? step.uses)).toEqual([
      expect.stringMatching(/^actions\/checkout@[0-9a-f]{40}$/u),
      "Setup",
      "Validate checks",
      "Check",
    ]);
    expect(steps.some((step) => step.uses?.startsWith("actions/upload-artifact@"))).toBe(false);
    expect(steps[0]?.with).toMatchObject({ "fetch-depth": 0 });
    expect(steps[1]?.if).toBe("inputs.setup != ''");
    expect(steps[1]?.env).toEqual({ CODE_QUALITY_SETUP: "${{ inputs.setup }}" });
    expect(steps[1]?.run).toBe('bash -e -c "$CODE_QUALITY_SETUP"');
    expect(steps[2]?.env).toEqual({ CODE_QUALITY_CHECKS: "${{ inputs.checks }}" });
    expect(steps[2]?.run).toContain("grep -Eq '^[a-z ]*$'");
    expect(steps[3]?.env).toEqual({ CODE_QUALITY_CHECKS: "${{ inputs.checks }}" });
    expect(steps[3]?.run).toContain('read -ra CHECKS <<< "$CODE_QUALITY_CHECKS"');
    expect(steps[3]?.run).toContain('code-quality check "${CHECKS[@]}"');
  });

  it("never updates or initializes baselines in a workflow step", () => {
    const runs = workflow().jobs.quality.steps
      .map((step) => step.run ?? "")
      .join("\n");

    expect(runs).not.toMatch(/--update|--initialize/u);
  });

});
