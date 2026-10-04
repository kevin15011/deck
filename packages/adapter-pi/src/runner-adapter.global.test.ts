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

  test("starts Pi's normal interactive TUI with the global lead profile and the Deck package as the first-priority CLI source", () => {
    const launch = launchOf(adapter(), launchInput());
    expect(launch.status).toBe("ready");
    expect(launch.plan.command).toBe("pi");
    expect(launch.plan.stdio).toBe("inherit");
    expect(launch.plan.stdin).toBe("inherit");
    const args = launch.plan.args;
    expect(args[args.indexOf("--system-prompt") + 1]).toBe(join(agentDir, "deck/profiles/developer-team/system-prompt.md"));
    expect(args[args.indexOf("--extension") + 1]).toBe(join(agentDir, "deck/package"));
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

describe("Deck MCP servers in the global mcp.json", () => {
  const exe = (name: string) => `/opt/fake/bin/${name}`;
  const fakeTools = (overrides: { codebase?: string | undefined } = {}) => ({
    resolveExecutable: (name: string) => (name === "npx" || name === "context-mode" ? exe(name) : undefined),
    codebase: { command: () => ("codebase" in overrides ? overrides.codebase : "/opt/fake/tools/codebase-memory-mcp") },
    rtk: { command: () => undefined, state: () => "absent", supported: () => true, install: async () => "installed", root: "/opt/fake/rtk" },
  });
  const input = (capabilityIds?: string[]) => ({ ...planInput(), ...(capabilityIds ? { capabilityIds } : {}) });
  const readMcp = () => JSON.parse(readFileSync(piAgentPaths(agentDir).mcp, "utf-8")).mcpServers as Record<string, Record<string, any>>;

  test("writes the selected servers with absolute commands, direct exposure and blanked memory env, owned by the manifest", async () => {
    const pi = adapter({ piTools: fakeTools() });
    const plan = pi.buildDeveloperTeamInstallPlan(input(["context-mode", "codebase-memory-mcp", "context7", "rtk"]));
    expect(plan.blocked).toBeFalsy();
    await pi.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan });

    const servers = readMcp();
    expect(Object.keys(servers).sort()).toEqual(["codebase-memory", "context-mode", "context7"]);
    for (const entry of Object.values(servers)) {
      expect(entry.command.startsWith("/")).toBe(true);
      expect(entry.exposure).toBe("direct");
      expect(entry.env).toEqual({ DECK_RUNNER_MEMORY_ENDPOINT: "", DECK_RUNNER_MEMORY_TOKEN: "", DECK_RUNNER_MEMORY_TOKEN_FILE: "" });
    }
    const manifest = JSON.parse(readFileSync(piAgentPaths(agentDir).manifest, "utf-8"));
    expect(Object.keys(manifest.mcp.servers).sort()).toEqual(["codebase-memory", "context-mode", "context7"]);
    expect(existsSync(join(projectRoot, ".pi"))).toBe(false);
    expect(await pi.verifyDeveloperTeamInstall(plan)).toMatchObject({ valid: true });
  });

  test("the lead profile documents the exposed tool names for the configured servers", async () => {
    const pi = adapter({ piTools: fakeTools() });
    const plan = pi.buildDeveloperTeamInstallPlan(input(["codebase-memory-mcp"]));
    await pi.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan });
    const profile = readFileSync(join(agentDir, "deck/profiles/developer-team/system-prompt.md"), "utf-8");
    expect(profile).toContain("mcp__codebase_memory__search_graph");
  });

  test("user servers are preserved and a deselected Deck server is removed", async () => {
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(piAgentPaths(agentDir).mcp, JSON.stringify({ mcpServers: { "my-tools": { command: "/usr/bin/x", exposure: "codemode" } } }));
    const pi = adapter({ piTools: fakeTools() });
    await pi.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan: pi.buildDeveloperTeamInstallPlan(input(["context-mode", "context7"])) });
    expect(Object.keys(readMcp()).sort()).toEqual(["context-mode", "context7", "my-tools"]);

    const next = adapter({ piTools: fakeTools() });
    await next.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan: next.buildDeveloperTeamInstallPlan(input(["context7"])) });
    expect(Object.keys(readMcp()).sort()).toEqual(["context7", "my-tools"]);
    expect(readMcp()["my-tools"]).toEqual({ command: "/usr/bin/x", exposure: "codemode" });
  });

  test("a launch-time plan (no explicit selection) keeps the servers Deck already configured", async () => {
    const pi = adapter({ piTools: fakeTools() });
    await pi.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan: pi.buildDeveloperTeamInstallPlan(input(["context7"])) });
    expect(Object.keys(readMcp())).toEqual(["context7"]);

    // No explicit selection: Context7 (a TUI-only choice) survives, and servers implied by enabled instruction
    // packages (default config: codebase-memory, context-mode) are added when their binaries resolve.
    const next = adapter({ piTools: fakeTools() });
    const launchPlan = next.buildDeveloperTeamInstallPlan(input());
    await next.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan: launchPlan });
    expect(Object.keys(readMcp()).sort()).toEqual(["codebase-memory", "context-mode", "context7"]);

    const again = adapter({ piTools: fakeTools() }).buildDeveloperTeamInstallPlan(input());
    expect(again.mutationPreview).toEqual([]);
  });

  test("a server whose binary is missing is skipped with a warning and nothing relative is ever written", async () => {
    const pi = adapter({ piTools: fakeTools({ codebase: undefined }) });
    const plan = pi.buildDeveloperTeamInstallPlan(input(["codebase-memory-mcp", "context7"]));
    expect(plan.diagnosticEntries?.some((entry) => entry.code === "PI_MCP_SERVER_UNAVAILABLE" && entry.severity === "warning")).toBe(true);
    await pi.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan });
    expect(Object.keys(readMcp())).toEqual(["context7"]);
  });

  test("a user-installed pi-mcp-adapter blocks MCP configuration with a remediation hint and is kept", () => {
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(piAgentPaths(agentDir).settings, JSON.stringify({ packages: ["npm:pi-mcp-adapter"] }));
    const plan = adapter({ piTools: fakeTools() }).buildDeveloperTeamInstallPlan(input(["context-mode"]));
    expect(plan.blocked).toBe(true);
    expect(plan.diagnostics?.join(" ")).toContain("pi remove");
    expect(JSON.parse(readFileSync(piAgentPaths(agentDir).settings, "utf-8")).packages).toEqual(["npm:pi-mcp-adapter"]);
  });

  test("an adapter-based Deck install is migrated: Deck-added pi-mcp-adapter and pi-subagents are removed with a backup", async () => {
    mkdirSync(join(agentDir, "agents"), { recursive: true });
    writeFileSync(join(agentDir, "agents", "deck-lead.md"), "legacy deck lead\n");
    writeFileSync(piAgentPaths(agentDir).settings, JSON.stringify({ packages: ["npm:pi-subagents", "npm:pi-mcp-adapter", "npm:user-pkg"], defaultModel: "keep" }));
    const pi = adapter({ piTools: fakeTools() });
    const plan = pi.buildDeveloperTeamInstallPlan(input(["context-mode"]));
    expect(plan.blocked).toBeFalsy();
    await pi.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan });

    const settings = JSON.parse(readFileSync(piAgentPaths(agentDir).settings, "utf-8"));
    expect(settings.packages).toEqual(["npm:user-pkg", "deck/package"]);
    expect(settings.defaultModel).toBe("keep");
    expect(existsSync(join(agentDir, "deck", "backups"))).toBe(true);
    expect(Object.keys(readMcp())).toEqual(["context-mode"]);
  });
});

describe("Web Search credential", () => {
  const exe = (name: string) => `/opt/fake/bin/${name}`;
  const tools = { resolveExecutable: (name: string) => exe(name), codebase: { command: () => undefined }, rtk: { command: () => undefined, state: () => "absent", supported: () => true, install: async () => "installed", root: "/x" } };
  const provider = { providerId: "tavily", implementationId: "tavily-mcp", semanticServerId: "web-search", command: ["npx", "-y", "tavily-mcp@0.2.22"], credentialEnvVar: "TAVILY_API_KEY", toolMapping: { search: "tavily_search", extract: "tavily_extract" }, forbiddenToolNames: [] } as never;
  const config = validateDeckConfig({ webSearch: { enabled: true, provider: "tavily" } });
  const launchInput = () => ({ mode: "interactive", teamId: "developer", projectRoot, prompt: [], deckConfig: config }) as never;

  async function installWebSearch(pi: ReturnType<typeof adapter>) {
    const plan = pi.buildDeveloperTeamInstallPlan({ ...planInput(), deckConfig: config, capabilityIds: ["web-search"] });
    await pi.applyDeveloperTeamInstall({ projectRoot, environmentId: "pi-development", plan });
  }

  test("the credential reaches only the launched process environment and never a file", async () => {
    const pi = adapter({ piTools: tools, webSearchProvider: provider, webSearchCredential: () => "tvly-test-credential-0123456789" });
    await installWebSearch(pi);
    const mcp = readFileSync(piAgentPaths(agentDir).mcp, "utf-8");
    expect(JSON.parse(mcp).mcpServers["web-search"]).toMatchObject({ command: "/opt/fake/bin/npx", args: ["-y", "tavily-mcp@0.2.22"], exposure: "direct" });

    const launch = (pi.buildLaunchPlan!(launchInput()) as unknown as { status: string; plan: { args: string[]; envOverlay: Record<string, { value: string; sensitive?: boolean }>; sensitiveEnvAuthorization?: { binding: string; keys: string[] } } });
    expect(launch.status).toBe("ready");
    expect(launch.plan.envOverlay.TAVILY_API_KEY).toEqual({ value: "tvly-test-credential-0123456789", sensitive: true });
    expect(launch.plan.sensitiveEnvAuthorization).toEqual({ binding: "deck-pi-web-search-v1", keys: ["TAVILY_API_KEY"] });

    const allText = (dir: string): string => readdirSync(dir, { withFileTypes: true }).map((entry) => (entry.isDirectory() ? allText(join(dir, entry.name)) : readFileSync(join(dir, entry.name), "utf-8"))).join("\n");
    expect(allText(agentDir)).not.toContain("tvly-test-credential");
    expect(JSON.stringify(launch.plan.args)).not.toContain("tvly-test-credential");
  });

  test("a missing credential launches with a diagnostic and without the variable", async () => {
    const pi = adapter({ piTools: tools, webSearchProvider: provider, webSearchCredential: () => undefined });
    await installWebSearch(pi);
    const launch = pi.buildLaunchPlan!(launchInput()) as unknown as { status: string; plan: { envOverlay: Record<string, unknown> }; diagnostics: { message: string }[] };
    expect(launch.status).toBe("ready");
    expect(launch.plan.envOverlay).not.toHaveProperty("TAVILY_API_KEY");
    expect(launch.diagnostics.map((entry) => entry.message).join(" ")).toMatch(/web search is unavailable/i);
  });

  test("nothing is injected when Web Search is disabled", () => {
    const pi = adapter({ piTools: tools, webSearchProvider: provider, webSearchCredential: () => "tvly-test-credential-0123456789" });
    const launch = pi.buildLaunchPlan!({ ...(launchInput() as object), deckConfig: validateDeckConfig({}) } as never) as unknown as { plan: { envOverlay: Record<string, unknown> } };
    expect(launch.plan.envOverlay).not.toHaveProperty("TAVILY_API_KEY");
  });
});

describe("review-plan actions on the global layout", () => {
  const context = () => ({ projectRoot, runnerId: "pi", environmentId: "pi-development" }) as never;
  const tools = (over: Record<string, unknown> = {}) => ({
    resolveExecutable: (name: string) => (name === "npx" || name === "context-mode" ? `/opt/fake/bin/${name}` : undefined),
    codebase: { command: () => "/opt/fake/tools/codebase-memory-mcp", existing: () => undefined, state: () => "ready", supported: () => true, install: async () => "unchanged", root: "/x/cb" },
    rtk: { command: () => undefined, state: () => "absent", supported: () => true, install: async () => { installed.push("rtk"); return "installed"; }, root: "/x/rtk" },
    ...over,
  });
  const installed: string[] = [];
  beforeEach(() => { installed.length = 0; });

  test("RTK installs through the Deck-owned pinned tool, never a PATH binary", async () => {
    const pi = adapter({ piTools: tools() });
    const result = await pi.runAction({ id: "capability.rtk.install", kind: "install-pi-package", title: "Install RTK", capabilityId: "rtk", toolId: "rtk", status: "ready" }, context());
    expect(installed).toEqual(["rtk"]);
    expect(result.status).toBe("executed");
  });

  test("an MCP config action validates readiness but never writes mcp.json itself", async () => {
    const pi = adapter({ piTools: tools() });
    for (const capabilityId of ["context-mode", "context7", "codebase-memory-mcp"]) {
      const result = await pi.runAction({ id: `capability.${capabilityId}.mcp-config`, kind: "write-pi-mcp-config", title: capabilityId, capabilityId, status: "ready" }, context());
      expect(result.status).toBe("executed");
      expect(result.message).toMatch(/Deck package|applied/i);
    }
    expect(existsSync(piAgentPaths(agentDir).mcp)).toBe(false);
    expect(existsSync(agentDir)).toBe(false);
  });

  test("an MCP config action fails clearly when the server cannot be resolved", async () => {
    const pi = adapter({ piTools: tools({ resolveExecutable: () => undefined, codebase: { command: () => undefined } }) });
    const result = await pi.runAction({ id: "capability.context-mode.mcp-config", kind: "write-pi-mcp-config", title: "context-mode", capabilityId: "context-mode", status: "ready" }, context());
    expect(result.status).toBe("failed");
    expect(result.diagnostics.join(" ")).toMatch(/context-mode/);
  });

  test("tool installation no longer edits settings.json packages (the manifest transaction owns them)", async () => {
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(piAgentPaths(agentDir).settings, JSON.stringify({ packages: ["npm:user-pkg"] }));
    const pi = adapter({ piTools: tools(), installTools: (async () => [{ tool: "Context7", success: true, actionKind: "install-pi-package", status: "installed", installKind: "npm-package-plus-mcp" }]) as never });
    await pi.runAction({ id: "capability.context7.install", kind: "install-pi-package", title: "Install Context7", capabilityId: "context7", toolId: "context7", status: "ready" }, { ...(context() as object), homeDirectory: home } as never);
    expect(JSON.parse(readFileSync(piAgentPaths(agentDir).settings, "utf-8"))).toEqual({ packages: ["npm:user-pkg"] });
  });
});

describe("adaptive memory switch in the launch plan", () => {
  const launchWith = (adaptiveMemory: Record<string, unknown>) => {
    const config = validateDeckConfig({});
    return launchOf(adapter(), { mode: "interactive", teamId: "developer", projectRoot, prompt: [], deckConfig: { ...config, adaptiveMemory: { ...config.adaptiveMemory, ...adaptiveMemory } } });
  };

  test("tells the memory extension to stay silent when adaptive memory is disabled", () => {
    expect(launchWith({ enabled: false }).plan.envOverlay?.DECK_PI_MEMORY).toEqual({ value: "disabled" });
    expect(launchWith({ enabled: true, activeProvider: "none" }).plan.envOverlay?.DECK_PI_MEMORY).toEqual({ value: "disabled" });
  });

  test("does not silence it when Supermemory is the active provider", () => {
    expect(launchWith({ enabled: true, activeProvider: "supermemory" }).plan.envOverlay).not.toHaveProperty("DECK_PI_MEMORY");
  });

  test("never writes a memory token or endpoint itself (the CLI host owns them)", () => {
    const overlay = launchWith({ enabled: true, activeProvider: "supermemory" }).plan.envOverlay ?? {};
    expect(Object.keys(overlay).filter((key) => key.startsWith("DECK_RUNNER_MEMORY"))).toEqual([]);
  });
});

describe("tool-policy configuration from the production adapter", () => {
  const rtkTools = (command: string | undefined) => ({
    resolveExecutable: (name: string) => (name === "codebase-memory" ? "/opt/fake/bin/codebase-memory-mcp" : undefined),
    codebase: { command: () => "/opt/fake/tools/codebase-memory-mcp", existing: () => undefined, state: () => "ready", supported: () => true, install: async () => "unchanged", root: "/x/cb" },
    rtk: { command: () => command, state: () => (command ? "ready" : "absent"), supported: () => true, install: async () => "unchanged", root: "/x/rtk" },
  });
  const configFor = (pi: ReturnType<typeof adapter>, capabilityIds?: string[]) => {
    const plan = pi.buildDeveloperTeamInstallPlan({ ...planInput(), ...(capabilityIds ? { capabilityIds } : {}) } as never);
    const file = plan.files.find((entry) => entry.path.endsWith("extensions/deck-tool-policy/config.json"));
    return JSON.parse(file!.content);
  };

  test("an explicit selection that includes RTK pins the owned binary; omitting RTK disables the rewrite", () => {
    const pi = adapter({ piTools: rtkTools("/owned/tools/rtk") });
    expect(configFor(pi, ["rtk"]).rtkBinary).toBe("/owned/tools/rtk");
    expect(configFor(pi, ["context7"]).rtkBinary).toBeNull();
  });

  test("a launch-time plan (no explicit selection) uses the owned RTK when it is usable", () => {
    expect(configFor(adapter({ piTools: rtkTools("/owned/tools/rtk") })).rtkBinary).toBe("/owned/tools/rtk");
    expect(configFor(adapter({ piTools: rtkTools(undefined) })).rtkBinary).toBeNull();
  });

  test("graph redirection follows the codebase-memory server selection", () => {
    const pi = adapter({ piTools: rtkTools(undefined) });
    expect(configFor(pi, ["codebase-memory-mcp"]).graphRedirect).toBe(true);
    expect(configFor(pi, ["context7"]).graphRedirect).toBe(false);
  });
});

describe("legacy detection and opt-in cleanup through the adapter", () => {
  const writeLegacyFromTemplates = async () => {
    const { buildDeveloperTeamInstallPlan } = await import("./developer-team-install");
    const { bindAdaptiveMemoryInstructionBundle, buildCapabilityInstructionBundle, getEnabledCapabilityInstructionIds } = await import("@deck/core");
    const config = validateDeckConfig({});
    const bundle = bindAdaptiveMemoryInstructionBundle(buildCapabilityInstructionBundle(getEnabledCapabilityInstructionIds(config, "pi"), {}), {});
    const legacy = buildDeveloperTeamInstallPlan(projectRoot, { capabilityInstructions: bundle, orchestratorPersonality: config.orchestratorPersonality, piMcpConfigPath: piAgentPaths(agentDir).mcp, piMcpHomeDir: home });
    const lead = legacy.agents.find((entry) => entry.agent.id === "deck-lead")!;
    mkdirSync(join(projectRoot, ".pi", "agents"), { recursive: true });
    writeFileSync(join(projectRoot, ".pi", "agents", "deck-lead.md"), lead.content);
    return lead;
  };

  test("every plan lists legacy project files with the cleanup hint and writes nothing", async () => {
    await writeLegacyFromTemplates();
    const before = tree(projectRoot);
    const plan = adapter().buildDeveloperTeamInstallPlan(planInput());
    const entry = plan.diagnosticEntries?.find((candidate) => candidate.code === "PI_LEGACY_ARTIFACTS");
    expect(entry?.severity).toBe("warning");
    expect(entry?.message).toContain(join(projectRoot, ".pi", "agents", "deck-lead.md"));
    expect(entry?.message).toContain("--cleanup-legacy");
    expect(tree(projectRoot)).toEqual(before);
  });

  test("legacy global skills are reported as shadowing the package skills; other-runner copies are never offered for removal", async () => {
    mkdirSync(join(agentDir, "skills", "deck-lead"), { recursive: true });
    writeFileSync(join(agentDir, "skills", "deck-lead", "SKILL.md"), "---\nname: deck-lead\n---\nAdaptive Developer Team Contract\n");
    const plan = adapter().buildDeveloperTeamInstallPlan(planInput());
    const entry = plan.diagnosticEntries?.find((candidate) => candidate.code === "PI_LEGACY_ARTIFACTS");
    expect(entry?.message).toContain("shadow");
    expect(entry?.message).toContain("~/.agents/skills");
    expect(entry?.message).toContain("--cleanup-legacy");
  });

  test("a clean project reports no legacy artifacts", () => {
    const plan = adapter().buildDeveloperTeamInstallPlan(planInput());
    expect(plan.diagnosticEntries?.some((candidate) => candidate.code === "PI_LEGACY_ARTIFACTS")).toBe(false);
  });

  test("cleanup removes the unmodified legacy file, keeps a backup and leaves modified files alone", async () => {
    const lead = await writeLegacyFromTemplates();
    writeFileSync(join(projectRoot, ".pi", "agents", "deck-quality.md"), "user edited quality agent\n");
    const backupRoot = join(root, "state", "backups", "pi-legacy");
    const pi = adapter({ legacyBackupRoot: () => backupRoot });
    const result = await pi.cleanupLegacyInstall!(projectRoot, { deckConfig: validateDeckConfig({}) });
    expect(result.removed).toEqual([join(projectRoot, ".pi", "agents", "deck-lead.md")]);
    expect(existsSync(join(projectRoot, ".pi", "agents", "deck-lead.md"))).toBe(false);
    expect(readFileSync(join(projectRoot, ".pi", "agents", "deck-quality.md"), "utf-8")).toBe("user edited quality agent\n");
    expect(result.preserved).toEqual([join(projectRoot, ".pi", "agents", "deck-quality.md")]);
    const [stamp] = readdirSync(backupRoot);
    expect(readFileSync(join(backupRoot, stamp!, "files", "0"), "utf-8")).toBe(lead.content);
  });

  test("without a Deck config nothing is provably unmodified, so nothing is removed", async () => {
    await writeLegacyFromTemplates();
    const result = await adapter({ legacyBackupRoot: () => join(root, "b") }).cleanupLegacyInstall!(projectRoot, {} as never);
    expect(result.removed).toEqual([]);
    expect(existsSync(join(projectRoot, ".pi", "agents", "deck-lead.md"))).toBe(true);
  });
});
