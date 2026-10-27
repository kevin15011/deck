import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { createClaudeRunnerAdapter } from "./runner-adapter";
import { getDefaultDeckConfig } from "@deck/core";
import { skillHash, verifyClaudeSessionSkills, claudeSessionPluginMcpDenials } from "./session-skills";
import { buildClaudeTurnLaunch } from "./session-driver/launch";
import { prepareSessionNativeSkills } from "../../../apps/cli/src/session-native-skills";

async function fixture(run: (adapter: ReturnType<typeof createClaudeRunnerAdapter>, plan: ReturnType<ReturnType<typeof createClaudeRunnerAdapter>["buildDeveloperTeamInstallPlan"]>, home: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "deck-session-skills-"));
  try {
    const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), resolveCommand: () => process.execPath });
    const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig: getDefaultDeckConfig(), capabilityIds: ["claude-team-files", "context7"] });
    expect(plan.blocked).toBe(false);
    await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan });
    await run(adapter, plan, home);
  } finally { await rm(home, { recursive: true, force: true }); }
}

test("production preparation verifies the full installed team plugin and launches it beside memory for every child", async () => {
  await fixture(async (adapter, plan, home) => {
    const descriptor = (await prepareSessionNativeSkills(adapter))!;
    const teamRoot = plan.files.find(f => f.path.endsWith("/.claude-plugin/plugin.json"))!.path.replace(/\/\.claude-plugin\/plugin.json$/, "");
    expect(descriptor.root).toBe(teamRoot);
    expect(descriptor.pluginName).toBe("deck-developer-team");
    expect(descriptor.files).toEqual(Object.fromEntries(plan.files.map(f => [relative(teamRoot, f.path), skillHash(f.content)])));
    expect(descriptor.files["agents/deck-lead.md"]).toBeDefined();
    expect(descriptor.files["skills/deck-lead/SKILL.md"]).toBeDefined();
    expect((await adapter.prepareSessionNativeSkills()).root).toBe(descriptor.root);
    for (const projectConfigTrusted of [false, true]) for (const memberId of ["lead", "apply-fast"]) {
      const input = {
        taskId: memberId, memberId, cwd: home, assignment: { runnerId: "claude", modelId: "haiku" },
        rolePrompt: "role", prompt: "task", nativeSessionId: "3f2b8c1e-5d4a-4b7e-9a1c-0e2d3f4a5b6c",
        mcp: { servers: [], sessionTools: [] }, mcpServerSpecs: {}, nativeSkills: descriptor,
        nativeMemory: { provider: "supermemory" as const, integration: "runner-plugin" as const, status: "ready" as const, projectScope: "sm_project_v1_test_repo", plugin: { root: "/memory" } },
        projectConfigTrusted, approvals: "runner-default" as const, credentialFile: "/credential", disableNativeDelegation: true,
      };
      const launch = buildClaudeTurnLaunch(input, { writePrivateFile: name => join(home, name) }, { baseEnv: { HOME: home } });
      expect(() => buildClaudeTurnLaunch({ ...input, nativeSkills: { ...descriptor, selectionHash: "0".repeat(64) } }, { writePrivateFile: name => join(home, name) }, { baseEnv: { HOME: home } })).toThrow("claude-session-skills-unverified");
      expect(launch.args.flatMap((arg, i) => arg === "--plugin-dir" ? [launch.args[i + 1]] : [])).toEqual([descriptor.root, "/memory"]);
      expect(launch.args).toContain(teamRoot);
      expect(launch.args[launch.args.indexOf("--disallowedTools") + 1]).toBe("Task,Agent");
      expect(launch.args).not.toContain("--agent");
      expect(launch.expectedMcpServers).toEqual([]);
      expect(JSON.parse(launch.args[launch.args.indexOf("--settings") + 1]!).deniedMcpServers).toContainEqual({ serverName: "plugin:deck-developer-team:context7" });
      for (const suppressed of [true, false]) {
        const routed = buildClaudeTurnLaunch({ ...input,
          mcp: { servers: suppressed ? [] : ["context7"], sessionTools: [] },
          mcpServerSpecs: { context7: { command: "/managed/context7", args: [], env: {} } },
          suppressedMcpServers: suppressed ? ["context7", "web-search", "codebase-memory"] : [],
        }, { writePrivateFile: name => join(home, name) }, { baseEnv: { HOME: home } });
        const denied = JSON.parse(routed.args[routed.args.indexOf("--settings") + 1]!).deniedMcpServers;
        expect(denied).toContainEqual({ serverName: "plugin:deck-developer-team:context7" });
        expect(routed.expectedMcpServers).toEqual(suppressed ? [] : ["context7"]);
      }

    }
    for (const extra of ["unexpected.json"]) {
      const path = join(descriptor.root, extra);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, "{}", { mode: 0o600 });
      expect(() => verifyClaudeSessionSkills(descriptor)).toThrow("claude-session-skills-unverified");
      await expect(adapter.prepareSessionNativeSkills()).rejects.toThrow("claude-session-skills-unverified");
      await rm(extra.includes("/") ? dirname(path) : path, { recursive: true });
    }
  });
});

test("selection and artifact drift fail closed", async () => {
  await fixture(async (adapter, _plan, _home) => {
    const descriptor = await adapter.prepareSessionNativeSkills();
    for (const field of ["selectionHash", "contentHash"] as const) {
      expect(() => verifyClaudeSessionSkills({ ...descriptor, [field]: "0".repeat(64) })).toThrow("claude-session-skills-unverified");
    }
    const path = join(descriptor.root, "skills/git-workflow-and-versioning/SKILL.md");
    const original = await readFile(path, "utf8");
    await writeFile(path, "tampered");
    expect(() => verifyClaudeSessionSkills(descriptor)).toThrow("claude-session-skills-unverified");
    await writeFile(path, original);
    const selection = await readFile(descriptor.selectionPath, "utf8");
    await writeFile(descriptor.selectionPath, selection.replace(descriptor.contentHash, "0".repeat(64)));
    expect(() => verifyClaudeSessionSkills(descriptor)).toThrow("claude-session-skills-unverified");
    await expect(adapter.prepareSessionNativeSkills()).rejects.toThrow("claude-session-skills-unverified");
  });
});

test("missing Claude generation fails closed; other native loaders are untouched", async () => {
  const home = await mkdtemp(join(tmpdir(), "deck-session-skills-empty-"));
  try {
    const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "deck") });
    await expect(prepareSessionNativeSkills(adapter)).rejects.toThrow("claude-session-skills-unverified");
    expect(await prepareSessionNativeSkills({ runnerId: "codex" } as never)).toBeUndefined();
    expect(await prepareSessionNativeSkills({ runnerId: "opencode" } as never)).toBeUndefined();
  } finally { await rm(home, { recursive: true, force: true }); }
});

// The session policy covers every manifest server, including retired or future IDs.
test("plugin MCP denials include all declared servers, regardless of session selection", async () => {
  const root = await mkdtemp(join(tmpdir(), "deck-plugin-mcp-"));
  try {
    const ids = ["context-mode", "codebase-memory", "context7", "serena", "web-search", "future-server"];
    const manifest = JSON.stringify({ mcpServers: Object.fromEntries(ids.map(id => [id, { command: id }])) });
    await writeFile(join(root, ".mcp.json"), manifest);
    expect(claudeSessionPluginMcpDenials({ root, pluginName: "deck-developer-team", selectionPath: "", selectionHash: "", contentHash: "", files: { ".mcp.json": skillHash(manifest) } })).toEqual(ids.map(id => `plugin:deck-developer-team:${id}`));
  } finally { await rm(root, { recursive: true, force: true }); }
});
