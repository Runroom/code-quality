import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

type Step = {
  id?: string;
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
        default?: string | boolean;
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

function steps(): Step[] {
  return workflow().jobs.quality.steps;
}

function workflowStep(index: number): Step {
  return steps()[index]!;
}

describe("reusable quality workflow", () => {
  it("declares workflow_call inputs in order with their defaults", () => {
    const inputs = workflow().on.workflow_call.inputs;

    expect(Object.keys(inputs)).toEqual([
      "image-tag", "checks", "setup", "working-directory", "report", "coverage-artifact",
    ]);
    expect(inputs["image-tag"]).toMatchObject({
      type: "string",
      default: "v1",
    });
    expect(inputs.checks).toMatchObject({ type: "string", default: "" });
    expect(inputs.setup).toMatchObject({ type: "string", default: "" });
    expect(inputs["working-directory"]).toMatchObject({ type: "string", default: "." });
    expect(inputs.report).toMatchObject({
      type: "boolean",
      default: false,
      description: "Run code-quality report after check and upload artifacts/quality",
    });
    expect(inputs["coverage-artifact"]).toMatchObject({
      type: "string",
      default: "",
      description: "Artifact holding coverage/coverage-final.json for the fallow-health report",
    });
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
});

describe("reusable quality workflow steps", () => {
  it("orders validation, check, download, report, and upload", () => {
    const workflowSteps = steps();

    expect(workflowSteps.map((step) => step.name ?? step.uses)).toEqual([
      expect.stringMatching(/^actions\/checkout@[0-9a-f]{40}$/u),
      "Setup",
      "Validate checks",
      "Validate coverage artifact",
      "Check",
      "Download coverage",
      "Report",
      "Upload quality reports",
    ]);
    expect(workflowSteps.some((step) => step.uses?.startsWith("actions/upload-artifact@"))).toBe(true);
  });

  it("configures setup and input validation before the check", () => {
    expect(workflowStep(0).with).toMatchObject({ "fetch-depth": 0 });
    expect(workflowStep(1)).toMatchObject({
      if: "inputs.setup != ''",
      env: { CODE_QUALITY_SETUP: "${{ inputs.setup }}" },
      run: 'bash -e -c "$CODE_QUALITY_SETUP"',
    });
    expect(workflowStep(2).env).toEqual({ CODE_QUALITY_CHECKS: "${{ inputs.checks }}" });
    expect(workflowStep(2).run).toContain("grep -Eq '^[a-z ]*$'");
    expect(workflowStep(3)).toMatchObject({
      id: "validate-coverage",
      if: "${{ inputs.report && inputs.coverage-artifact != '' }}",
    });
    expect(workflowStep(3).env).toEqual({
      CODE_QUALITY_COVERAGE_ARTIFACT: "${{ inputs.coverage-artifact }}",
    });
    expect(workflowStep(3).run).toContain("grep -Eq '^[A-Za-z0-9._-]+$'");
    expect(workflowStep(4).env).toEqual({ CODE_QUALITY_CHECKS: "${{ inputs.checks }}" });
    expect(workflowStep(4).id).toBe("check");
    expect(workflowStep(4).run).toContain('read -ra CHECKS <<< "$CODE_QUALITY_CHECKS"');
    expect(workflowStep(4).run).toContain('code-quality check "${CHECKS[@]}"');
  });
});

describe("reusable quality workflow reporting", () => {
  it("uses pinned coverage download and report upload actions", () => {
    const workflowSteps = steps();
    expect(workflowSteps[5]).toMatchObject({
      id: "download-coverage",
      if: "${{ inputs.report && inputs.coverage-artifact != '' && !cancelled() && "
        + "steps.validate-coverage.outcome == 'success' }}",
      uses: "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
      with: {
        name: "${{ inputs.coverage-artifact }}",
        path: "${{ inputs.working-directory }}/coverage",
      },
    });
    expect(workflowSteps[6]).toMatchObject({
      id: "report",
      if: "${{ inputs.report && !cancelled() && steps.check.outcome != 'skipped' && "
        + "steps.validate-coverage.outcome != 'failure' && (inputs.coverage-artifact == '' || "
        + "steps.download-coverage.outcome == 'success') }}",
      env: { CODE_QUALITY_COVERAGE_ARTIFACT: "${{ inputs.coverage-artifact }}" },
    });
    expect(workflowSteps[6]?.run).toContain("code-quality report --coverage coverage/coverage-final.json");
    expect(workflowSteps[6]?.run).toContain("code-quality report");
    expect(workflowSteps[7]).toMatchObject({
      if: "${{ inputs.report && !cancelled() && steps.report.outcome != 'skipped' }}",
      uses: "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
      with: {
        name: "quality-reports",
        path: "${{ inputs.working-directory }}/artifacts/quality",
        "if-no-files-found": "warn",
        "retention-days": 14,
      },
    });
  });

  it("never updates or initializes baselines in a workflow step", () => {
    const runs = workflow().jobs.quality.steps
      .map((step) => step.run ?? "")
      .join("\n");

    expect(runs).not.toMatch(/--update|--initialize/u);
  });

});
