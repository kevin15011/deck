/**
 * Pi role model/thinking assignments live only in the installed package agents' frontmatter. A reinstall (template
 * or content change) must carry them over; manual edits of those lines are user-owned (never drift or conflict).
 * Hermetic: temp HOME + PI_CODING_AGENT_DIR, injected `pi --version`, no network.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCapabilityInstructionBundle, validateDeckConfig } from "@deck/core";
import { createPiRunnerAdapter } from "./runner-adapter";
import { inspectPiDeckInstall } from "./pi-doctor";
import { createNodePiFileIO } from "./pi-global-install";

let root: string; let home: string; let agentDir: string; let projectRoot: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "deck-pi-model-keep-"));
  home = join(root, "home"); agentDir = join(root, "pi-agent"); projectRoot = join(root, "project");
  mkdirSync(home, { recursive: true }); mkdirSync(projectRoot, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const adapter = () => createPiRunnerAdapter({ homeDirectory: home, env: { PI_CODING_AGENT_DIR: agentDir }, piVersionProbe: () => ({ exitCode: 0, stdout: "1.0.0\n", stderr: "" }) } as never);
const input = (extra: Record<string, unknown> = {}) => ({ projectRoot, environmentId: "pi-development" as const, deckConfig: validateDeckConfig({}), ...extra });
const agentFile = (id: string) => join(agentDir, "deck/package/agents", `${id}.md`);
const install = async (extra: Record<string, unknown> = {}) => {
  const pi = adapter();
  const plan = pi.buildDeveloperTeamInstallPlan(input(extra));
  expect(plan.blocked).toBeFalsy();
  await pi.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan });
  return pi;
};
const templateChange = () => ({ capabilityInstructions: buildCapabilityInstructionBundle(["rtk"]) });
const ASSIGN = { modelAssignments: { "deck-lead": "openai-codex/gpt-5.5", "deck-apply-deep": "anthropic/claude-sonnet-4-5" }, thinkingAssignments: { "deck-lead": "high", "deck-apply-deep": "medium" } };

describe("Pi model/thinking assignments survive reinstalls", () => {
  test("a reinstall after a template change keeps the installed assignments", async () => {
    await install(ASSIGN);
    await install(templateChange());
    const pi = adapter();
    expect(pi.readModelAssignments(projectRoot)).toEqual(ASSIGN.modelAssignments);
    expect(pi.readThinkingAssignments(projectRoot)["deck-lead"]).toBe("high");
    expect(pi.readThinkingAssignments(projectRoot)["deck-apply-deep"]).toBe("medium");
    expect(readFileSync(agentFile("deck-lead"), "utf-8")).toContain("model: openai-codex/gpt-5.5");
  });

  test("an explicit new assignment wins; others are preserved", async () => {
    await install(ASSIGN);
    await install({ ...templateChange(), modelAssignments: { "deck-lead": "openai-codex/gpt-5.4" } });
    const models = adapter().readModelAssignments(projectRoot);
    expect(models["deck-lead"]).toBe("openai-codex/gpt-5.4");
    expect(models["deck-apply-deep"]).toBe("anthropic/claude-sonnet-4-5");
  });

  test("a manual edit of model/thinking lines is user-owned: no conflict on reinstall, no doctor drift", async () => {
    await install(ASSIGN);
    writeFileSync(agentFile("deck-lead"), readFileSync(agentFile("deck-lead"), "utf-8").replace(/^model: .*$/m, "model: openai-codex/gpt-5.9").replace(/^thinking: .*$/m, "thinking: low"));
    const plan = adapter().buildDeveloperTeamInstallPlan(input(templateChange()));
    expect(plan.blocked).toBeFalsy();
    const unchanged = adapter().buildDeveloperTeamInstallPlan(input());
    expect(unchanged.blocked).toBeFalsy();
    const pi = await install(templateChange());
    expect(pi.readModelAssignments(projectRoot)["deck-lead"]).toBe("openai-codex/gpt-5.9");
    expect(pi.verifyDeveloperTeamInstall(pi.buildDeveloperTeamInstallPlan(input(templateChange())))).toEqual({ valid: true, diagnostics: [] });
  });

  test("a manual model edit alone does not make the doctor report drift", async () => {
    await install(ASSIGN);
    writeFileSync(agentFile("deck-lead"), readFileSync(agentFile("deck-lead"), "utf-8").replace(/^model: .*$/m, "model: openai-codex/gpt-5.9"));
    const report = inspectPiDeckInstall({ io: createNodePiFileIO(), agentDir: { ok: true, dir: agentDir, source: "env" }, piVersionOutput: "1.0.0\n", isExecutable: () => true } as never);
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/modified after install/);
    expect(text).toContain("no drift");
  });

  test("assignments in the legacy pre-package locations are migrated once, package values win", async () => {
    const legacyAgent = (dir: string, id: string, model: string) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `${id}.md`), `---\nname: ${id}\nmodel: ${model}\nthinking: medium\n---\nbody\n`); };
    legacyAgent(join(agentDir, "agents"), "deck-lead", "openai-codex/gpt-5.4");
    legacyAgent(join(projectRoot, ".pi", "agents"), "deck-quality", "anthropic/claude-sonnet-4-5");
    legacyAgent(join(projectRoot, ".pi", "agents"), "deck-lead", "ignored/lower-precedence");
    await install();
    const models = adapter().readModelAssignments(projectRoot);
    expect(models["deck-lead"]).toBe("openai-codex/gpt-5.4");
    expect(models["deck-quality"]).toBe("anthropic/claude-sonnet-4-5");
  });
});
