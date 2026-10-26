import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";
import { parse } from "yaml";

const root = resolve(import.meta.dir, "..");
const workflow = parse(
  readFileSync(resolve(root, ".github/workflows/release.yml"), "utf8"),
) as {
  on: Record<string, unknown>;
  jobs: Record<
    string,
    {
      "runs-on"?: string;
      if?: string;
      strategy?: { matrix?: { include?: Array<{ target: string; runner: string }> } };
      needs?: string | string[];
      steps?: Array<{ name?: string; run?: string; with?: { files?: string } }>;
    }
  >;
};

const expectedTargets = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"];

function publishedArchives(jobName: "release" | "artifacts", stepName: string): string[] {
  const step = workflow.jobs[jobName]?.steps?.find((candidate) => candidate.name === stepName);
  return (step?.with?.files ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".tar.gz"));
}

describe("release workflow platform contract", () => {
  test("builds every supported binary target", () => {
    expect(workflow.jobs.build?.strategy?.matrix?.include?.map(entry => entry.target)).toEqual(expectedTargets);
  });

  test("requires matching native hosts and qualifies the extracted artifact before upload", () => {
    expect(workflow.jobs.build?.["runs-on"]).toBe("${{ matrix.runner }}");
    expect(workflow.jobs.build?.strategy?.matrix?.include).toEqual([
      {target: "linux-x64", runner: "ubuntu-24.04"},
      {target: "linux-arm64", runner: "ubuntu-24.04-arm"},
      {target: "darwin-x64", runner: "macos-15-intel"},
      {target: "darwin-arm64", runner: "macos-15"},
    ]);
    const steps=workflow.jobs.build?.steps ?? [];
    const qualify=steps.findIndex(step=>step.name === "Verify extracted release artifact");
    expect(steps[qualify]?.run).toContain('tar -xzf');
    expect(steps[qualify]?.run).toContain('set -o pipefail');
    expect(steps[qualify]?.run).toContain('verify-git-diff-runtime.ts --target "$TARGET" --artifact "$VERIFY_DIR/deck"');
    expect(qualify).toBeLessThan(steps.findIndex(step=>step.name === "Upload artifact"));
    for(const job of ['release','artifacts'])expect(workflow.jobs[job]?.needs).toContain('build');
  });

  test("manual qualification never publishes", () => {
    expect(workflow.on).toHaveProperty('workflow_dispatch');
    for(const job of ['release','artifacts'])expect(workflow.jobs[job]?.if).toContain("github.event_name == 'push'");
  });

  test("SSH candidate pushes trigger qualification without either publishing job", () => {
    const push=workflow.on.push as {branches:string[]};
    expect(push.branches).toContain('fix/session-pending-issues');
    expect(workflow.jobs.artifacts?.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.metadata.outputs.is_release == 'false'");
    expect(workflow.jobs.release?.if).toBe("github.event_name == 'push' && needs.metadata.outputs.is_release == 'true'");
    const metadata=workflow.jobs.metadata?.steps?.find(step=>step.name==='Extract version from tag')?.run;
    expect(metadata).toContain('if [[ "$GITHUB_REF" == refs/tags/v* ]]');
    expect(metadata).toContain('echo "is_release=false" >> $GITHUB_OUTPUT');
  });

  test("publishes every supported archive for stable and main builds", () => {
    const expectedArchives = expectedTargets.map(
      (target) => `release-assets/deck_v*_${target}.tar.gz`,
    );
    expect(publishedArchives("release", "Create Release")).toEqual(expectedArchives);
    expect(publishedArchives("artifacts", "Upload to GitHub Release")).toEqual(expectedArchives);
  });

  test("runs release hard gates before archive build", () => {
    expect(workflow.jobs.build?.needs).toEqual(["metadata", "release-verification"]);
    const steps = workflow.jobs["release-verification"]?.steps ?? [];
    const freshness=steps.findIndex(step=>step.name==='Generated asset freshness');
    expect(freshness).toBeGreaterThanOrEqual(0);
    expect(freshness).toBeLessThan(steps.findIndex(step=>step.name==='Full test suite'));
    expect(steps[freshness]?.run).toContain('scripts/generate-pi-extension-assets.test.ts');
    const stepRuns = steps.map((step) => step.run).filter(Boolean);
    expect(stepRuns).toContain("bun test --timeout 30000");
    expect(stepRuns).toContain("bunx tsc --noEmit");
    expect(stepRuns).toContain("bun run apps/cli/src/main.tsx openspec validate --json --root . --change canonical-supermemory-conversation-memory");
    expect(stepRuns).toContain("bun run bench:memory");
    expect(stepRuns).toContain("bun run verify:supermemory-compiled");
    const order = [
      "bun test --timeout 30000",
      "bunx tsc --noEmit",
      "bun run apps/cli/src/main.tsx openspec validate --json --root . --change canonical-supermemory-conversation-memory",
      "bun run bench:memory",
      "bun run verify:supermemory-compiled",
    ].map((run) => stepRuns.indexOf(run));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
