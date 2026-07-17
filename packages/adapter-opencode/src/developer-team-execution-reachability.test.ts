import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createRunnerHostFixtureV1 } from "../../sdd-runtime/src/testing/developer-team-runner-host-fixture";
import { reviseExecutionDossierV1 } from "../../sdd-runtime/src/contracts/execution-dossier";
import { applyOpenCodeDeveloperTeamInstall, buildOpenCodeDeveloperTeamInstallPlan } from "./developer-team-install";
import { createOpenCodeDeveloperTeamExecutionBridgeV1 } from "./developer-team-execution-bridge";

let pluginModuleInstance = 0;

async function loadOpenCodePluginFactory() {
  const configDir = mkdtempSync(join(tmpdir(), "deck-opencode-plugin-module-"));
  const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/deck-project", { configDir });
  applyOpenCodeDeveloperTeamInstall(plan, { configDir });
  const pluginPath = plan.executionPlugin!.absolutePath;
  try {
    const module = await import(`${pathToFileURL(pluginPath).href}?instance=${++pluginModuleInstance}`) as {
      createOpenCodeDeveloperTeamExecutionPluginV1: (options?: Record<string, unknown>) => () => Promise<Record<string, (...args: any[]) => Promise<unknown>>>;
    };
    return module.createOpenCodeDeveloperTeamExecutionPluginV1;
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
}

async function runOpenCodeHostFixture(
  revisedDossier = false,
  eventMode: "active" | "shadow" = "active",
  invocationAuthorization: "static-compatible" | "invocation-required" = "invocation-required",
) {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  const revised = revisedDossier ? reviseExecutionDossierV1(fixture.dossier, {}) : undefined;
  const executionEvent = revised
    ? fixture.event({ mode: eventMode, dossier: { kind: "execution-dossier-v1", value: revised, history: [fixture.dossier] } }, revised)
    : fixture.event({ mode: eventMode });
  let bridgeCalls = 0;
  let resolverCalls = 0;
  let bridgeResult: Awaited<ReturnType<typeof fixture.bridge.execute>> | undefined;
  const bridge = {
    ...fixture.bridge,
    execute: async (event: unknown) => {
      bridgeCalls += 1;
      bridgeResult = await fixture.bridge.execute(event);
      return bridgeResult;
    },
  };
  const createPlugin = await loadOpenCodePluginFactory();
  const plugin = createPlugin({
    authorizationService: fixture.authorizationService,
    bridge,
    invocationAuthorization,
    resolveExecutionEvent: async () => {
      resolverCalls += 1;
      return executionEvent;
    },
  });
  const hooks = await plugin();
  await hooks["chat.message"]({ sessionID: "session-1", messageID: "message-1" }, { message: { role: "user" }, parts: [{ type: "text", text: "Apply the authorized batch." }] });
  const args: Record<string, unknown> = { subagent_type: "deck-developer-apply-general" };
  await hooks["tool.execute.before"]({ tool: "delegate", sessionID: "session-1", callID: "opencode-execution-1" }, { args });
  return { fixture, bridgeCalls, bridgeResult, resolverCalls, args };
}

test("D-REACH-04 OpenCode install materializes the packaged execution plugin", () => {
  const configDir = mkdtempSync(join(tmpdir(), "deck-opencode-reach-"));
  try {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/deck-project", { configDir });
    const result = applyOpenCodeDeveloperTeamInstall(plan, { configDir });
    const pluginPath = join(configDir, "plugins", "developer-team-execution.js");
    expect(plan.executionPlugin?.absolutePath).toBe(pluginPath);
    expect(readFileSync(pluginPath, "utf8")).toContain('"tool.execute.before"');
    expect(result.fileResults.find((entry) => entry.kind === "plugin")).toEqual({ agentId: "developer-team-execution", kind: "plugin", status: "created", absolutePath: pluginPath });
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});

test("D-REACH-05 OpenCode plugin hook invokes the OpenCode bridge", async () => {
  const outcome = await runOpenCodeHostFixture();
  expect(outcome.bridgeCalls).toBe(1);
  expect(outcome.fixture.delegationCount()).toBe(1);
});

test("D-REACH-06 OpenCode bridge reaches Batch C composition and effect", async () => {
  const outcome = await runOpenCodeHostFixture();
  expect(outcome.bridgeResult?.composition?.plan.decision?.action).toBe("targeted_repair");
  expect(outcome.bridgeResult?.effect).toEqual({ invoked: true });
  expect(outcome.bridgeResult?.code).toBe("executed");
});

test("D-REACH-09 OpenCode runner-host fixture uses plugin registration rather than direct control-plane calls", async () => {
  const outcome = await runOpenCodeHostFixture();
  expect(outcome.args.deckExecution).toBeUndefined();
  expect(outcome.resolverCalls).toBe(1);
  expect(outcome.bridgeCalls).toBe(1);
  expect(outcome.fixture.delegationCount()).toBe(1);
});

test("EG8-REACH-13 OpenCode static-compatible ignores active V1 events and preserves legacy effects", async () => {
  const outcome = await runOpenCodeHostFixture(false, "active", "static-compatible");
  expect(outcome.bridgeCalls).toBe(0);
  expect(outcome.bridgeResult).toBeUndefined();
  expect(outcome.fixture.delegationCount()).toBe(0);
});

test("EG8-REACH-14 OpenCode static-compatible permits shadow observation without effects", async () => {
  const outcome = await runOpenCodeHostFixture(false, "shadow", "static-compatible");
  expect(outcome.bridgeCalls).toBe(1);
  expect(outcome.bridgeResult?.code).toBe("shadow-complete");
  expect(outcome.fixture.delegationCount()).toBe(0);
});

test("EG8-REACH-11 OpenCode packaged plugin preserves revised dossier history", async () => {
  const outcome = await runOpenCodeHostFixture(true);
  expect(outcome.bridgeResult?.code).toBe("executed");
  expect(outcome.bridgeResult?.composition?.plan.dossier?.revision).toBe(2);
  expect(outcome.bridgeResult?.composition?.plan.dossierHistory).toEqual([outcome.fixture.dossier]);
});

test("OpenCode static-compatible hook ignores agent context and preserves legacy delegation without a provider", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  const createPlugin = await loadOpenCodePluginFactory();
  const hooks = await createPlugin()();
  await hooks["chat.message"]({ sessionID: "session-untrusted", messageID: "message-untrusted" }, { message: { role: "user" }, parts: [] });
  const args = { subagent_type: "deck-developer-apply-general", deckExecution: fixture.event() };
  let rejection: unknown;
  try {
    await hooks["tool.execute.before"](
      { tool: "delegate", sessionID: "session-untrusted", callID: "opencode-execution-1" },
      { args },
    );
  } catch (error) {
    rejection = error;
  }
  expect(rejection).toBeUndefined();
  expect(args.deckExecution).toBeUndefined();
  expect(fixture.delegationCount()).toBe(0);
});

test("OpenCode static-compatible hook preserves legacy delegation when its provider fails", async () => {
  const createPlugin = await loadOpenCodePluginFactory();
  const hooks = await createPlugin({ resolveExecutionEvent: async () => { throw new Error("SECRET_PROVIDER_SENTINEL"); } })();
  await hooks["chat.message"]({ sessionID: "session-provider-error", messageID: "message-provider-error" }, { message: { role: "user" }, parts: [] });
  let rejection: unknown;
  try {
    await hooks["tool.execute.before"]({ tool: "delegate", sessionID: "session-provider-error", callID: "provider-error" }, { args: { subagent_type: "deck-developer-apply-general" } });
  } catch (error) {
    rejection = error;
  }
  expect(rejection).toBeUndefined();
  expect(String(rejection)).not.toContain("SECRET_PROVIDER_SENTINEL");
});

test("OpenCode invocation-required hook blocks when the trusted provider is absent", async () => {
  const createPlugin = await loadOpenCodePluginFactory();
  const hooks = await createPlugin({ invocationAuthorization: "invocation-required" })();
  await hooks["chat.message"]({ sessionID: "session-required", messageID: "message-required" }, { message: { role: "user" }, parts: [] });
  await expect(hooks["tool.execute.before"](
    { tool: "delegate", sessionID: "session-required", callID: "required-missing-provider" },
    { args: { subagent_type: "deck-developer-apply-general" } },
  )).rejects.toThrow("modification-not-authorized:AUTHZ_MISSING");
});

test("OpenCode invocation-required hook redacts trusted-provider failures", async () => {
  const createPlugin = await loadOpenCodePluginFactory();
  const hooks = await createPlugin({
    invocationAuthorization: "invocation-required",
    resolveExecutionEvent: async () => { throw new Error("SECRET_PROVIDER_SENTINEL"); },
  })();
  await hooks["chat.message"]({ sessionID: "session-required-error", messageID: "message-required-error" }, { message: { role: "user" }, parts: [] });
  await expect(hooks["tool.execute.before"](
    { tool: "delegate", sessionID: "session-required-error", callID: "required-provider-error" },
    { args: { subagent_type: "deck-developer-apply-general" } },
  )).rejects.toThrow("invalid-evidence");
});
