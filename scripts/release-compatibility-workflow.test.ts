import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const workflow = () => parse(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"));
test("canonical build owns Darwin signing before archive/checksum/upload, never the verifier", () => {
  const w = workflow(), steps = w.jobs.build.steps;
  const build = steps.find((s: any) => s.name === "Build canonical release artifact");
  expect(build.run).toContain('bun run scripts/build-binaries.ts --target "$TARGET"');
  expect(build.env).toEqual({ TARGET: "${{ matrix.target }}", DECK_RELEASE_COMMIT: "${{ github.sha }}", DECK_RELEASE_CHANNEL: "${{ needs.metadata.outputs.channel }}" });
  const verify = steps.find((s: any) => s.name === "Verify extracted release artifact");
  expect(verify.run).toContain("codesign --verify --deep --strict --verbose=2");
  expect(steps.some((s: any) => s.name === "Sign Darwin candidate")).toBe(false);
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
  const hook = job.steps.find((step: any) => step.name === "Download generated hook sidecar");
  expect(hook.with.name).toBe("runner-hook-${{ matrix.platform.target }}");
  const smoke = job.steps.find((step: any) => step.name === "Verify exact candidate");
  for (const flag of ["--archive", "--checksums", "--node", "--major", "--target", "--version", "--commit", "--channel", "--hook", "--report"]) expect(smoke.run).toContain(flag);
  expect(smoke.run).toContain('$(command -v node)');
  expect(smoke.env.TARGET).toBe("${{ matrix.platform.target }}");
  const report = job.steps.find((step: any) => step.uses === "actions/upload-artifact@v4");
  expect(report.if).toBe("always()");
  expect(report.with.name).toStartWith("compatibility-");
});
test("canonical build uses frozen deps and verifier identity; provider gates remain; publication never rebuilds", () => {
  const w = workflow(), steps = w.jobs.build.steps;
  expect(steps.find((s: any) => s.name === "Install dependencies").run).toBe("bun install --frozen-lockfile");
  const build = steps.find((s: any) => s.name === "Build canonical release artifact");
  expect(build.run).toContain('bun run scripts/build-binaries.ts --target "$TARGET"');
  expect(build.run).not.toContain("bun build --compile");
  expect(build.env.DECK_RELEASE_COMMIT).toBe("${{ github.sha }}");
  expect(build.env.DECK_RELEASE_CHANNEL).toBe("${{ needs.metadata.outputs.channel }}");
  expect(w.jobs.build.needs).toContain("release-verification");
  const gates = w.jobs['release-verification'].steps.map((s: any) => s.run).join("\n");
  expect(gates).toContain("bench:memory");
  expect(gates).toContain("verify:supermemory-compiled");
  for (const name of ["release", "artifacts"]) {
    const job = w.jobs[name];
    expect(job.steps.find((s: any) => s.uses === "actions/download-artifact@v4").with.pattern).toBe("deck-*");
    expect(job.steps.find((s: any) => s.uses === "actions/download-artifact@v4").with.pattern).not.toContain("runner-hook");
    expect(job.steps.some((s: any) => /bun build|build-binaries/.test(s.run ?? ""))).toBe(false);
  }
});
