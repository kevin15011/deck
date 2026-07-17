import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createRunnerHostFixtureV1 } from "../../sdd-runtime/src/testing/developer-team-runner-host-fixture";
import { reviseExecutionDossierV1 } from "../../sdd-runtime/src/contracts/execution-dossier";
import { createPiDeveloperTeamExecutionBridgeV1 } from "./developer-team-execution-bridge";
import { buildPiTeamLaunchPlan } from "./pi-team-launch";
import { materializeTeamProfile } from "./pi-team-profile";

let extensionModuleInstance = 0;

async function loadPiExtensionFactory() {
  const projectRoot = mkdtempSync(join(tmpdir(), "deck-pi-extension-module-"));
  materializeTeamProfile({ teamId: "developer-team", projectRoot });
  const extensionPath = buildPiTeamLaunchPlan({ teamId: "developer-team", projectRoot }).extensionPath;
  try {
    const module = await import(`${pathToFileURL(extensionPath).href}?instance=${++extensionModuleInstance}`) as {
      createPiDeveloperTeamExecutionExtensionV1: (options?: Record<string, unknown>) => (api: { on(event: string, handler: (event: any, context: any) => Promise<unknown>): void }) => void;
    };
    return module.createPiDeveloperTeamExecutionExtensionV1;
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

async function runPiHostFixture(
  revisedDossier = false,
  eventMode: "active" | "shadow" = "active",
  invocationAuthorization: "static-compatible" | "invocation-required" = "invocation-required",
) {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
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
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  const createExtension = await loadPiExtensionFactory();
  const extension = createExtension({
    authorizationService: fixture.authorizationService,
    bridge,
    invocationAuthorization,
    resolveExecutionEvent: async () => {
      resolverCalls += 1;
      return executionEvent;
    },
  });
  extension({ on: (event, handler) => handlers.set(event, handler) });
  await handlers.get("input")?.({ text: "Apply the authorized batch." }, {});
  const input: Record<string, unknown> = { agent: "deck-developer-apply-general" };
  const hookResult = await handlers.get("tool_call")?.({ toolName: "subagent", toolCallId: "pi-execution-1", input }, {});
  return { fixture, bridgeCalls, bridgeResult, resolverCalls, hookResult, input };
}

test("D-REACH-01 Pi launch plan packages and loads the execution extension", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "deck-pi-reach-"));
  try {
    materializeTeamProfile({ teamId: "developer-team", projectRoot });
    const plan = buildPiTeamLaunchPlan({ teamId: "developer-team", projectRoot });
    expect(plan.extensionPath).toBe(join(plan.profileDir, "extensions", "developer-team-execution.js"));
    expect(plan.args).toContain("--extension");
    expect(plan.args[plan.args.indexOf("--extension") + 1]).toBe(plan.extensionPath);
    expect(readFileSync(plan.extensionPath, "utf8")).toContain('"tool_call"');
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("D-REACH-02 Pi extension hook invokes the Pi bridge", async () => {
  const outcome = await runPiHostFixture();
  expect(outcome.bridgeCalls).toBe(1);
  expect(outcome.fixture.delegationCount()).toBe(1);
});

test("D-REACH-03 Pi bridge reaches Batch C composition and effect", async () => {
  const outcome = await runPiHostFixture();
  expect(outcome.bridgeResult?.composition?.plan.decision?.action).toBe("targeted_repair");
  expect(outcome.bridgeResult?.effect).toEqual({ invoked: true });
  expect(outcome.bridgeResult?.code).toBe("executed");
});

test("D-REACH-10 Pi runner-host fixture uses extension registration rather than direct control-plane calls", async () => {
  const outcome = await runPiHostFixture();
  expect(outcome.hookResult).toBeUndefined();
  expect(outcome.input.deckExecution).toBeUndefined();
  expect(outcome.resolverCalls).toBe(1);
  expect(outcome.bridgeCalls).toBe(1);
  expect(outcome.fixture.delegationCount()).toBe(1);
});

test("EG8-REACH-15 Pi static-compatible ignores active V1 events and preserves legacy effects", async () => {
  const outcome = await runPiHostFixture(false, "active", "static-compatible");
  expect(outcome.bridgeCalls).toBe(0);
  expect(outcome.bridgeResult).toBeUndefined();
  expect(outcome.fixture.delegationCount()).toBe(0);
});

test("EG8-REACH-16 Pi static-compatible permits shadow observation without effects", async () => {
  const outcome = await runPiHostFixture(false, "shadow", "static-compatible");
  expect(outcome.bridgeCalls).toBe(1);
  expect(outcome.bridgeResult?.code).toBe("shadow-complete");
  expect(outcome.fixture.delegationCount()).toBe(0);
});

test("EG8-REACH-12 Pi packaged extension preserves revised dossier history", async () => {
  const outcome = await runPiHostFixture(true);
  expect(outcome.bridgeResult?.code).toBe("executed");
  expect(outcome.bridgeResult?.composition?.plan.dossier?.revision).toBe(2);
  expect(outcome.bridgeResult?.composition?.plan.dossierHistory).toEqual([outcome.fixture.dossier]);
});

test("Pi static-compatible hook ignores agent context and preserves legacy delegation without a provider", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  const createExtension = await loadPiExtensionFactory();
  createExtension()({ on: (event, handler) => handlers.set(event, handler) });
  await handlers.get("input")?.({ text: "Untrusted invocation" }, {});
  const hookResult = await handlers.get("tool_call")?.({
    toolName: "subagent",
    toolCallId: "pi-execution-1",
    input: { agent: "deck-developer-apply-general", deckExecution: fixture.event() },
  }, {});
  expect(hookResult).toBeUndefined();
  expect(fixture.delegationCount()).toBe(0);
});

test("Pi static-compatible hook preserves legacy delegation when its provider fails", async () => {
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  const createExtension = await loadPiExtensionFactory();
  createExtension({ resolveExecutionEvent: async () => { throw new Error("SECRET_PROVIDER_SENTINEL"); } })({ on: (event, handler) => handlers.set(event, handler) });
  await handlers.get("input")?.({ text: "Provider error" }, {});
  const hookResult = await handlers.get("tool_call")?.({ toolName: "subagent", toolCallId: "provider-error", input: { agent: "deck-developer-apply-general" } }, {});
  expect(hookResult).toBeUndefined();
  expect(String(hookResult)).not.toContain("SECRET_PROVIDER_SENTINEL");
});

test("Pi invocation-required hook blocks when the trusted provider is absent", async () => {
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  const createExtension = await loadPiExtensionFactory();
  createExtension({ invocationAuthorization: "invocation-required" })({ on: (event, handler) => handlers.set(event, handler) });
  await handlers.get("input")?.({ text: "Required invocation" }, {});
  expect(await handlers.get("tool_call")?.({
    toolName: "subagent",
    toolCallId: "required-missing-provider",
    input: { agent: "deck-developer-apply-general" },
  }, {})).toEqual({ block: true, reason: "modification-not-authorized:AUTHZ_MISSING" });
});

test("Pi invocation-required hook redacts trusted-provider failures", async () => {
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  const createExtension = await loadPiExtensionFactory();
  createExtension({
    invocationAuthorization: "invocation-required",
    resolveExecutionEvent: async () => { throw new Error("SECRET_PROVIDER_SENTINEL"); },
  })({ on: (event, handler) => handlers.set(event, handler) });
  await handlers.get("input")?.({ text: "Required provider error" }, {});
  const hookResult = await handlers.get("tool_call")?.({
    toolName: "subagent",
    toolCallId: "required-provider-error",
    input: { agent: "deck-developer-apply-general" },
  }, {});
  expect(hookResult).toEqual({ block: true, reason: "invalid-evidence" });
  expect(JSON.stringify(hookResult)).not.toContain("SECRET_PROVIDER_SENTINEL");
});
