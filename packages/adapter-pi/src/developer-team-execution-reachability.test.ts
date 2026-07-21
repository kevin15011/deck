import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createRunnerHostFixtureV1 } from "../../sdd-runtime/src/testing/developer-team-runner-host-fixture";
import { reviseExecutionDossierV1 } from "../../sdd-runtime/src/contracts/execution-dossier";
import { createPiDeveloperTeamExecutionBridgeV1 } from "./developer-team-execution-bridge";
import { createPiDeveloperTeamExecutionExtensionV1 } from "../assets/pi/extensions/developer-team-execution";
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

const HOST_CONTEXT_SYMBOL = Symbol.for("deck.developer-team.execution-context.v1");

test("D-REACH-22-Pi extension captures resolver at init; late global installation has no effect", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  let bridgeCalls = 0;
  const bridge = {
    ...fixture.bridge,
    execute: async (event: unknown) => {
      bridgeCalls += 1;
      return fixture.bridge.execute(event);
    },
  };
  const extension = createPiDeveloperTeamExecutionExtensionV1({
    authorizationService: fixture.authorizationService,
    bridge,
    invocationAuthorization: "invocation-required",
  });
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  extension({ on: (event, handler) => handlers.set(event, handler) });
  const input: Record<string, unknown> = { agent: "deck-developer-apply-general" };
  const first = await handlers.get("tool_call")?.({ toolName: "subagent", toolCallId: "pi-late-global-1", input }, {});
  expect(first).toEqual({ block: true, reason: "modification-not-authorized:AUTHZ_MISSING" });
  (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL] = {
    resolvePi: async () => fixture.event(),
  } as any;
  try {
    const second = await handlers.get("tool_call")?.({ toolName: "subagent", toolCallId: "pi-late-global-2", input }, {});
    expect(second).toEqual({ block: true, reason: "modification-not-authorized:AUTHZ_MISSING" });
  } finally {
    delete (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL];
  }
  expect(bridgeCalls).toBe(0);
});

test("D-REACH-23-Pi extension captures mode at init; post-init options mutation has no effect", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  const options: Record<string, unknown> = {
    authorizationService: fixture.authorizationService,
    bridge: fixture.bridge,
    invocationAuthorization: "static-compatible",
  };
  const extension = createPiDeveloperTeamExecutionExtensionV1(options as any);
  options.invocationAuthorization = "invocation-required";
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  extension({ on: (event, handler) => handlers.set(event, handler) });
  const input: Record<string, unknown> = { agent: "deck-developer-apply-general" };
  const hookResult = await handlers.get("tool_call")?.({ toolName: "subagent", toolCallId: "pi-mutable-options", input }, {});
  expect(hookResult).toBeUndefined();
});

test("D-REACH-24-Pi installed resolver returning null yields invalid-evidence in invocation-required", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  let bridgeCalls = 0;
  let resolverCalls = 0;
  const bridge = {
    ...fixture.bridge,
    execute: async (event: unknown) => {
      bridgeCalls += 1;
      return fixture.bridge.execute(event);
    },
  };
  const extension = createPiDeveloperTeamExecutionExtensionV1({
    authorizationService: fixture.authorizationService,
    bridge,
    invocationAuthorization: "invocation-required",
    resolveExecutionEvent: async () => {
      resolverCalls += 1;
      return null;
    },
  });
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  extension({ on: (event, handler) => handlers.set(event, handler) });
  const input: Record<string, unknown> = { agent: "deck-developer-apply-general" };
  const hookResult = await handlers.get("tool_call")?.({ toolName: "subagent", toolCallId: "pi-null-resolver", input }, {});
  expect(hookResult).toEqual({ block: true, reason: "invalid-evidence" });
  expect(resolverCalls).toBe(1);
  expect(bridgeCalls).toBe(0);
});

test("D-REACH-25-Pi installed resolver returning non-object yields invalid-evidence in invocation-required", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  let bridgeCalls = 0;
  let resolverCalls = 0;
  const bridge = {
    ...fixture.bridge,
    execute: async (event: unknown) => {
      bridgeCalls += 1;
      return fixture.bridge.execute(event);
    },
  };
  const extension = createPiDeveloperTeamExecutionExtensionV1({
    authorizationService: fixture.authorizationService,
    bridge,
    invocationAuthorization: "invocation-required",
    resolveExecutionEvent: async () => {
      resolverCalls += 1;
      return "malformed";
    },
  });
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  extension({ on: (event, handler) => handlers.set(event, handler) });
  const input: Record<string, unknown> = { agent: "deck-developer-apply-general" };
  const hookResult = await handlers.get("tool_call")?.({ toolName: "subagent", toolCallId: "pi-non-object-resolver", input }, {});
  expect(hookResult).toEqual({ block: true, reason: "invalid-evidence" });
  expect(resolverCalls).toBe(1);
  expect(bridgeCalls).toBe(0);
});

test("D-REACH-26-Pi non-Apply role strips caller deckExecution, provider not called, zero bridge", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  let bridgeCalls = 0;
  let resolverCalls = 0;
  const bridge = {
    ...fixture.bridge,
    execute: async (event: unknown) => {
      bridgeCalls += 1;
      return fixture.bridge.execute(event);
    },
  };
  const extension = createPiDeveloperTeamExecutionExtensionV1({
    authorizationService: fixture.authorizationService,
    bridge,
    invocationAuthorization: "invocation-required",
    resolveExecutionEvent: async () => {
      resolverCalls += 1;
      return fixture.event();
    },
  });
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  extension({ on: (event, handler) => handlers.set(event, handler) });
  const input: Record<string, unknown> = { agent: "verify-general", deckExecution: fixture.event() };
  const hookResult = await handlers.get("tool_call")?.({ toolName: "subagent", toolCallId: "pi-non-apply", input }, {});
  expect(hookResult).toBeUndefined();
  expect(input.deckExecution).toBeUndefined();
  expect(resolverCalls).toBe(0);
  expect(bridgeCalls).toBe(0);
});

test("D-REACH-27-Pi non-Apply role preserves zero bridge/effect even when caller provides deckExecution", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  let bridgeCalls = 0;
  let resolverCalls = 0;
  const bridge = {
    ...fixture.bridge,
    execute: async (event: unknown) => {
      bridgeCalls += 1;
      return fixture.bridge.execute(event);
    },
  };
  const extension = createPiDeveloperTeamExecutionExtensionV1({
    authorizationService: fixture.authorizationService,
    bridge,
    invocationAuthorization: "invocation-required",
    resolveExecutionEvent: async () => {
      resolverCalls += 1;
      return fixture.event();
    },
  });
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  extension({ on: (event, handler) => handlers.set(event, handler) });
  const input: Record<string, unknown> = { agent: "review-general", deckExecution: fixture.event() };
  const hookResult = await handlers.get("tool_call")?.({ toolName: "subagent", toolCallId: "pi-non-apply-with-marker", input }, {});
  expect(hookResult).toBeUndefined();
  expect(input.deckExecution).toBeUndefined();
  expect(resolverCalls).toBe(0);
  expect(bridgeCalls).toBe(0);
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

test("D-REACH-18 Pi caller-only deckExecution with no provider fails closed in invocation-required", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  const input: Record<string, unknown> = {
    agent: "deck-developer-apply-general",
    deckExecution: fixture.event(),
  };
  let bridgeCalls = 0;
  const extension = createPiDeveloperTeamExecutionExtensionV1({
    authorizationService: fixture.authorizationService,
    bridge: {
      ...fixture.bridge,
      execute: async (event: unknown) => {
        bridgeCalls += 1;
        return fixture.bridge.execute(event);
      },
    },
    invocationAuthorization: "invocation-required",
  });
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  extension({ on: (event, handler) => handlers.set(event, handler) });
  await handlers.get("input")?.({ text: "Apply the authorized batch." }, {});
  const hookResult = await handlers.get("tool_call")?.({
    toolName: "subagent",
    toolCallId: "caller-only-required-execution",
    input,
  }, {});
  expect(hookResult).toEqual({ block: true, reason: "modification-not-authorized:AUTHZ_MISSING" });
  expect(input.deckExecution).toBeUndefined();
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-19 Pi caller-only deckExecution with no provider preserves legacy in static-compatible", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  const input: Record<string, unknown> = {
    agent: "deck-developer-apply-general",
    deckExecution: fixture.event(),
  };
  let bridgeCalls = 0;
  const extension = createPiDeveloperTeamExecutionExtensionV1({
    authorizationService: fixture.authorizationService,
    bridge: {
      ...fixture.bridge,
      execute: async (event: unknown) => {
        bridgeCalls += 1;
        return fixture.bridge.execute(event);
      },
    },
    invocationAuthorization: "static-compatible",
  });
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  extension({ on: (event, handler) => handlers.set(event, handler) });
  await handlers.get("input")?.({ text: "Apply the authorized batch." }, {});
  const hookResult = await handlers.get("tool_call")?.({
    toolName: "subagent",
    toolCallId: "caller-only-static-execution",
    input,
  }, {});
  expect(hookResult).toBeUndefined();
  expect(input.deckExecution).toBeUndefined();
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-20 Pi provider authority wins over conflicting caller deckExecution", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  const providerEvent = fixture.event();
  const input: Record<string, unknown> = {
    agent: "deck-developer-apply-general",
    deckExecution: fixture.event({ mode: "legacy" }),
  };
  let bridgeCalls = 0;
  let seenEvent: unknown;
  const extension = createPiDeveloperTeamExecutionExtensionV1({
    authorizationService: fixture.authorizationService,
    bridge: {
      ...fixture.bridge,
      execute: async (event: unknown) => {
        bridgeCalls += 1;
        seenEvent = event;
        return fixture.bridge.execute(event);
      },
    },
    invocationAuthorization: "invocation-required",
    resolveExecutionEvent: async () => providerEvent,
  });
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  extension({ on: (event, handler) => handlers.set(event, handler) });
  await handlers.get("input")?.({ text: "Apply the authorized batch." }, {});
  await handlers.get("tool_call")?.({
    toolName: "subagent",
    toolCallId: "conflict-execution",
    input,
  }, {});
  expect(input.deckExecution).toBeUndefined();
  expect(bridgeCalls).toBe(1);
  expect((seenEvent as Record<string, unknown>)?.mode).toBe("active");
  expect(fixture.delegationCount()).toBe(1);
});

test("D-REACH-21 Pi caller marker cannot activate a provider-supplied V1 active event in static-compatible mode", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  let bridgeCalls = 0;
  const createExtension = await loadPiExtensionFactory();
  const extension = createExtension({
    authorizationService: fixture.authorizationService,
    bridge: {
      ...fixture.bridge,
      execute: async (event: unknown) => {
        bridgeCalls += 1;
        return fixture.bridge.execute(event);
      },
    },
    invocationAuthorization: "static-compatible",
    resolveExecutionEvent: async () => fixture.event(),
  });
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  extension({ on: (event, handler) => handlers.set(event, handler) });
  await handlers.get("input")?.({ text: "Observe only." }, {});
  const hookResult = await handlers.get("tool_call")?.({
    toolName: "subagent",
    toolCallId: "marker-execution",
    input: {
      agent: "deck-developer-apply-general",
      deckExecution: {
        deterministicRepairAuthority: {
          schema: "deterministic-targeted-repair-authority-v1",
        },
      },
    },
  }, {});
  expect(hookResult).toBeUndefined();
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-28 Pi invalid invocationAuthorization string yields invalid-evidence with zero resolver/bridge/effect", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  let resolverCalls = 0;
  let bridgeCalls = 0;
  const extension = createPiDeveloperTeamExecutionExtensionV1({
    authorizationService: fixture.authorizationService,
    bridge: {
      ...fixture.bridge,
      execute: async (event: unknown) => {
        bridgeCalls += 1;
        return fixture.bridge.execute(event);
      },
    },
    invocationAuthorization: "unknown-mode" as any,
    resolveExecutionEvent: async () => {
      resolverCalls += 1;
      return fixture.event();
    },
  });
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  extension({ on: (event, handler) => handlers.set(event, handler) });
  await handlers.get("input")?.({ text: "Apply." }, {});
  const hookResult = await handlers.get("tool_call")?.({
    toolName: "subagent",
    toolCallId: "pi-invalid-mode",
    input: { agent: "deck-developer-apply-general" },
  }, {});
  expect(hookResult).toEqual({ block: true, reason: "invalid-evidence" });
  expect(resolverCalls).toBe(0);
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-29 Pi null invocationAuthorization yields invalid-evidence with zero resolver/bridge/effect", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  let resolverCalls = 0;
  let bridgeCalls = 0;
  const extension = createPiDeveloperTeamExecutionExtensionV1({
    authorizationService: fixture.authorizationService,
    bridge: {
      ...fixture.bridge,
      execute: async (event: unknown) => {
        bridgeCalls += 1;
        return fixture.bridge.execute(event);
      },
    },
    invocationAuthorization: null as any,
    resolveExecutionEvent: async () => {
      resolverCalls += 1;
      return fixture.event();
    },
  });
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  extension({ on: (event, handler) => handlers.set(event, handler) });
  await handlers.get("input")?.({ text: "Apply." }, {});
  const hookResult = await handlers.get("tool_call")?.({
    toolName: "subagent",
    toolCallId: "pi-null-mode",
    input: { agent: "deck-developer-apply-general" },
  }, {});
  expect(hookResult).toEqual({ block: true, reason: "invalid-evidence" });
  expect(resolverCalls).toBe(0);
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-30 Pi object invocationAuthorization yields invalid-evidence with zero resolver/bridge/effect", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  let resolverCalls = 0;
  let bridgeCalls = 0;
  const extension = createPiDeveloperTeamExecutionExtensionV1({
    authorizationService: fixture.authorizationService,
    bridge: {
      ...fixture.bridge,
      execute: async (event: unknown) => {
        bridgeCalls += 1;
        return fixture.bridge.execute(event);
      },
    },
    invocationAuthorization: { mode: "invocation-required" } as any,
    resolveExecutionEvent: async () => {
      resolverCalls += 1;
      return fixture.event();
    },
  });
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  extension({ on: (event, handler) => handlers.set(event, handler) });
  await handlers.get("input")?.({ text: "Apply." }, {});
  const hookResult = await handlers.get("tool_call")?.({
    toolName: "subagent",
    toolCallId: "pi-object-mode",
    input: { agent: "deck-developer-apply-general" },
  }, {});
  expect(hookResult).toEqual({ block: true, reason: "invalid-evidence" });
  expect(resolverCalls).toBe(0);
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-31 Pi empty string invocationAuthorization yields invalid-evidence with zero resolver/bridge/effect", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  let resolverCalls = 0;
  let bridgeCalls = 0;
  const extension = createPiDeveloperTeamExecutionExtensionV1({
    authorizationService: fixture.authorizationService,
    bridge: {
      ...fixture.bridge,
      execute: async (event: unknown) => {
        bridgeCalls += 1;
        return fixture.bridge.execute(event);
      },
    },
    invocationAuthorization: "" as any,
    resolveExecutionEvent: async () => {
      resolverCalls += 1;
      return fixture.event();
    },
  });
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  extension({ on: (event, handler) => handlers.set(event, handler) });
  await handlers.get("input")?.({ text: "Apply." }, {});
  const hookResult = await handlers.get("tool_call")?.({
    toolName: "subagent",
    toolCallId: "pi-empty-mode",
    input: { agent: "deck-developer-apply-general" },
  }, {});
  expect(hookResult).toEqual({ block: true, reason: "invalid-evidence" });
  expect(resolverCalls).toBe(0);
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-32 Pi post-init mutation of invalid invocationAuthorization does not bypass", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  const options: any = {
    authorizationService: fixture.authorizationService,
    bridge: fixture.bridge,
    invocationAuthorization: "invalid-mode",
  };
  const extension = createPiDeveloperTeamExecutionExtensionV1(options);
  options.invocationAuthorization = "invocation-required";
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  extension({ on: (event, handler) => handlers.set(event, handler) });
  await handlers.get("input")?.({ text: "Apply." }, {});
  const hookResult = await handlers.get("tool_call")?.({
    toolName: "subagent",
    toolCallId: "pi-post-mutate",
    input: { agent: "deck-developer-apply-general" },
  }, {});
  expect(hookResult).toEqual({ block: true, reason: "invalid-evidence" });
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-33 Pi late global provider does not bypass invalid invocationAuthorization", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  let bridgeCalls = 0;
  const extension = createPiDeveloperTeamExecutionExtensionV1({
    authorizationService: fixture.authorizationService,
    bridge: {
      ...fixture.bridge,
      execute: async (event: unknown) => {
        bridgeCalls += 1;
        return fixture.bridge.execute(event);
      },
    },
    invocationAuthorization: "invalid-mode" as any,
  });
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  extension({ on: (event, handler) => handlers.set(event, handler) });
  (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL] = {
    resolvePi: async () => fixture.event(),
  } as any;
  try {
    await handlers.get("input")?.({ text: "Apply." }, {});
    const hookResult = await handlers.get("tool_call")?.({
      toolName: "subagent",
      toolCallId: "pi-late-global-invalid",
      input: { agent: "deck-developer-apply-general" },
    }, {});
    expect(hookResult).toEqual({ block: true, reason: "invalid-evidence" });
  } finally {
    delete (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL];
  }
  expect(bridgeCalls).toBe(0);
});

test("D-REACH-34 Pi installed resolver with missing receipt yields invalid-evidence in invocation-required", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  let bridgeCalls = 0;
  let resolverCalls = 0;
  const extension = createPiDeveloperTeamExecutionExtensionV1({
    authorizationService: fixture.authorizationService,
    bridge: {
      ...fixture.bridge,
      execute: async (event: unknown) => {
        bridgeCalls += 1;
        return fixture.bridge.execute(event);
      },
    },
    invocationAuthorization: "invocation-required",
    resolveExecutionEvent: async () => {
      resolverCalls += 1;
      return fixture.event();
    },
  });
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  extension({ on: (event, handler) => handlers.set(event, handler) });
  // Do not call input handler, so receipt is missing
  const hookResult = await handlers.get("tool_call")?.({
    toolName: "subagent",
    toolCallId: "pi-missing-receipt",
    input: { agent: "deck-developer-apply-general" },
  }, {});
  expect(hookResult).toEqual({ block: true, reason: "invalid-evidence" });
  expect(resolverCalls).toBe(1);
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-35 Pi installed resolver with missing receipt yields invalid-evidence in static-compatible shadow", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  let bridgeCalls = 0;
  let resolverCalls = 0;
  const extension = createPiDeveloperTeamExecutionExtensionV1({
    authorizationService: fixture.authorizationService,
    bridge: {
      ...fixture.bridge,
      execute: async (event: unknown) => {
        bridgeCalls += 1;
        return fixture.bridge.execute(event);
      },
    },
    invocationAuthorization: "static-compatible",
    resolveExecutionEvent: async () => {
      resolverCalls += 1;
      return fixture.event({ mode: "shadow" });
    },
  });
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  extension({ on: (event, handler) => handlers.set(event, handler) });
  // Do not call input handler, so receipt is missing
  const hookResult = await handlers.get("tool_call")?.({
    toolName: "subagent",
    toolCallId: "pi-missing-receipt-shadow",
    input: { agent: "deck-developer-apply-general" },
  }, {});
  expect(hookResult).toEqual({ block: true, reason: "invalid-evidence" });
  expect(resolverCalls).toBe(1);
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-36 Pi absent resolver in invocation-required remains AUTHZ_MISSING", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  let bridgeCalls = 0;
  const extension = createPiDeveloperTeamExecutionExtensionV1({
    authorizationService: fixture.authorizationService,
    bridge: {
      ...fixture.bridge,
      execute: async (event: unknown) => {
        bridgeCalls += 1;
        return fixture.bridge.execute(event);
      },
    },
    invocationAuthorization: "invocation-required",
  });
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  extension({ on: (event, handler) => handlers.set(event, handler) });
  await handlers.get("input")?.({ text: "Apply." }, {});
  const hookResult = await handlers.get("tool_call")?.({
    toolName: "subagent",
    toolCallId: "pi-absent-resolver",
    input: { agent: "deck-developer-apply-general" },
  }, {});
  expect(hookResult).toEqual({ block: true, reason: "modification-not-authorized:AUTHZ_MISSING" });
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-37 Pi getter invocationAuthorization invalid-then-valid fails invalid-evidence with single mode read", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  let modeReads = 0;
  let resolverCalls = 0;
  let bridgeCalls = 0;
  const options: Record<string, unknown> = {
    authorizationService: fixture.authorizationService,
    bridge: {
      ...fixture.bridge,
      execute: async (event: unknown) => {
        bridgeCalls += 1;
        return fixture.bridge.execute(event);
      },
    },
    resolveExecutionEvent: async () => {
      resolverCalls += 1;
      return fixture.event();
    },
  };
  Object.defineProperty(options, "invocationAuthorization", {
    enumerable: true,
    configurable: true,
    get() {
      modeReads += 1;
      return modeReads === 1 ? "invalid-first" : "invocation-required";
    },
  });
  const extension = createPiDeveloperTeamExecutionExtensionV1(options as any);
  const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
  extension({ on: (event, handler) => handlers.set(event, handler) });
  await handlers.get("input")?.({ text: "Apply." }, {});
  const hookResult = await handlers.get("tool_call")?.({
    toolName: "subagent",
    toolCallId: "pi-getter-mode",
    input: { agent: "deck-developer-apply-general" },
  }, {});
  expect(hookResult).toEqual({ block: true, reason: "invalid-evidence" });
  expect(modeReads).toBe(1);
  expect(resolverCalls).toBe(0);
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-38 Pi Proxy provider invocationAuthorization invalid-then-valid fails invalid-evidence with single mode read", async () => {
  const fixture = createRunnerHostFixtureV1("pi", createPiDeveloperTeamExecutionBridgeV1);
  let modeReads = 0;
  let resolverCalls = 0;
  let bridgeCalls = 0;
  const provider = new Proxy(
    {} as Record<string, unknown>,
    {
      get(_target, prop) {
        if (prop === "invocationAuthorization") {
          modeReads += 1;
          return modeReads === 1 ? "invalid-first" : "invocation-required";
        }
        if (prop === "resolvePi") {
          return async () => {
            resolverCalls += 1;
            return fixture.event();
          };
        }
        return undefined;
      },
    },
  );
  (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL] = provider;
  try {
    const extension = createPiDeveloperTeamExecutionExtensionV1({
      authorizationService: fixture.authorizationService,
      bridge: {
        ...fixture.bridge,
        execute: async (event: unknown) => {
          bridgeCalls += 1;
          return fixture.bridge.execute(event);
        },
      },
    });
    const handlers = new Map<string, (event: any, context: any) => Promise<unknown>>();
    extension({ on: (event, handler) => handlers.set(event, handler) });
    await handlers.get("input")?.({ text: "Apply." }, {});
    const hookResult = await handlers.get("tool_call")?.({
      toolName: "subagent",
      toolCallId: "pi-proxy-provider-mode",
      input: { agent: "deck-developer-apply-general" },
    }, {});
    expect(hookResult).toEqual({ block: true, reason: "invalid-evidence" });
  } finally {
    delete (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL];
  }
  expect(modeReads).toBe(1);
  expect(resolverCalls).toBe(0);
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});
