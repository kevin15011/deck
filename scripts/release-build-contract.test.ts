/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildBinary,
  codeSign,
  getBuildTarget,
  parseBuildArgs,
  ROOT,
} from "./build-binaries";

function spawnResult(success: boolean, stderr = "") {
  return {
    success,
    stdout: Buffer.from(""),
    stderr: Buffer.from(stderr),
    exitCode: success ? 0 : 1,
  } as never;
}

describe("release binary build contract", () => {
  test("selects one explicit supported target and rejects ambiguous arguments", () => {
    expect(parseBuildArgs(["bun", "build-binaries.ts", "--target", "darwin-arm64"]).target)
      .toBe("darwin-arm64");
    expect(getBuildTarget("darwin-arm64")).toEqual(["darwin", "arm64", "bun-darwin-arm64"]);
    expect(() => parseBuildArgs(["bun", "build-binaries.ts", "--target", "windows-x64"]))
      .toThrow("Unsupported build target");
    expect(() => parseBuildArgs(["bun", "build-binaries.ts", "--dry-run", "--target", "darwin-arm64"]))
      .toThrow("cannot be combined");
  });

  test("ad-hoc signs and verifies Darwin binaries before returning", () => {
    const commands: string[][] = [];
    const spawnSync = ((options: { cmd: string[] }) => {
      commands.push(options.cmd);
      return spawnResult(true);
    }) as typeof Bun.spawnSync;

    codeSign("/tmp/deck", { platform: "darwin", spawnSync });

    expect(commands).toEqual([
      ["codesign", "--remove-signature", "/tmp/deck"],
      ["codesign", "--force", "--sign", "-", "/tmp/deck"],
      ["codesign", "--verify", "--deep", "--strict", "--verbose=2", "/tmp/deck"],
    ]);
  });

  test("fails closed when signing or signature verification fails", () => {
    expect(() => codeSign("/tmp/deck", {
      platform: "darwin",
      spawnSync: (() => spawnResult(false, "sign failed")) as typeof Bun.spawnSync,
    })).toThrow("signature removal failed");

    let signCalls = 0;
    expect(() => codeSign("/tmp/deck", {
      platform: "darwin",
      spawnSync: (() => {
        signCalls += 1;
        return signCalls === 1 ? spawnResult(true) : spawnResult(false, "sign failed");
      }) as typeof Bun.spawnSync,
    })).toThrow("codesign failed");

    let calls = 0;
    expect(() => codeSign("/tmp/deck", {
      platform: "darwin",
      spawnSync: (() => {
        calls += 1;
        return calls < 3 ? spawnResult(true) : spawnResult(false, "invalid signature");
      }) as typeof Bun.spawnSync,
    })).toThrow("verification failed");
  });

  test("embeds explicit canary build metadata without rewriting generated source", async () => {
    let command: string[] = [];
    let environment: Record<string, string | undefined> = {};
    const spawnSync = ((options: { cmd: string[]; env?: Record<string, string | undefined> }) => {
      command = options.cmd;
      environment = options.env ?? {};
      return spawnResult(true);
    }) as typeof Bun.spawnSync;

    await buildBinary("darwin", "arm64", "bun-darwin-arm64", "0.4.0", {
      outputDir: "/tmp",
      spawnSync,
      buildInfo: {
        version: "0.4.0",
        commit: "abc1234",
        date: "2026-09-21",
        target: "darwin-arm64",
        channel: "dev",
      },
    });

    expect(command).toContain("--env=DECK_COMPILED_BUILD_*");
    expect(environment.DECK_COMPILED_BUILD_VERSION).toBe("0.4.0");
    expect(environment.DECK_COMPILED_BUILD_CHANNEL).toBe("dev");
  });

  test("release workflow consumes the canonical target build outputs", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf-8");
    const buildJob = workflow.slice(workflow.indexOf("  build:"), workflow.indexOf("  # Create GitHub Release"));

    expect(buildJob).toContain('bun run scripts/build-binaries.ts --target "$TARGET"');
    expect(buildJob).not.toContain("bun build --compile");
    expect(buildJob).toContain("codesign --verify --deep --strict");
    expect(buildJob).toContain("dist/cli/deck_v");
    expect(workflow).toContain("does not match package.json version");
  });

  test("pins one Bun version for local development and every release job", () => {
    const expected = "1.3.12";
    const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as { packageManager?: string };
    const localVersion = readFileSync(join(ROOT, ".bun-version"), "utf-8").trim();
    const workflow = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf-8");
    const workflowVersions = [...workflow.matchAll(/\bbun-version\s*:\s*["']?([^"'\s#]+)/g)].map((match) => match[1]);

    expect(localVersion).toBe(expected);
    expect(packageJson.packageManager).toBe(`bun@${expected}`);
    expect(new Set(workflowVersions)).toEqual(new Set([expected]));

    for (const generator of ["generate-build-info.ts", "generate-skill-bundle.ts", "generate-runner-execution-assets.ts"]) {
      const source = readFileSync(join(ROOT, "scripts", generator), "utf-8");
      expect(source, generator).toContain("assertCanonicalBunRuntime");
    }
  });
});
