import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inspectCodexCompatibility } from "./compatibility";
import { parseCodexModels } from "./codex-model-discovery";
import { buildCodexLaunchPlan, CODEX_HOOK_TRUST_BYPASS_ARG } from "./launch";
import { inspectCodexProject, MINIMUM_CODEX_VERSION } from "./preflight";
import { createCodexRunnerAdapter } from "./runner-adapter";
import { CODEX_0162_FIXTURE } from "./__fixtures__/codex/release-0.162.1";

/**
 * Compatibility audit for Codex 0.162.1 (cross-runner-session-core task 0.10, design section 11).
 * Fixtures are captured from the installed CLI (`--version`, `--help`, `exec --help`, `resume --help`,
 * `features list`, `debug models --bundled`); no model call and no network is involved.
 */
const F = CODEX_0162_FIXTURE;
const dirs: string[] = [];
const originalPath = process.env.PATH;
const originalCodexHome = process.env.CODEX_HOME;
afterEach(() => {
  process.env.PATH = originalPath;
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = originalCodexHome;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("Codex 0.162.1 captured fixtures", () => {
  test("fixture identifies the release and the new vendor layout", () => {
    expect(F.versionOutput).toBe("codex-cli 0.162.1");
    expect(F.vendorBinaryRelativePath).toBe("vendor/aarch64-apple-darwin/bin/codex");
  });

  test("preflight accepts the version and detects launch/feature evidence from real help text", async () => {
    const result = await inspectCodexProject("/p", {
      probe: async () => ({ found: true, version: "0.162.1", help: F.help, execHelp: F.execHelp, resumeHelp: F.resumeHelp }),
    });
    expect(MINIMUM_CODEX_VERSION <= "0.162.1").toBe(true);
    expect(result.state).toBe("ready");
    expect(result.evidence).toMatchObject({ interactive: true, exec: true, resume: true, resumeLatest: true, hookTrustBypass: true });
  });

  test("compatibility inspection reports hooks, multi-agent and launch modes for the release", () => {
    const report = inspectCodexCompatibility({
      version: "0.162.1", capturedFrom: F.capturedFrom, help: F.help, execHelp: F.execHelp, resumeHelp: F.resumeHelp,
      features: F.features, config: F.config,
    });
    expect(report.launch).toEqual({ interactive: true, exec: true, resumeById: true, resumeLatest: true });
    expect(report.multiAgent).toBe(true);
    expect(report.trustedBridge.releasedCandidate).toBe("hooks");
  });

  test("launch plan passes --dangerously-bypass-hook-trust when the release advertises it", () => {
    const plan = buildCodexLaunchPlan(
      { projectRoot: "/p", mode: "interactive", teamId: "developer-team" } as never,
      { interactive: true, exec: true, resumeById: true, resumeLatest: true, hookTrustBypass: /--dangerously-bypass-hook-trust/.test(F.help) },
    );
    expect(plan.status).toBe("ready");
    if (plan.status === "ready") expect(plan.plan.args).toContain(CODEX_HOOK_TRUST_BYPASS_ARG);
  });

  test("model discovery parses the bundled 0.162.1 catalog", () => {
    const parsed = parseCodexModels(F.bundledModelsJson);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const ids = Object.values(parsed.inventory.modelsByProvider).flat().map((m) => m.id);
    expect(ids).toContain("openai-codex/gpt-5.6-sol");
    expect(ids).not.toContain("openai-codex/codex-auto-review");
  });
});

describe("Codex 0.162.1 executable detection through the default production probe", () => {
  test("a PATH shim answering with the captured outputs yields a ready, version-parsed inspection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck-codex-shim-"));
    dirs.push(dir);
    const shim = join(dir, "codex");
    const answers: Record<string, string> = {
      "--version": F.versionOutput, "--help": F.help, "exec --help": F.execHelp, "resume --help": F.resumeHelp,
    };
    const script = ["#!/bin/sh", 'case "$*" in',
      ...Object.entries(answers).map(([k, v]) => `  '${k}') cat <<'DECK_EOF'\n${v}\nDECK_EOF\n  ;;`),
      "  *) exit 2 ;;", "esac", ""].join("\n");
    writeFileSync(shim, script);
    chmodSync(shim, 0o755);
    process.env.PATH = `${dir}:${originalPath}`;
    process.env.CODEX_HOME = join(dir, "codex-home"); // keep the default snapshot reader away from the real ~/.codex
    const adapter = createCodexRunnerAdapter({});
    const inspection = await adapter.inspectProject!(dir);
    expect(inspection.evidence).toMatchObject({ binary: true, version: "0.162.1", hookTrustBypass: true, exec: true });
  });
});
