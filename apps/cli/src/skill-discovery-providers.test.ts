import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodexRunnerAdapter } from "../../../packages/adapter-codex/src/runner-adapter";
import { createClaudeRunnerAdapter } from "../../../packages/adapter-claude/src/runner-adapter";
import { createCodexSkillDiscoveryProvider } from "../../../packages/adapter-codex/src/skill-discovery-provider";
import { createClaudeSkillDiscoveryProvider } from "../../../packages/adapter-claude/src/skill-discovery-provider";
import { discoverSkillsFromProvider } from "../../../packages/core/src/skill-discovery/discovery";
const cleanup: string[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "deck-skills-")); cleanup.push(root);
  const home = join(root, "home"), project = join(root, "project"), config = join(root, "config");
  await Promise.all([home, project, config].map(path => mkdir(path)));
  const skill = async (directory: string, name: string) => { await mkdir(directory, { recursive: true }); await writeFile(join(directory, "SKILL.md"), `---\nname: ${name}\n---\nBody`); };
  return { root, home, project, config, skill };
}
const emptyInventory = async () => ({ outcome: "complete" as const, observations: [], diagnostics: [] });

test("production adapters expose discovery using effective configured roots", async () => {
  const f = await fixture();
  await f.skill(join(f.config, "skills", ".system", "system"), "system");
  await f.skill(join(f.home, ".agents", "skills", "shared"), "shared");
  const adapters = [createCodexRunnerAdapter({ userHome: f.home, codexHome: f.config }),
    createClaudeRunnerAdapter({ homeDir: f.home, dataRoot: join(f.home, "deck"), skillDiscovery: { configDir: f.config } })];
  for (const adapter of adapters) {
    expect(adapter.skillDiscovery).toBeDefined();
    const found = await discoverSkillsFromProvider({ projectRoot: f.project, activeRunnerId: adapter.runnerId, provider: adapter.skillDiscovery! });
    expect(found.observations.map(row => row.name).sort()).toEqual(["shared", "system"]);
    expect(found.outcome).toBe("indeterminate"); // Native/plugin inventory is not supplied by these adapters yet.
  }
});

test("explicit exposures include selected plugin, admitted project and shared system roots only", async () => {
  const f = await fixture();
  const plugin = join(f.root, "selected"), system = join(f.root, "system");
  await f.skill(join(plugin, "skills", "selected"), "selected");
  await f.skill(join(f.project, ".claude", "skills", "project"), "project");
  await f.skill(join(system, "extra"), "extra");
  await f.skill(join(f.project, ".codex", "skills", "invented"), "invented");
  let admitted = true;
  const provider = createClaudeSkillDiscoveryProvider({ homeDir: f.home, configDir: f.config, projectAdmitted: () => admitted, selectedPlugin: () => plugin, systemRoots: [system], inventory: emptyInventory });
  const found = await discoverSkillsFromProvider({ projectRoot: f.project, activeRunnerId: "claude", provider });
  expect(found.outcome, JSON.stringify(found.diagnostics)).toBe("complete");
  expect(found.observations.map(row => row.name).sort()).toEqual(["extra", "project", "selected"]);
  const projectRow = found.observations.find(row => row.name === "project")!;
  expect((await provider.resolveLocator({ projectRoot: f.project, locator: projectRow.locator })).status).toBe("available");
  admitted = false;
  expect((await provider.resolveLocator({ projectRoot: f.project, locator: projectRow.locator })).status).toBe("rejected");
  const sources = await provider.listSources({ projectRoot: f.project });
  expect(JSON.stringify(sources)).not.toContain(f.root);
});

test("resolution revalidates containment, deletion and native exposure", async () => {
  const f = await fixture();
  await f.skill(join(f.config, "skills", "safe"), "safe");
  await f.skill(join(f.root, "outside"), "outside");
  await symlink(join(f.root, "outside"), join(f.config, "skills", "escape"));
  let exposed = true;
  const provider = createCodexSkillDiscoveryProvider({ homeDir: f.home, codexHome: f.config, inventory: async () => ({ outcome: "complete", observations: exposed ? [{ opaqueId: "native", name: "native" }] : [], diagnostics: [] }) });
  const resolve = (locator: string) => provider.resolveLocator({ projectRoot: f.project, locator });
  for (const value of ["../outside/SKILL.md", "%2e%2e/outside/SKILL.md", "escape/SKILL.md", "%252e%252e/outside/SKILL.md"]) expect((await resolve(`runner:codex:codex-home-skills/${value}`)).status).toBe("rejected");
  expect((await resolve("runner:claude:codex-home-skills/safe/SKILL.md")).status).toBe("rejected");
  expect((await resolve("runner:codex:codex-home-skills/safe/SKILL.md")).status).toBe("available");
  await rm(join(f.config, "skills", "safe"), { recursive: true });
  expect((await resolve("runner:codex:codex-home-skills/safe/SKILL.md")).status).toBe("missing");
  expect((await resolve("runner:codex:codex-inventory/native")).status).toBe("available");
  exposed = false;
  expect((await resolve("runner:codex:codex-inventory/native")).status).toBe("missing");
});

test("unavailable roots and oversized inventory stay partial without exposing private diagnostics", async () => {
  const f = await fixture();
  await writeFile(join(f.config, "skills"), "not a directory");
  const provider = createCodexSkillDiscoveryProvider({ homeDir: f.home, codexHome: f.config,
    inventory: async () => ({ outcome: "complete", observations: [], diagnostics: [{ code: "private", message: f.root }] }) });
  const sources = await provider.listSources({ projectRoot: f.project });
  expect(sources.outcome).toBe("indeterminate");
  expect(JSON.stringify(sources)).not.toContain(f.root);
  const oversized = createCodexSkillDiscoveryProvider({ homeDir: f.home, codexHome: f.config,
    inventory: async () => ({ outcome: "complete", observations: Array.from({ length: 501 }, (_, i) => ({ opaqueId: `item-${i}`, name: "item" })), diagnostics: [] }) });
  expect((await oversized.resolveLocator({ projectRoot: f.project, locator: "runner:codex:codex-inventory/item-0" })).status).toBe("rejected");
});

test("Claude production discovery includes selected stale Deck content and enabled plugins only", async () => {
  const f = await fixture();
  const { claudeModelMetadata, claudePluginName } = await import("../../../packages/adapter-claude/src/models");
  const parent = join(f.home, "deck", "claude");
  const selected = join(parent, claudePluginName({}));
  await f.skill(join(selected, "skills", "selected-old"), "selected-old");
  await writeFile(join(parent, "model-assignments.json"), claudeModelMetadata({}), { mode: 0o600 });
  await f.skill(join(f.config, "skills", "user"), "user");
  const enabled = join(f.root, "enabled"), disabled = join(f.root, "disabled");
  await f.skill(join(enabled, "skills", "enabled"), "enabled");
  await f.skill(join(disabled, "skills", "disabled"), "disabled");
  await mkdir(join(f.config, "plugins"));
  await writeFile(join(f.config, "settings.json"), JSON.stringify({ enabledPlugins: { "yes@market": true, "no@market": false } }));
  await writeFile(join(f.config, "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: {
    "yes@market": [{ scope: "user", installPath: enabled }], "no@market": [{ scope: "user", installPath: disabled }],
  } }));
  const adapter = createClaudeRunnerAdapter({ homeDir: f.home, dataRoot: join(f.home, "deck"), skillDiscovery: { configDir: f.config } });
  const found = await discoverSkillsFromProvider({ projectRoot: f.project, activeRunnerId: "claude", provider: adapter.skillDiscovery! });
  expect(found.observations.map(row => row.name).sort()).toEqual(["enabled", "selected-old", "user"]);
  const row = found.observations.find(row => row.name === "enabled")!;
  expect((await adapter.skillDiscovery!.resolveLocator({ projectRoot: f.project, locator: row.locator })).status).toBe("available");
  await writeFile(join(f.config, "settings.json"), JSON.stringify({ enabledPlugins: { "yes@market": false } }));
  expect((await adapter.skillDiscovery!.resolveLocator({ projectRoot: f.project, locator: row.locator })).status).toBe("rejected");
});

test("Claude partial selection and plugin metadata preserve independent roots and gate project exposure", async () => {
  const f = await fixture();
  await f.skill(join(f.config, "skills", "user"), "user");
  const plugin = join(f.root, "project-plugin");
  await f.skill(join(plugin, "skills", "project-plugin"), "project-plugin");
  await mkdir(join(f.project, ".claude"));
  await mkdir(join(f.config, "plugins"));
  await writeFile(join(f.project, ".claude/settings.json"), JSON.stringify({ enabledPlugins: { "project@market": true } }));
  await writeFile(join(f.config, "plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "project@market": [{ scope: "project", projectPath: f.project, installPath: plugin }] } }));
  let admitted = false;
  const provider = createClaudeSkillDiscoveryProvider({ homeDir: f.home, configDir: f.config, projectAdmitted: () => admitted,
    selectedPlugin: () => { throw new Error("private selection failure"); }, inventory: emptyInventory });
  const discover = () => discoverSkillsFromProvider({ projectRoot: f.project, activeRunnerId: "claude", provider });
  const untrusted = await discover();
  expect(untrusted.outcome).toBe("indeterminate");
  expect(untrusted.observations.map(row => row.name)).toEqual(["user"]);
  admitted = true;
  const trusted = await discover();
  expect(trusted.observations.map(row => row.name).sort()).toEqual(["project-plugin", "user"]);
  const row = trusted.observations.find(row => row.name === "project-plugin")!;
  admitted = false;
  expect((await provider.resolveLocator({ projectRoot: f.project, locator: row.locator })).status).toBe("rejected");
  await writeFile(join(f.config, "settings.json"), "invalid json");
  const partial = await discover();
  expect(partial.outcome).toBe("indeterminate");
  expect(partial.observations.map(row => row.name)).toEqual(["user"]);
  expect(JSON.stringify(partial.diagnostics)).not.toContain(f.root);
});
