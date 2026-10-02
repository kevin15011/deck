/**
 * Contract tests for the global Pi install through the production RunnerAdapter composition
 * (createPiRunnerAdapter): plan -> backup -> apply -> verify -> rollback -> launch.
 * Hermetic: temp HOME + temp PI_CODING_AGENT_DIR, injected `pi --version` probe, no network, no real Pi.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateDeckConfig } from "@deck/core";

import { piAgentPaths } from "./agent-dir";
import { createPiRunnerAdapter } from "./runner-adapter";

let root: string;
let home: string;
let agentDir: string;
let projectRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "deck-pi-adapter-global-"));
  home = join(root, "home");
  agentDir = join(root, "pi-agent");
  projectRoot = join(root, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const supportedPi = () => ({ exitCode: 0, stdout: "1.0.0\n", stderr: "" });
const adapter = (overrides: Record<string, unknown> = {}) =>
  createPiRunnerAdapter({ homeDirectory: home, env: { PI_CODING_AGENT_DIR: agentDir }, piVersionProbe: supportedPi, ...overrides } as never);

const launchOf = (pi: ReturnType<typeof adapter>, input: unknown) => pi.buildLaunchPlan!(input as never) as unknown as { status: string; diagnostics: { message: string }[]; plan: { command: string; args: string[]; stdio: string; stdin: string; envOverlay?: Record<string, { value: string }> } };

const planInput = () => ({ projectRoot, environmentId: "pi-development" as const, deckConfig: validateDeckConfig({}) });

function tree(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full.slice(dir.length));
    }
  };
  walk(dir);
  return out.sort();
}

describe("global Pi install through the adapter", () => {
  test("plans only absolute paths under the resolved agent dir and creates nothing while planning", () => {
    const plan = adapter().buildDeveloperTeamInstallPlan(planInput());

    expect(plan.blocked).toBeFalsy();
    expect(plan.files.length).toBeGreaterThan(10);
    expect(plan.files.every((file) => file.path.startsWith(`${agentDir}/`))).toBe(true);
    expect(plan.mutationPreview!.length).toBeGreaterThan(0);
    expect(plan.mutationPreview!.every((mutation) => mutation.path.startsWith(`${agentDir}/`))).toBe(true);
    expect(existsSync(agentDir)).toBe(false);
    expect(tree(projectRoot)).toEqual([]);
    expect(tree(home)).toEqual([]);
  });

  test("apply + verify install the package, register it once, and never write project or home paths", async () => {
    const pi = adapter();
    const plan = pi.buildDeveloperTeamInstallPlan(planInput());
    const result = await pi.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan });

    expect(result.changedCount).toBeGreaterThan(0);
    const verified = pi.verifyDeveloperTeamInstall(plan);
    expect(verified).toEqual({ valid: true, diagnostics: [] });
    expect(JSON.parse(readFileSync(piAgentPaths(agentDir).settings, "utf-8")).packages).toEqual(["deck/package"]);
    expect(existsSync(join(agentDir, "deck/package/package.json"))).toBe(true);
    expect(existsSync(join(agentDir, "deck/profiles/developer-team/system-prompt.md"))).toBe(true);
    expect(existsSync(join(agentDir, "SYSTEM.md"))).toBe(false);
    expect(existsSync(join(agentDir, "APPEND_SYSTEM.md"))).toBe(false);
    expect(tree(projectRoot)).toEqual([]);
    expect(existsSync(join(projectRoot, ".pi"))).toBe(false);
    expect(existsSync(join(projectRoot, ".deck"))).toBe(false);
    expect(tree(home)).toEqual([]);
  });

  test("a second plan for the same selection reports zero changes", async () => {
    const pi = adapter();
    const plan = pi.buildDeveloperTeamInstallPlan(planInput());
    await pi.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan });
    const again = adapter().buildDeveloperTeamInstallPlan(planInput());
    expect(again.mutationPreview).toEqual([]);
  });

  test("a user-modified Deck file surfaces as a blocking conflict", async () => {
    const pi = adapter();
    await pi.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan: pi.buildDeveloperTeamInstallPlan(planInput()) });
    writeFileSync(join(agentDir, "deck/package/agents/deck-lead.md"), "user edit\n");
    const plan = adapter().buildDeveloperTeamInstallPlan({ ...planInput(), modelAssignments: { "deck-lead": "openai-codex/gpt-5.5" } });
    expect(plan.blocked).toBe(true);
    expect(plan.diagnostics?.join(" ")).toContain("deck-lead.md");
    expect(plan.diagnosticEntries?.some((entry) => entry.severity === "error")).toBe(true);
  });

  test("backup then rollback restores the exact previous state", async () => {
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(piAgentPaths(agentDir).settings, `${JSON.stringify({ defaultModel: "keep" })}\n`);
    const before = tree(agentDir);
    const pi = adapter();
    const plan = pi.buildDeveloperTeamInstallPlan(planInput());
    const backup = pi.backupDeveloperTeamFiles(plan);
    await pi.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan });
    expect(tree(agentDir)).not.toEqual(before);

    const rollback = await pi.rollbackDeveloperTeamFiles(backup);
    expect(rollback.status).toBe("rolled-back");
    expect(tree(agentDir)).toEqual(before);
    expect(JSON.parse(readFileSync(piAgentPaths(agentDir).settings, "utf-8"))).toEqual({ defaultModel: "keep" });
  });

  test("an invalid PI_CODING_AGENT_DIR blocks the plan and nothing is written", async () => {
    const pi = adapter({ env: { PI_CODING_AGENT_DIR: "relative/dir" } });
    const plan = pi.buildDeveloperTeamInstallPlan(planInput());
    expect(plan.blocked).toBe(true);
    expect(plan.diagnostics?.join(" ")).toContain("PI_CODING_AGENT_DIR");
    await expect(pi.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan })).rejects.toThrow(/PI_CODING_AGENT_DIR|blocked/i);
    expect(tree(home)).toEqual([]);
    expect(tree(projectRoot)).toEqual([]);
  });

  test("model and thinking assignments persist in the package agents and are read back from there", async () => {
    const pi = adapter();
    const plan = pi.buildDeveloperTeamInstallPlan({ ...planInput(), modelAssignments: { "deck-lead": "openai-codex/gpt-5.5" }, thinkingAssignments: { "deck-lead": "high" } });
    await pi.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan });
    expect(adapter().readModelAssignments(projectRoot)["deck-lead"]).toBe("openai-codex/gpt-5.5");
    expect(adapter().readThinkingAssignments(projectRoot)["deck-lead"]).toBe("high");
  });
});

describe("minimum Pi version gate (>= 1.0.0)", () => {
  const probe = (stdout: string, exitCode = 0) => () => ({ exitCode, stdout, stderr: exitCode === 0 ? "" : "spawn pi ENOENT" });

  test("an old Pi blocks the install plan with an upgrade hint", () => {
    const plan = adapter({ piVersionProbe: probe("0.99.3\n") }).buildDeveloperTeamInstallPlan(planInput());
    expect(plan.blocked).toBe(true);
    expect(plan.diagnostics?.join(" ")).toContain("@earendil-works/pi-coding-agent");
  });

  test("unparseable `pi --version` output blocks the install plan", () => {
    const plan = adapter({ piVersionProbe: probe("banana\n") }).buildDeveloperTeamInstallPlan(planInput());
    expect(plan.blocked).toBe(true);
  });

  test("an old Pi blocks the launch", () => {
    const launch = launchOf(adapter({ piVersionProbe: probe("0.99.3\n") }), { mode: "interactive", teamId: "developer", projectRoot, prompt: [], deckConfig: validateDeckConfig({}) });
    expect(launch.status).toBe("blocked");
    expect(launch.diagnostics.map((d) => d.message).join(" ")).toContain("@earendil-works/pi-coding-agent");
  });

  test("a supported Pi does not block", () => {
    const plan = adapter().buildDeveloperTeamInstallPlan(planInput());
    expect(plan.blocked).toBeFalsy();
  });

  test("a Pi binary that cannot run is reported without blocking the install of Deck files", () => {
    const plan = adapter({ piVersionProbe: probe("", 1) }).buildDeveloperTeamInstallPlan(planInput());
    expect(plan.blocked).toBeFalsy();
    expect(plan.diagnostics?.join(" ")).toMatch(/Pi was not found/);
  });
});

describe("launch plan", () => {
  const launchInput = () => ({ mode: "interactive", teamId: "developer", projectRoot, prompt: [], deckConfig: validateDeckConfig({}) }) as never;

  test("starts Pi's normal interactive TUI with the global lead profile and no per-launch extension flag", () => {
    const launch = launchOf(adapter(), launchInput());
    expect(launch.status).toBe("ready");
    expect(launch.plan.command).toBe("pi");
    expect(launch.plan.stdio).toBe("inherit");
    expect(launch.plan.stdin).toBe("inherit");
    const args = launch.plan.args;
    expect(args[args.indexOf("--system-prompt") + 1]).toBe(join(agentDir, "deck/profiles/developer-team/system-prompt.md"));
    expect(args).not.toContain("--extension");
    expect(args).not.toContain("-p");
    expect(args).not.toContain("--mode");
    expect(args.join(" ")).not.toContain(".deck/pi/profiles");
  });

  test("marks the lead session through the env overlay and uses neither PI_SESSION_DIR nor a project profile", () => {
    const launch = launchOf(adapter(), launchInput());
    const overlay = launch.plan.envOverlay ?? {};
    expect(overlay.DECK_PI_SESSION?.value).toBe("1");
    expect(overlay.DECK_PI_ROLE?.value).toBe("lead");
    expect(overlay).not.toHaveProperty("PI_SESSION_DIR");
    expect(overlay.PI_CODING_AGENT_DIR?.value).toBe(agentDir);
  });

  test("the default location is not forced into the child environment", () => {
    const launch = launchOf(adapter({ env: {} }), launchInput());
    expect(launch.plan.args[launch.plan.args.indexOf("--system-prompt") + 1]).toBe(join(home, ".pi/agent/deck/profiles/developer-team/system-prompt.md"));
    expect(launch.plan.envOverlay).not.toHaveProperty("PI_CODING_AGENT_DIR");
  });

  test("an invalid PI_CODING_AGENT_DIR blocks the launch", () => {
    const launch = launchOf(adapter({ env: { PI_CODING_AGENT_DIR: "" } }), launchInput());
    expect(launch.status).toBe("blocked");
    expect(launch.diagnostics[0]!.message).toContain("PI_CODING_AGENT_DIR");
  });
});
