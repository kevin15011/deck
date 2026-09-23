import { describe, expect, test } from "bun:test";
import type { SkillDiscoverySourceProviderV1, SkillRegistryRecordV1 } from "@deck/core";

import { createTaskSkillDiscoveryHostV1, createTaskSkillDiscoverySessionV1 } from "./task-skill-discovery";

const record: SkillRegistryRecordV1 = {
  name: "lead-helper",
  source_category: "user_runner",
  scope: "user",
  locator: "runner:opencode:opencode-config-skills/lead-helper%2FSKILL.md",
  observation_id: "sha256:lead-helper",
  runner_id: "opencode",
  task_signals: ["lead"],
  technology_signals: [],
  path_signals: [],
};

const provider: SkillDiscoverySourceProviderV1 = {
  schema: "skill-discovery-source-provider-v1",
  runnerId: "opencode",
  listSources: async () => ({ outcome: "complete", sources: [], diagnostics: [] }),
  resolveLocator: async () => ({ status: "missing" }),
};

describe("task skill-discovery session association", () => {
  test("owns an idempotent trusted session binding and suppresses late completion after retirement", async () => {
    const host = createTaskSkillDiscoveryHostV1({
      projectRoot: process.cwd(), activeRunnerId: "opencode", registryStatus: "ready",
      readRegistry: async () => [record], discoverDirectly: async () => ({ outcome: "complete", observations: [], diagnostics: [] }), provider: { ...provider, resolveLocator: async () => ({ status: "available", loadReference: "native" }) },
      nativeLoader: { schema: "skill-native-load-port-v1", prepare: async () => ({ outcome: "loadable" }), load: async () => ({ outcome: "unobserved" }) },
      verifyNativeLoad: async ({ name, directory }) => name === "lead-helper" && directory === "safe-dir",
    });
    const first = await host.open({ session_id: "native-session", task_id: "lead" });
    expect(await host.open({ session_id: "native-session", task_id: "lead" })).toEqual(first);
    const searched = await host.search(first, { schema: "skill-candidate-query-v1", terms: ["lead"], limit: 1 });
    await host.prepare(first, { observation_id: searched.candidates[0]!.observation_id });
    expect(await host.beforeNativeLoad(first, { call_id: "call-1", name: "lead-helper" })).toEqual({ outcome: "armed" });
    host.retire(first);
    expect(await host.observeNativeLoad(first, { call_id: "call-1", name: "lead-helper", directory: "safe-dir" })).toEqual({ outcome: "unobserved" });
  });

  test("keeps task generations isolated and requires matching native completion metadata", async () => {
    const host = createTaskSkillDiscoveryHostV1({
      projectRoot: process.cwd(), activeRunnerId: "opencode", registryStatus: "ready",
      readRegistry: async () => [record], discoverDirectly: async () => ({ outcome: "complete", observations: [], diagnostics: [] }), provider: { ...provider, resolveLocator: async () => ({ status: "available", loadReference: "native" }) },
      nativeLoader: { schema: "skill-native-load-port-v1", prepare: async () => ({ outcome: "loadable" }), load: async () => ({ outcome: "unobserved" }) },
      verifyNativeLoad: async ({ name, directory }) => name === "lead-helper" && directory === "safe-dir",
    });
    const lead = await host.open({ session_id: "native-session", task_id: "lead" });
    const specialist = await host.open({ session_id: "native-session", task_id: "specialist" });

    const searched = await host.search(lead, { schema: "skill-candidate-query-v1", terms: ["lead"], limit: 1 });
    await host.prepare(lead, { observation_id: searched.candidates[0]!.observation_id });

    expect(await host.beforeNativeLoad(specialist, { call_id: "call-specialist", name: "lead-helper" })).toEqual({ outcome: "unprepared" });
    expect(await host.beforeNativeLoad(lead, { call_id: "call-mismatch", name: "lead-helper" })).toEqual({ outcome: "armed" });
    expect(await host.observeNativeLoad(lead, { call_id: "call-mismatch", name: "lead-helper", directory: "wrong-dir" })).toEqual({ outcome: "unobserved" });
    expect(host.getOutcome(specialist)).toEqual({ outcome: "unobserved" });

    await host.prepare(lead, { observation_id: searched.candidates[0]!.observation_id });
    expect(await host.beforeNativeLoad(lead, { call_id: "call-loaded", name: "lead-helper" })).toEqual({ outcome: "armed" });
    expect(await host.observeNativeLoad(lead, { call_id: "call-loaded", name: "lead-helper", directory: "safe-dir" })).toEqual({ outcome: "loaded" });
    expect(host.getOutcome(lead)).toEqual({ outcome: "loaded" });
  });

  test("rejects forged bindings and invalidates prepared selections before native calls", async () => {
    let exposed = true;
    const host = createTaskSkillDiscoveryHostV1({
      projectRoot: process.cwd(), activeRunnerId: "opencode", registryStatus: "ready",
      readRegistry: async () => exposed ? [record] : [], discoverDirectly: async () => ({ outcome: "complete", observations: [], diagnostics: [] }), provider: { ...provider, resolveLocator: async () => exposed ? { status: "available", loadReference: "native" } : { status: "missing" } },
      nativeLoader: {
        schema: "skill-native-load-port-v1",
        prepare: async () => ({ outcome: "loadable", expected_name: "lead-helper", expected_directory: "safe-dir" }),
        load: async () => ({ outcome: "unobserved" }),
      },
    });
    const binding = await host.open({ session_id: "native-session", task_id: "lead" });
    const forged = { ...binding };
    expect(await host.search(forged, { schema: "skill-candidate-query-v1", terms: ["lead"], limit: 1 })).toMatchObject({ diagnostics: [expect.objectContaining({ code: "host_binding_unavailable" })] });

    const searched = await host.search(binding, { schema: "skill-candidate-query-v1", terms: ["lead"], limit: 1 });
    await host.prepare(binding, { observation_id: searched.candidates[0]!.observation_id });
    exposed = false;
    expect(await host.beforeNativeLoad(binding, { call_id: "call-1", name: "lead-helper" })).toEqual({ outcome: "rejected" });

    exposed = true;
    const refreshed = await host.search(binding, { schema: "skill-candidate-query-v1", terms: ["lead"], limit: 1 });
    await host.prepare(binding, { observation_id: refreshed.candidates[0]!.observation_id });
    expect(await host.beforeNativeLoad(binding, { call_id: "call-2", name: "lead-helper" })).toEqual({ outcome: "armed" });
    expect(await host.observeNativeLoad(binding, { call_id: "call-2", name: "lead-helper", directory: "wrong-dir" })).toEqual({ outcome: "unobserved" });
    expect(await host.observeNativeLoad(binding, { call_id: "call-2", name: "lead-helper", directory: "safe-dir" })).toEqual({ outcome: "unobserved" });
  });

  test("retirement during native verification cannot return loaded", async () => {
    let releaseVerification: (() => void) | undefined;
    const host = createTaskSkillDiscoveryHostV1({
      projectRoot: process.cwd(), activeRunnerId: "opencode", registryStatus: "ready",
      readRegistry: async () => [record], discoverDirectly: async () => ({ outcome: "complete", observations: [], diagnostics: [] }), provider: { ...provider, resolveLocator: async () => ({ status: "available", loadReference: "native" }) },
      nativeLoader: {
        schema: "skill-native-load-port-v1",
        prepare: async () => ({ outcome: "loadable", expected_name: "lead-helper", expected_directory: "safe-dir" }),
        load: async () => ({ outcome: "unobserved" }),
      },
      verifyNativeLoad: async () => new Promise<boolean>((resolve) => { releaseVerification = () => resolve(true); }),
    });
    const binding = await host.open({ session_id: "native-session", task_id: "lead" });
    const searched = await host.search(binding, { schema: "skill-candidate-query-v1", terms: ["lead"], limit: 1 });
    await host.prepare(binding, { observation_id: searched.candidates[0]!.observation_id });
    await host.beforeNativeLoad(binding, { call_id: "call-1", name: "lead-helper" });
    const observing = host.observeNativeLoad(binding, { call_id: "call-1", name: "lead-helper", directory: "safe-dir" });
    host.retire(binding);
    releaseVerification?.();
    expect(await observing).toEqual({ outcome: "unobserved" });
  });

  test("arms native rendezvous without awaiting final native completion", async () => {
    const host = createTaskSkillDiscoveryHostV1({
      projectRoot: process.cwd(), activeRunnerId: "opencode", registryStatus: "ready",
      readRegistry: async () => [record], discoverDirectly: async () => ({ outcome: "complete", observations: [], diagnostics: [] }), provider: { ...provider, resolveLocator: async () => ({ status: "available", loadReference: "/tmp/lead-helper/SKILL.md" }) },
      nativeLoader: {
        schema: "skill-native-load-port-v1",
        prepare: async () => ({ outcome: "loadable", expected_name: "lead-helper", expected_directory: "/tmp/lead-helper" } as { outcome: "loadable"; expected_name: string; expected_directory: string }),
        load: async () => ({ outcome: "unobserved" }),
      },
    });
    const binding = await host.open({ session_id: "native-session", task_id: "lead" });
    const searched = await host.search(binding, { schema: "skill-candidate-query-v1", terms: ["lead"], limit: 1 });
    const prepared = await host.prepare(binding, { observation_id: searched.candidates[0]!.observation_id });
    expect(prepared.preparation).toEqual({ outcome: "loadable" });

    const before = await Promise.race([
      host.beforeNativeLoad(binding, { call_id: "call-1", name: "lead-helper" }),
      new Promise((resolve) => setTimeout(() => resolve({ outcome: "timed-out" }), 50)),
    ]);
    expect(before).toEqual({ outcome: "armed" });
    expect(host.getOutcome(binding)).toEqual({ outcome: "unobserved" });
    expect(await host.observeNativeLoad(binding, { call_id: "call-1", name: "lead-helper", directory: "/tmp/lead-helper" })).toEqual({ outcome: "loaded" });
  });

  test("binds selections to the calling session and task without putting candidates in delegation context", async () => {
    const session = createTaskSkillDiscoverySessionV1({
      sessionId: "session-a",
      taskId: "lead-task",
      projectRoot: process.cwd(),
      activeRunnerId: "opencode",
      registryStatus: "ready",
      readRegistry: async () => [record],
      discoverDirectly: async () => ({ outcome: "complete", observations: [], diagnostics: [] }),
      provider,
    });

    const search = await session.runtime.search({ schema: "skill-candidate-query-v1", terms: ["lead"], limit: 1 });
    const selection = session.runtime.select({ observation_id: search.candidates[0]!.observation_id });
    expect(selection).toMatchObject({ outcome: "selected", reference: { session_id: "session-a", task_id: "lead-task" } });
    expect(session.context).toEqual({ session_id: "session-a", task_id: "lead-task", active_runner_id: "opencode" });
    expect(session.context).not.toHaveProperty("candidates");

    const specialist = createTaskSkillDiscoverySessionV1({
      sessionId: "session-a",
      taskId: "specialist-task",
      projectRoot: process.cwd(),
      activeRunnerId: "opencode",
      registryStatus: "ready",
      readRegistry: async () => [record],
      discoverDirectly: async () => ({ outcome: "complete", observations: [], diagnostics: [] }),
      provider,
    });
    if (selection.outcome !== "selected") throw new Error("expected a selection");

    expect(await specialist.runtime.prepare(selection.reference)).toEqual({ outcome: "rejected" });
    expect(specialist.context).not.toHaveProperty("candidates");
  });
});
