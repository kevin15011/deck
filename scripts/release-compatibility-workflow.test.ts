import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const workflow = () => parse(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"));
test("Darwin candidates are re-signed and verified before archive/checksum/upload, never in the verifier", () => {
  const w = workflow(), steps = w.jobs.build.steps;
  const index = steps.findIndex((s: any) => s.name === "Sign Darwin candidate");
  expect(index).toBeGreaterThan(steps.findIndex((s: any) => s.name === "Build binary"));
  expect(index).toBeLessThan(steps.findIndex((s: any) => s.name === "Create archive"));
  const sign = steps[index];
  expect(sign.if).toBe("startsWith(matrix.target, 'darwin-')");
  expect(sign.run.trim().split("\n")).toEqual([
    "/usr/bin/codesign --remove-signature ./dist-cli/deck",
    "/usr/bin/codesign --force --sign - ./dist-cli/deck",
    "/usr/bin/codesign --verify --strict ./dist-cli/deck",
  ]);
  expect(w.jobs.compatibility.steps.some((s: any) => s.run?.includes("codesign"))).toBe(false);
});
test("PR/manual verification is read-only and neither publishing job can run outside push", () => {
  const w = workflow();
  expect(Object.keys(w.on)).toEqual(expect.arrayContaining(["pull_request", "workflow_dispatch", "push"]));
  expect(w.permissions).toEqual({ contents: "read" });
  for (const name of ["release", "artifacts"]) {
    const job = w.jobs[name];
    expect(job.needs).toEqual(expect.arrayContaining(["metadata", "build", "compatibility"]));
    expect(job.if).toContain("github.event_name == 'push'");
    expect(job.permissions).toEqual({ contents: "write" });
    expect(job.if).toContain(name === "release" ? "startsWith(github.ref, 'refs/tags/v')" : "github.ref == 'refs/heads/main'");
  }
  for (const [name, job] of Object.entries(w.jobs) as [string, any][]) if (!["release", "artifacts"].includes(name)) expect(job.permissions?.contents).not.toBe("write");
});
test("all eight compatibility cells run natively and consume the exact archives", () => {
  const w = workflow(), job = w.jobs.compatibility;
  expect(job.needs).toEqual(["metadata", "build"]);
  expect(job.strategy.matrix.node).toEqual([20, 24]);
  expect(job.strategy.matrix.platform).toEqual([
    { target: "linux-x64", runner: "ubuntu-22.04", arch: "x64" },
    { target: "linux-arm64", runner: "ubuntu-24.04-arm", arch: "arm64" },
    { target: "darwin-x64", runner: "macos-15-intel", arch: "x64" },
    { target: "darwin-arm64", runner: "macos-14", arch: "arm64" },
  ]);
  expect(job['runs-on']).toBe("${{ matrix.platform.runner }}");
  const node = job.steps.find((step: any) => step.uses === "actions/setup-node@v4");
  expect(node.with).toEqual({ "node-version": "${{ matrix.node }}", architecture: "${{ matrix.platform.arch }}" });
  const download = job.steps.find((step: any) => step.uses === "actions/download-artifact@v4");
  expect(download.with.name).toBe("deck-${{ matrix.platform.target }}");
  const smoke = job.steps.find((step: any) => step.name === "Verify exact candidate");
  for (const flag of ["--archive", "--checksums", "--node", "--major", "--target", "--version", "--commit", "--channel", "--hook", "--report"]) expect(smoke.run).toContain(flag);
  expect(smoke.run).toContain('$(command -v node)');
  expect(smoke.env.TARGET).toBe("${{ matrix.platform.target }}");
  const report = job.steps.find((step: any) => step.uses === "actions/upload-artifact@v4");
  expect(report.if).toBe("always()");
  expect(report.with.name).toStartWith("compatibility-");
});
test("canonical generation precedes compile with frozen deps; provider gates remain; publication never rebuilds", () => {
  const w = workflow(), steps = w.jobs.build.steps;
  expect(steps.find((s: any) => s.name === "Install dependencies").run).toBe("bun install --frozen-lockfile");
  const generation = steps.findIndex((s: any) => s.run?.includes("generate-runner-execution-assets.ts"));
  expect(generation).toBeGreaterThan(-1);
  expect(generation).toBeLessThan(steps.findIndex((s: any) => s.name === "Build binary"));
  expect(steps.find((s: any) => s.name === "Generate build info").run).toContain('--commit "$GITHUB_SHA"');
  expect(steps.find((s: any) => s.name === "Generate build info").run).toContain('--channel "$CHANNEL"');
  expect(w.jobs.build.needs).toContain("release-verification");
  const gates = w.jobs['release-verification'].steps.map((s: any) => s.run).join("\n");
  expect(gates).toContain("bench:memory");
  expect(gates).toContain("verify:supermemory-compiled");
  for (const name of ["release", "artifacts"]) {
    const job = w.jobs[name];
    expect(job.steps.find((s: any) => s.uses === "actions/download-artifact@v4").with.pattern).toBe("deck-*");
    expect(job.steps.some((s: any) => /bun build|build-binaries/.test(s.run ?? ""))).toBe(false);
  }
});
