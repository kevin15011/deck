import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";
import { parse } from "yaml";

const root = resolve(import.meta.dir, "..");
const workflow = parse(
  readFileSync(resolve(root, ".github/workflows/release.yml"), "utf8"),
) as {
  jobs: Record<
    string,
    {
      "runs-on"?: string;
      strategy?: { matrix?: { target?: string[] } };
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
    expect(workflow.jobs.build?.strategy?.matrix?.target).toEqual(expectedTargets);
  });

  test("uses macOS runners for both Darwin targets", () => {
    expect(workflow.jobs.build?.["runs-on"]).toBe(
      "${{ startsWith(matrix.target, 'darwin-') && 'macos-latest' || 'ubuntu-latest' }}",
    );
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
