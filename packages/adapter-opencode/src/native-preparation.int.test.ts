// Protects native Lead -> task -> child -> current Setup tool correlation; SDK is the fake external edge.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDefaultDeckConfig, readDeckConfig } from "@deck/core";
import { startNativeProjectReadiness } from "../../../apps/cli/src/native-project-readiness";
import { createOpenCodeRunnerAdapter } from "./runner-adapter";
import { readOpenCodeNativeRole } from "./native-role-source";
import { createOpenCodeDeveloperTeamExecutionPluginV1 } from "../assets/opencode/plugins/developer-team-execution";
const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
async function fixture(component = "retired-testing-policy") {
  const root = mkdtempSync(join(tmpdir(), "opencode-preparation-")); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const config = join(root, "opencode"), project = join(root, "project"); mkdirSync(join(project, "openspec"), { recursive: true });
  const file = join(project, "openspec/config.yaml"), original = "schema: spec-driven\ntesting:\n  strict_tdd: true\n  commands:\n    test: bun test\n"; writeFileSync(file, original);
  writeFileSync(join(project, ".gitignore"), "/.atl/skill-registry.md\n");
  const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: config });
  const plan = adapter.buildDeveloperTeamInstallPlan!({ environmentId: "opencode-development", projectRoot: project, deckConfig: getDefaultDeckConfig(), ...(component === "skill-registry" ? { standaloneSkills: [] } : {}) });
  await adapter.applyDeveloperTeamInstall!({ environmentId: "opencode-development", projectRoot: project, plan });
  let valid = true;
  const host = await startNativeProjectReadiness({ projectRoot: project, runnerId: "opencode", generation: "generation", config: () => readDeckConfig(project), validateGeneration: () => { if (!valid) throw new Error("changed"); } }); cleanup.push(() => host.close());
  const env = { ...host.environment, HOME: root, XDG_STATE_HOME: root, XDG_CONFIG_HOME: root, OPENCODE_CONFIG_DIR: config };
  const task: any = { type: "tool", tool: "task", sessionID: "parent", messageID: "parent-message", callID: "task", state: { status: "running", input: { subagent_type: "deck-setup" }, metadata: { sessionId: "child" } } };
  const child: any = { id: "child", parentID: "parent" };
  const messages: Record<string, any> = {
    "parent-message": { info: { id: "parent-message", sessionID: "parent", role: "assistant", agent: "deck-lead" }, parts: [task, ...["status", "delegate"].map(callID => ({ type: "tool", callID, state: { status: "running" } }))] },
    "child-message": { info: { id: "child-message", sessionID: "child", role: "assistant", agent: "deck-setup" }, parts: [{ type: "tool", callID: "repair", state: { status: "running" } }] },
  };
  const client = { session: { message: async ({ path }: any) => ({ data: messages[path.messageID] }), get: async () => ({ data: child }) }, app: { agents: async () => ({ data: ["deck-lead", "deck-setup"].map(name => ({ name, prompt: readOpenCodeNativeRole(config, name).instructions })) }) } };
  const plugin = await createOpenCodeDeveloperTeamExecutionPluginV1({ environment: env })({ directory: project, client });
  const parent = (callID: string) => ({ sessionID: "parent", messageID: "parent-message", callID });
  const context = { sessionID: "child", messageID: "child-message", callID: "repair" };
  const status = JSON.parse(await plugin.tool!.deck_preparation_status!.execute({}, parent("status")));
  const request = { snapshotId: status.snapshotId, components: [component] };
  const arm = () => plugin.tool!.deck_delegate_preparation!.execute(request, parent("delegate"));
  const correlate = async () => {
    await plugin["tool.execute.before"]({ sessionID: "parent", callID: "task", tool: "task" }, { args: { subagent_type: "deck-setup" } });
    await plugin.event({ event: { type: "message.part.updated", properties: { part: task } } as any });
    await plugin["tool.execute.before"]({ sessionID: "child", callID: "repair", tool: "deck_prepare_project" }, { args: request });
  };
  const repair = (args: unknown = request) => plugin.tool!.deck_prepare_project!.execute(args, context);
  return { root, config, project, file, original, env, client, plugin, request, arm, correlate, repair, task, child, messages, context, invalidate: () => { valid = false; } };
}
test("production plugin repairs only the correlated child and records one durable intent", async () => {
  const f = await fixture(); await f.arm(); await f.correlate();
  expect(JSON.parse(await f.repair()).status).toBe("changed");
  expect(readFileSync(f.file, "utf8")).not.toContain("strict_tdd");
  expect(readFileSync(f.file, "utf8")).toContain("bun test");
  await expect(f.repair()).rejects.toThrow();
  f.context.callID = "repair-again";
  f.messages["child-message"].parts.push({ type: "tool", callID: f.context.callID, state: { status: "running" } });
  await f.plugin["tool.execute.before"]({ sessionID: "child", callID: f.context.callID, tool: "deck_prepare_project" }, { args: f.request });
  expect(JSON.parse(await f.repair()).status).toBe("reconciled");
});
test.each(["no-delegation", "no-correlation", "forged-child", "wrong-parent", "role-switch", "selection-switch", "cancel", "completed-task", "generation", "installed-edit", "concurrent-edit", "wrong-component", "caller-field"])("native transport rejects %s before effects", async mode => {
  const f = await fixture();
  if (mode !== "no-delegation") await f.arm();
  if (mode !== "no-delegation" && mode !== "no-correlation") await f.correlate();
  if (mode === "forged-child") f.task.state.metadata.sessionId = "other";
  if (mode === "wrong-parent") f.child.parentID = "other";
  if (mode === "role-switch") f.messages["child-message"].info.agent = "deck-apply-deep";
  if (mode === "selection-switch") await f.plugin["chat.message"]({ sessionID: "child", agent: "deck-apply-deep" }, {});
  if (mode === "cancel") await f.plugin.event({ event: { type: "session.error", properties: { sessionID: "child" } } as any });
  if (mode === "completed-task") await f.plugin["tool.execute.after"]({ sessionID: "parent", callID: "task", tool: "task" }, {});
  if (mode === "generation") f.invalidate();
  if (mode === "installed-edit") writeFileSync(join(f.config, "prompts/deck-team/deck-setup.md"), "changed");
  if (mode === "concurrent-edit") writeFileSync(f.file, f.original + "# user edit\n");
  const before = readFileSync(f.file, "utf8");
  await expect(f.repair(mode === "wrong-component" ? { ...f.request, components: ["skill-registry"] } : mode === "caller-field" ? { ...f.request, roleId: "deck-setup" } : f.request)).rejects.toThrow();
  expect(readFileSync(f.file, "utf8")).toBe(before);
});
test("delegation replay and selecting another native agent cannot grant authority", async () => {
  const f = await fixture(); await f.arm(); await expect(f.arm()).rejects.toThrow();
  await expect(f.plugin["tool.execute.before"]({ sessionID: "parent", callID: "task", tool: "task" }, { args: { subagent_type: "deck-apply-deep" } })).rejects.toThrow();
  await expect(f.repair()).rejects.toThrow(); expect(readFileSync(f.file, "utf8")).toBe(f.original);
});
test("plugin restart cannot recover delegation from native persisted messages", async () => {
  const f = await fixture(); await f.arm(); await f.correlate();
  const restarted = await createOpenCodeDeveloperTeamExecutionPluginV1({ environment: f.env })({ directory: f.project, client: f.client });
  await restarted.event({ event: { type: "message.part.updated", properties: { part: f.task } } as any });
  await expect(restarted.tool!.deck_prepare_project!.execute(f.request, f.context)).rejects.toThrow();
  expect(readFileSync(f.file, "utf8")).toBe(f.original);
});

test.each([false, true])("restart reconciles intent without repeating writes; concurrent edit=%s", async concurrent => {
  const f = await fixture(); await f.arm(); await f.correlate(); await f.repair();
  const journalDirectory = join(f.root, "deck/native-opencode-preparation");
  const { readdirSync } = await import("node:fs");
  const journal = join(journalDirectory, readdirSync(journalDirectory)[0]!);
  const intent = readFileSync(journal, "utf8").split("\n")[0]!;
  writeFileSync(journal, intent + "\n", { mode: 0o600 });
  if (concurrent) writeFileSync(f.file, f.original + "# concurrent after crash\n");
  const before = readFileSync(f.file, "utf8");
  const restarted = await createOpenCodeDeveloperTeamExecutionPluginV1({ environment: f.env })({ directory: f.project, client: f.client });
  const status = JSON.parse(await restarted.tool!.deck_preparation_status!.execute({}, { sessionID: "parent", messageID: "parent-message", callID: "status" }));
  expect(readFileSync(f.file, "utf8")).toBe(before);
  if (concurrent) expect(readFileSync(journal, "utf8")).toBe(intent + "\n");
  else expect(readFileSync(journal, "utf8")).toContain('"state":"reconciled"');
  if (concurrent) expect(status.observations.find((x: any) => x.component === "retired-testing-policy").reason).toBe("repair-outcome-uncertain");
  await expect(restarted.tool!.deck_prepare_project!.execute(f.request, f.context)).rejects.toThrow();
});

test("cancellation during SDK caller validation revokes the in-flight repair", async () => {
  const f = await fixture(); await f.arm(); await f.correlate();
  const original = f.client.session.message;
  f.client.session.message = async args => {
    await f.plugin.event({ event: { type: "session.deleted", properties: { info: { id: "child" } } } });
    return original(args);
  };
  await expect(f.repair()).rejects.toThrow();
  expect(readFileSync(f.file, "utf8")).toBe(f.original);
});

// Protects native OpenCode provider injection through the production plugin and exact child binding.
test("production plugin generates the registry with the OpenCode provider", async () => {
  const f = await fixture("skill-registry");
  await f.arm(); await f.correlate();
  expect(JSON.parse(await f.repair()).status).toBe("changed");
  const { parseSkillRegistryDocument } = await import("../../core/src/skill-discovery/registry");
  expect(parseSkillRegistryDocument(readFileSync(join(f.project, ".atl/skill-registry.md"), "utf8")).frontmatter?.completeness).toBe("complete");
});
