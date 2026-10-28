// Protects exact native delegation, durable reconciliation, and revocation without repeating effects.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startNativeProjectReadiness } from "../../../../../apps/cli/src/native-project-readiness";
import { readDeckConfig } from "@deck/core";
import { PiNativePreparation } from "./preparation";
import type { VerifiedPiInvocation } from "./runner";
const cleanup: Array<() => void> = [];
afterEach(() => { for (const f of cleanup.splice(0).reverse()) f(); });
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-native-preparation-")); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "openspec"));
  const file = join(root, "openspec/config.yaml"), original = "schema: spec-driven\ntesting:\n  strict_tdd: true\n  commands:\n    test: bun test\n";
  writeFileSync(file, original);
  const host = await startNativeProjectReadiness({ projectRoot: root, runnerId: "pi", generation: "g", config: () => readDeckConfig(root) }); cleanup.push(() => host.close());
  const env = { ...host.environment, HOME: root, XDG_CONFIG_HOME: root };
  const coordinator = new PiNativePreparation(env), parentFile = join(root, "parent.jsonl");
  const snapshot = await coordinator.open(root, "parent", parentFile);
  const request = { snapshotId: snapshot!.snapshotId, components: ["retired-testing-policy"] };
  coordinator.delegate(request, "task", 1);
  let live = true;
  const binding: VerifiedPiInvocation = { parentId: "parent", taskId: "task", attempt: 1, generation: "g", roleId: "deck-setup", launchId: "launch", nativeSessionId: "native", current: () => live };
  return { root, file, original, env, parentFile, request, coordinator, binding, revoke: () => { live = false; } };
}
test("native repair records one intent and reconciles duplicate calls", async () => {
  const f = await fixture();
  expect((await f.coordinator.repair(f.binding, f.request)).status).toBe("changed");
  expect((await f.coordinator.repair(f.binding, f.request)).status).toBe("reconciled");
  const records = readFileSync(`${f.parentFile}.deck-preparation.jsonl`, "utf8").trim().split("\n").map(x => JSON.parse(x));
  expect(records.filter(x => x.state === "intent")).toHaveLength(1);
  expect(readFileSync(f.file, "utf8")).toContain("test: bun test");
  expect(readFileSync(f.file, "utf8")).not.toContain("strict_tdd");
});
test.each(["cancel", "role", "task", "attempt", "parent", "close", "config", "extra-field", "concurrent-edit"])("native repair rejects %s", async mode => {
  const f = await fixture();
  let request: unknown = f.request, binding = f.binding;
  if (mode === "cancel") f.revoke();
  if (mode === "role") binding = { ...binding, roleId: "deck-lead" };
  if (mode === "task") binding = { ...binding, taskId: "forged" };
  if (mode === "attempt") binding = { ...binding, attempt: 2 };
  if (mode === "parent") binding = { ...binding, parentId: "other" };
  if (mode === "close") f.coordinator.close();
  if (mode === "config") { mkdirSync(join(f.root, "deck")); writeFileSync(join(f.root, "deck/config.json"), "{}"); }
  if (mode === "extra-field") request = { ...f.request, roleId: "deck-setup" };
  if (mode === "concurrent-edit") writeFileSync(f.file, f.original + "# user edit\n");
  const before = readFileSync(f.file, "utf8");
  await expect(f.coordinator.repair(binding, request)).rejects.toThrow();
  expect(readFileSync(f.file, "utf8")).toBe(before);
});
test("restart reconciles a recorded postimage and cannot reuse an old delegation", async () => {
  const f = await fixture(); await f.coordinator.repair(f.binding, f.request);
  const journal = `${f.parentFile}.deck-preparation.jsonl`;
  const intent = readFileSync(journal, "utf8").split("\n")[0]!;
  writeFileSync(journal, intent + "\n", { mode: 0o600 }); // crash after replacement, before completed record
  f.coordinator.close();
  const restarted = new PiNativePreparation(f.env);
  await restarted.open(f.root, "parent", f.parentFile);
  expect(readFileSync(journal, "utf8")).toContain('"state":"reconciled"');
  await expect(restarted.repair(f.binding, f.request)).rejects.toThrow();
});
test("restart with an uncertain nonmatching effect disables repair", async () => {
  const f = await fixture(); await f.coordinator.repair(f.binding, f.request);
  const journal = `${f.parentFile}.deck-preparation.jsonl`, intent = readFileSync(journal, "utf8").split("\n")[0]!;
  writeFileSync(journal, intent + "\n", { mode: 0o600 }); writeFileSync(f.file, f.original + "# concurrent edit\n");
  f.coordinator.close(); const restarted = new PiNativePreparation(f.env);
  const snapshot = await restarted.open(f.root, "parent", f.parentFile);
  expect(snapshot!.observations.find(x => x.component === "retired-testing-policy")?.reason).toBe("repair-outcome-uncertain");
  expect(() => restarted.delegate({ ...f.request, snapshotId: snapshot!.snapshotId }, "new", 1)).toThrow();
});

import { createPiHarness, findRealPi } from "../../pi-cli-harness";
import { childSessionPath } from "./storage";
import { createDeckSubagentsExtension } from "./extension";
import { createPiDeveloperTeamExecutionExtensionV1 } from "../../../assets/pi/extensions/developer-team-execution";
// Protects production extension -> native Pi IPC -> parent service wiring; provider is local scripted fake.
for (const bundled of [false, true]) for (const mode of ["authorized", "undelegated", "forged-request"]) test.skipIf(!["linux", "darwin"].includes(process.platform) || !findRealPi())(`native Setup tool enforces exact delegation: ${mode}, bundled=${bundled}`, async () => {
  const h = createPiHarness({ installOptions: { modelAssignments: { "deck-setup": "faux/faux-1" } } });
  const file = join(h.project, "openspec/config.yaml"); mkdirSync(join(h.project, "openspec"), { recursive: true });
  writeFileSync(file, "schema: spec-driven\ntesting:\n  strict_tdd: true\n");
  const host = await startNativeProjectReadiness({ projectRoot: h.project, runnerId: "pi", generation: "g", config: () => readDeckConfig(h.project) });
  const tools: any[] = [], handlers: Record<string, any[]> = {}, snapshots: any[] = [];
  const parentFile = join(h.root, "parent.jsonl"); writeFileSync(parentFile, "");
  const ctx = { cwd: h.project, hasUI: false, isIdle: () => true, sessionManager: { getSessionId: () => "parent", getSessionFile: () => parentFile, getEntries: () => [], getBranch: () => [] } };
  const env: Record<string, string | undefined> = { ...host.environment, PATH: process.env.PATH, HOME: h.home, XDG_CONFIG_HOME: h.home,
    PI_CODING_AGENT_DIR: h.agentDir, FAUX_CHILD_TOOL: "deck_prepare_project" };
  const api = {
    on: (name: string, fn: any) => { (handlers[name] ??= []).push(fn); }, registerTool: (tool: any) => tools.push(tool), registerCommand() {},
    appendEntry: (_name: string, value: any) => snapshots.push(value), sendMessage() {},
  };
  const execution = bundled ? (await import("../../../assets/pi/extensions/" + "developer-team-execution.generated.js")).createPiDeveloperTeamExecutionExtensionV1 : createPiDeveloperTeamExecutionExtensionV1;
  // The shipped default reads process.env and discovers its installed agents relative to the asset.
  // Use the exported source factory for the parent, with the shipped execution bundle;
  // child Pi loads the generated subagent extension from the installed package.
  execution({ environment: env })(api);
  createDeckSubagentsExtension({ agentsDir: join(h.agentDir, "deck/package/agents"), piInvocation: args => ({ command: findRealPi()!, args }), killGraceMs: 50, env })(api as never);
  const emit = async (name: string) => { for (const fn of handlers[name] ?? []) await fn({}, ctx); };
  const call = async (params: any) => {
    for (const fn of handlers.tool_call ?? []) {
      const result = await fn({ toolName: "subagent", toolCallId: "call", input: params }, ctx);
      if (result?.block) return { isError: true, content: [{ text: result.reason }] };
    }
    return tools[0].execute("call", params, undefined, undefined, ctx);
  };
  try {
    await emit("session_start");
    const status = JSON.parse((await call({ action: "preparation-status" })).content[0].text);
    const request = { snapshotId: status.snapshotId, components: ["retired-testing-policy"] };
    env.FAUX_CHILD_TOOL_INPUT = JSON.stringify(mode === "forged-request" ? { ...request, components: ["skill-registry"] } : request);
    const accepted = await call({ agent: "deck-setup", task: "Repair delegated finding", ...(mode === "undelegated" ? {} : { preparation: request }) });
    expect(accepted.isError, JSON.stringify(accepted)).toBeUndefined();
    const id = accepted.details.taskIds[0], deadline = Date.now() + 15000;
    let job: any;
    do {
      job = snapshots.at(-1)?.jobs?.find((j: any) => j.id === id);
      if (["completed", "failed"].includes(job?.state)) break;
      await Bun.sleep(20);
    } while (Date.now() < deadline);
    expect(job?.state, JSON.stringify(job)).toBe("completed");
    const results = readFileSync(childSessionPath(parentFile, "parent", job.childId), "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(e => e.message?.role === "toolResult");
    expect(results).toHaveLength(1);
    expect(results[0].message.isError).toBe(mode !== "authorized");
    if (mode === "authorized") {
      expect(readFileSync(file, "utf8")).not.toContain("strict_tdd");
      expect(readFileSync(`${parentFile}.deck-preparation.jsonl`, "utf8")).toContain('"state":"completed"');
    } else {
      expect(readFileSync(file, "utf8")).toContain("strict_tdd");
      expect(readFileSync(`${parentFile}.deck-preparation.jsonl`, "utf8")).toBe("");
    }
  } finally {
    await emit("session_shutdown");
    const result = await call({ agent: "deck-setup", task: "Late delegation" });
    expect(result.isError).toBe(true);
    host.close(); h.cleanup();
  }
}, 20000);

// Protects the standalone provider composition, bounded writer and source-qualified refresh.
test("native Pi registry generation and stale refresh use its own provider", async () => {
  const f = await fixture();
  writeFileSync(join(f.root, ".gitignore"), "/.atl/skill-registry.md\n");
  const generate = { snapshotId: f.coordinator.status().snapshotId, components: ["skill-registry"] };
  f.coordinator.delegate(generate, "task", 1);
  expect((await f.coordinator.repair(f.binding, generate)).status).toBe("changed");
  const target = join(f.root, ".atl/skill-registry.md"), before = readFileSync(target, "utf8");
  mkdirSync(join(f.root, ".skills/new"), { recursive: true });
  writeFileSync(join(f.root, ".skills/new/SKILL.md"), "---\nname: new\ndescription: A new project skill\n---\n");
  const snapshot = await f.coordinator.open(f.root, "parent", f.parentFile);
  expect(snapshot.observations.find(o => o.component === "skill-registry")).toMatchObject({ reason: "registry-stale", sourceRunnerId: "pi" });
  const refresh = { snapshotId: snapshot.snapshotId, components: ["skill-registry"] };
  f.coordinator.delegate(refresh, "task", 1);
  expect((await f.coordinator.repair(f.binding, refresh)).status).toBe("changed");
  expect(readFileSync(target, "utf8")).not.toBe(before);
  expect((await f.coordinator.repair(f.binding, refresh)).status).toBe("reconciled");
});
