import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  createRunnerHostFixtureV1,
  RUNNER_HOST_PROTECTED_RISK_POLICY,
} from "../../sdd-runtime/src/testing/developer-team-runner-host-fixture";
import { reviseExecutionDossierV1 } from "../../sdd-runtime/src/contracts/execution-dossier";
import {
  activeBlockingSetDigestV1,
  buildFindingDispositionEnvelopeV1,
  computeProtectedRiskPolicySnapshotDigestV1,
} from "../../sdd-runtime/src/contracts/finding-disposition";
import { buildRoutingDecisionV1 } from "../../sdd-runtime/src/contracts/routing-decision";
import { buildBlockingRepairProjectionV1 } from "../../sdd-runtime/src/contracts/blocking-repair-projection";
import { createExecutionConvergenceDossierV1 } from "../../sdd-runtime/src/contracts/execution-convergence";
import type { ExecutionDossierV1 } from "../../sdd-runtime/src/contracts/execution-dossier";
import type { DeterministicTargetedRepairAuthorityV1 } from "../../sdd-runtime/src/execution/execution-control-plane";
import { applyOpenCodeDeveloperTeamInstall, buildOpenCodeDeveloperTeamInstallPlan } from "./developer-team-install";
import { createOpenCodeDeveloperTeamExecutionBridgeV1 } from "./developer-team-execution-bridge";
import { createOpenCodeDeveloperTeamExecutionPluginV1 } from "../assets/opencode/plugins/developer-team-execution";

let pluginModuleInstance = 0;

function deterministicRepairAuthority(
  dossier: ExecutionDossierV1,
  effectCapabilityBinding = "targeted-repair-v1",
): DeterministicTargetedRepairAuthorityV1 {
  const batch = dossier.batch;
  const manifest = dossier.currentManifest!;
  const classification = {
    classificationPolicyVersion: RUNNER_HOST_PROTECTED_RISK_POLICY.classificationPolicyVersion,
    baselineFingerprints: [],
    deferPolicyRefs: {},
    advisoryCheckIds: [],
    mandatoryRequirementIds: ["REQ-AUTH-004"],
    mandatoryTaskIds: ["EG4-T2"],
    mandatoryCheckIds: ["bridge-low"],
  };
  const authorityFields = {
    batchDigest: batch.digest,
    manifestDigest: manifest.digest,
    classificationPolicyVersion: classification.classificationPolicyVersion,
    routingPolicyVersion: RUNNER_HOST_PROTECTED_RISK_POLICY.routingPolicyVersion,
    artifactDigests: batch.artifactDigests,
    mandatorySecurityRequirementIds: RUNNER_HOST_PROTECTED_RISK_POLICY.mandatorySecurityRequirementIds,
    mandatorySecurityTaskIds: RUNNER_HOST_PROTECTED_RISK_POLICY.mandatorySecurityTaskIds,
    mandatorySecurityCheckIds: RUNNER_HOST_PROTECTED_RISK_POLICY.mandatorySecurityCheckIds,
    mandatorySecurityOracleIds: RUNNER_HOST_PROTECTED_RISK_POLICY.mandatorySecurityOracleIds,
    mandatoryDataLossRequirementIds: RUNNER_HOST_PROTECTED_RISK_POLICY.mandatoryDataLossRequirementIds,
    mandatoryDataLossTaskIds: RUNNER_HOST_PROTECTED_RISK_POLICY.mandatoryDataLossTaskIds,
    mandatoryDataLossCheckIds: RUNNER_HOST_PROTECTED_RISK_POLICY.mandatoryDataLossCheckIds,
    mandatoryDataLossOracleIds: RUNNER_HOST_PROTECTED_RISK_POLICY.mandatoryDataLossOracleIds,
  };
  const protectedRiskAuthority = {
    ...authorityFields,
    policySnapshotDigest: computeProtectedRiskPolicySnapshotDigestV1(authorityFields),
  };
  const disposition = buildFindingDispositionEnvelopeV1({
    manifest,
    batch,
    classification,
    protectedRiskAuthority,
  });
  const routingPolicy = {
    routingPolicyVersion: RUNNER_HOST_PROTECTED_RISK_POLICY.routingPolicyVersion,
    authorityState: "authorized" as const,
    gitSafetyState: "not-required" as const,
    protectedRisk: false,
    dataLossRisk: false,
    excludedTargetIntersection: false,
    progress: "none" as const,
    diagnosableRuntime: true,
    fullyAnchored: true,
    scopeValid: true,
    policyPermitted: true,
  };
  const routing = buildRoutingDecisionV1({
    batch,
    manifest,
    disposition,
    policy: routingPolicy,
    protectedRiskAuthority,
  });
  const convergence = createExecutionConvergenceDossierV1({
    baseDossier: dossier,
    state: {
      lifecycle: "awaiting_apply_result",
      generation: 0,
      implementationSubjectDigest: manifest.digest,
      activeBlockingSetDigest: activeBlockingSetDigestV1(disposition, manifest),
    },
  });
  const retryLedger = {
    retryLedgerDigests: [],
    attemptRecords: [],
    currentConvergenceRevision: convergence.revision,
    currentConvergenceDigest: convergence.digest,
    currentDossier: convergence,
    dossierHistory: [],
    transitionReceipts: [],
    convergenceAuthorityRecords: { stageEvidence: [], invalidations: [], resultRecords: [] },
    projectionRecords: [],
  };
  const blockingId = disposition.entries.find((entry) => entry.disposition === "blocking")!.findingId;
  const projection = buildBlockingRepairProjectionV1({
    batch,
    manifest,
    disposition,
    routing,
    selectedFindingIds: [blockingId],
    convergenceDossierRevision: convergence.revision,
    convergenceDossierDigest: convergence.digest,
    authorizationRef: batch.authorizationGrantRef,
    effectCapabilityBinding,
    causalEvidenceRefs: manifest.findings[0]!.evidence,
    routingPolicyVersion: routingPolicy.routingPolicyVersion,
    retryLedger,
    protectedRiskAuthority,
  });
  return {
    schema: "deterministic-targeted-repair-authority-v1",
    manifest,
    classification,
    protectedRiskAuthority,
    disposition,
    routingPolicy,
    routing,
    projection,
    retryLedger,
    convergence: { current: convergence, history: [], receipts: [], records: retryLedger.convergenceAuthorityRecords },
    authorizationRef: batch.authorizationGrantRef,
    effectCapabilityBinding,
    excludedChangeTargets: ["openspec/changes/runner-capability-standardization"],
    target: "packages/sdd-runtime",
  };
}

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
  deterministic = false,
) {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  const revised = revisedDossier ? reviseExecutionDossierV1(fixture.dossier, {}) : undefined;
  const executionEvent = revised
    ? fixture.event({ mode: eventMode, dossier: { kind: "execution-dossier-v1", value: revised, history: [fixture.dossier] } }, revised)
    : fixture.event({
        mode: eventMode,
        ...(deterministic
          ? { deterministicRepairAuthority: deterministicRepairAuthority(fixture.dossier) }
          : {}),
      });
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
    const pluginContent = readFileSync(pluginPath, "utf8");
    expect(pluginContent).toContain('"tool.execute.before"');
    expect(pluginContent).toContain("deterministic-targeted-repair-authority-v1");
    expect(pluginContent).not.toContain(process.cwd());
    const orchestratorSkill = readFileSync(
      join(configDir, "skills", "deck-developer-orchestrator", "SKILL.md"),
      "utf8",
    );
    expect(orchestratorSkill).toContain("targeted -> affected_area -> Review -> broad");
    expect(orchestratorSkill).toContain("deckExecution");
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

test("D-REACH-15 packaged OpenCode plugin executes an authority-resolved deterministic repair", async () => {
  const outcome = await runOpenCodeHostFixture(false, "active", "invocation-required", true);
  expect(outcome.bridgeResult?.code).toBe("executed");
  expect(outcome.fixture.delegationCount()).toBe(1);
});

test("D-REACH-16 standalone packaged plugin uses its bundled deterministic runtime", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  const executionEvent = fixture.event({
    deterministicRepairAuthority: deterministicRepairAuthority(fixture.dossier),
  });
  const createPlugin = await loadOpenCodePluginFactory();
  const hooks = await createPlugin({
    invocationAuthorization: "invocation-required",
    resolveExecutionEvent: async () => executionEvent,
  })();
  await hooks["chat.message"](
    { sessionID: "standalone-session", messageID: "standalone-message" },
    { message: { role: "user" }, parts: [{ type: "text", text: "Apply the authorized batch." }] },
  );
  await expect(
    hooks["tool.execute.before"](
      { tool: "delegate", sessionID: "standalone-session", callID: "standalone-execution" },
      { args: { subagent_type: "deck-developer-apply-general" } },
    ),
  ).resolves.toBeUndefined();
});

test("D-REACH-17 standalone packaged plugin rejects tampered deterministic authority", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  const authority = deterministicRepairAuthority(fixture.dossier);
  const executionEvent = fixture.event({
    deterministicRepairAuthority: {
      ...authority,
      authorizationRef: fixture.dossier.digest,
    },
  });
  const createPlugin = await loadOpenCodePluginFactory();
  const hooks = await createPlugin({
    invocationAuthorization: "invocation-required",
    resolveExecutionEvent: async () => executionEvent,
  })();
  await hooks["chat.message"](
    { sessionID: "tampered-session", messageID: "tampered-message" },
    { message: { role: "user" }, parts: [{ type: "text", text: "Apply the authorized batch." }] },
  );
  await expect(
    hooks["tool.execute.before"](
      { tool: "delegate", sessionID: "tampered-session", callID: "tampered-execution" },
      { args: { subagent_type: "deck-developer-apply-general" } },
    ),
  ).rejects.toThrow("invalid-evidence");
});

test("D-REACH-18 OpenCode caller-only deckExecution with no provider fails closed in invocation-required", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  const args: Record<string, unknown> = {
    subagent_type: "deck-developer-apply-general",
    deckExecution: fixture.event({
      deterministicRepairAuthority: deterministicRepairAuthority(fixture.dossier),
    }),
  };
  let bridgeCalls = 0;
  const plugin = createOpenCodeDeveloperTeamExecutionPluginV1({
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
  const hooks = await plugin();
  await hooks["chat.message"](
    { sessionID: "caller-only-required", messageID: "caller-only-required-message" },
    { message: { role: "user" }, parts: [{ type: "text", text: "Apply the authorized batch." }] },
  );
  await expect(
    hooks["tool.execute.before"](
      { tool: "delegate", sessionID: "caller-only-required", callID: "caller-only-required-execution" },
      { args },
    ),
  ).rejects.toThrow("modification-not-authorized:AUTHZ_MISSING");
  expect(args.deckExecution).toBeUndefined();
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-19 OpenCode caller-only deckExecution with no provider preserves legacy in static-compatible", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  const args: Record<string, unknown> = {
    subagent_type: "deck-developer-apply-general",
    deckExecution: fixture.event({
      deterministicRepairAuthority: deterministicRepairAuthority(fixture.dossier),
    }),
  };
  let bridgeCalls = 0;
  const plugin = createOpenCodeDeveloperTeamExecutionPluginV1({
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
  const hooks = await plugin();
  await hooks["chat.message"](
    { sessionID: "caller-only-static", messageID: "caller-only-static-message" },
    { message: { role: "user" }, parts: [{ type: "text", text: "Apply the authorized batch." }] },
  );
  await expect(
    hooks["tool.execute.before"](
      { tool: "delegate", sessionID: "caller-only-static", callID: "caller-only-static-execution" },
      { args },
    ),
  ).resolves.toBeUndefined();
  expect(args.deckExecution).toBeUndefined();
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-20 OpenCode provider authority wins over conflicting caller deckExecution", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  const providerEvent = fixture.event();
  const args: Record<string, unknown> = {
    subagent_type: "deck-developer-apply-general",
    deckExecution: fixture.event({ mode: "legacy" }),
  };
  let bridgeCalls = 0;
  let seenEvent: unknown;
  const plugin = createOpenCodeDeveloperTeamExecutionPluginV1({
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
  const hooks = await plugin();
  await hooks["chat.message"](
    { sessionID: "conflict-session", messageID: "conflict-message" },
    { message: { role: "user" }, parts: [{ type: "text", text: "Apply the authorized batch." }] },
  );
  await hooks["tool.execute.before"](
    { tool: "delegate", sessionID: "conflict-session", callID: "conflict-execution" },
    { args },
  );
  expect(args.deckExecution).toBeUndefined();
  expect(bridgeCalls).toBe(1);
  expect((seenEvent as Record<string, unknown>)?.mode).toBe("active");
  expect(fixture.delegationCount()).toBe(1);
});

test("D-REACH-21 caller marker cannot activate a provider-supplied V1 event", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  let bridgeCalls = 0;
  const createPlugin = await loadOpenCodePluginFactory();
  const hooks = await createPlugin({
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
  })();
  await hooks["chat.message"](
    { sessionID: "marker-session", messageID: "marker-message" },
    { message: { role: "user" }, parts: [{ type: "text", text: "Observe only." }] },
  );
  await hooks["tool.execute.before"](
    { tool: "delegate", sessionID: "marker-session", callID: "marker-execution" },
    {
      args: {
        subagent_type: "deck-developer-apply-general",
        deckExecution: {
          deterministicRepairAuthority: {
            schema: "deterministic-targeted-repair-authority-v1",
          },
        },
      },
    },
  );
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
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

const HOST_CONTEXT_SYMBOL = Symbol.for("deck.developer-team.execution-context.v1");

test("D-REACH-22 OpenCode plugin captures resolver at init; late global installation has no effect", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  let bridgeCalls = 0;
  const bridge = {
    ...fixture.bridge,
    execute: async (event: unknown) => {
      bridgeCalls += 1;
      return fixture.bridge.execute(event);
    },
  };
  const plugin = createOpenCodeDeveloperTeamExecutionPluginV1({
    authorizationService: fixture.authorizationService,
    bridge,
    invocationAuthorization: "invocation-required",
  });
  const hooks = await plugin();
  const args: Record<string, unknown> = { subagent_type: "deck-developer-apply-general" };
  await expect(
    hooks["tool.execute.before"]({ tool: "delegate", sessionID: "late-global", callID: "late-global-1" }, { args }),
  ).rejects.toThrow("modification-not-authorized:AUTHZ_MISSING");
  (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL] = {
    resolveOpenCode: async () => fixture.event(),
  } as any;
  try {
    await expect(
      hooks["tool.execute.before"]({ tool: "delegate", sessionID: "late-global", callID: "late-global-2" }, { args }),
    ).rejects.toThrow("modification-not-authorized:AUTHZ_MISSING");
  } finally {
    delete (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL];
  }
  expect(bridgeCalls).toBe(0);
});

test("D-REACH-23 OpenCode plugin captures mode at init; post-init options mutation has no effect", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  const options: Record<string, unknown> = {
    authorizationService: fixture.authorizationService,
    bridge: fixture.bridge,
    invocationAuthorization: "static-compatible",
  };
  const plugin = createOpenCodeDeveloperTeamExecutionPluginV1(options as any);
  options.invocationAuthorization = "invocation-required";
  const hooks = await plugin();
  const args: Record<string, unknown> = { subagent_type: "deck-developer-apply-general" };
  let rejection: unknown;
  try {
    await hooks["tool.execute.before"]({ tool: "delegate", sessionID: "mutable-options", callID: "mutable-options-call" }, { args });
  } catch (error) {
    rejection = error;
  }
  expect(rejection).toBeUndefined();
  expect(args.deckExecution).toBeUndefined();
});

test("D-REACH-24 OpenCode installed resolver returning null yields invalid-evidence in invocation-required", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  let bridgeCalls = 0;
  let resolverCalls = 0;
  const bridge = {
    ...fixture.bridge,
    execute: async (event: unknown) => {
      bridgeCalls += 1;
      return fixture.bridge.execute(event);
    },
  };
  const plugin = createOpenCodeDeveloperTeamExecutionPluginV1({
    authorizationService: fixture.authorizationService,
    bridge,
    invocationAuthorization: "invocation-required",
    resolveExecutionEvent: async () => {
      resolverCalls += 1;
      return null;
    },
  });
  const hooks = await plugin();
  const args: Record<string, unknown> = { subagent_type: "deck-developer-apply-general" };
  await expect(
    hooks["tool.execute.before"]({ tool: "delegate", sessionID: "null-resolver", callID: "null-resolver-call" }, { args }),
  ).rejects.toThrow("invalid-evidence");
  expect(resolverCalls).toBe(1);
  expect(bridgeCalls).toBe(0);
});

test("D-REACH-25 OpenCode installed resolver returning non-object yields invalid-evidence in invocation-required", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  let bridgeCalls = 0;
  let resolverCalls = 0;
  const bridge = {
    ...fixture.bridge,
    execute: async (event: unknown) => {
      bridgeCalls += 1;
      return fixture.bridge.execute(event);
    },
  };
  const plugin = createOpenCodeDeveloperTeamExecutionPluginV1({
    authorizationService: fixture.authorizationService,
    bridge,
    invocationAuthorization: "invocation-required",
    resolveExecutionEvent: async () => {
      resolverCalls += 1;
      return "malformed";
    },
  });
  const hooks = await plugin();
  const args: Record<string, unknown> = { subagent_type: "deck-developer-apply-general" };
  await expect(
    hooks["tool.execute.before"]({ tool: "delegate", sessionID: "non-object-resolver", callID: "non-object-resolver-call" }, { args }),
  ).rejects.toThrow("invalid-evidence");
  expect(resolverCalls).toBe(1);
  expect(bridgeCalls).toBe(0);
});

test("D-REACH-26 OpenCode non-Apply role strips caller deckExecution, provider not called, zero bridge", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  let bridgeCalls = 0;
  let resolverCalls = 0;
  const bridge = {
    ...fixture.bridge,
    execute: async (event: unknown) => {
      bridgeCalls += 1;
      return fixture.bridge.execute(event);
    },
  };
  const plugin = createOpenCodeDeveloperTeamExecutionPluginV1({
    authorizationService: fixture.authorizationService,
    bridge,
    invocationAuthorization: "invocation-required",
    resolveExecutionEvent: async () => {
      resolverCalls += 1;
      return fixture.event();
    },
  });
  const hooks = await plugin();
  const args: Record<string, unknown> = { subagent_type: "verify-general", deckExecution: fixture.event() };
  let rejection: unknown;
  try {
    await hooks["tool.execute.before"]({ tool: "delegate", sessionID: "non-apply", callID: "non-apply-call" }, { args });
  } catch (error) {
    rejection = error;
  }
  expect(rejection).toBeUndefined();
  expect(args.deckExecution).toBeUndefined();
  expect(resolverCalls).toBe(0);
  expect(bridgeCalls).toBe(0);
});

test("D-REACH-27 OpenCode non-Apply role preserves zero bridge/effect even when caller provides deckExecution", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  let bridgeCalls = 0;
  let resolverCalls = 0;
  const bridge = {
    ...fixture.bridge,
    execute: async (event: unknown) => {
      bridgeCalls += 1;
      return fixture.bridge.execute(event);
    },
  };
  const plugin = createOpenCodeDeveloperTeamExecutionPluginV1({
    authorizationService: fixture.authorizationService,
    bridge,
    invocationAuthorization: "invocation-required",
    resolveExecutionEvent: async () => {
      resolverCalls += 1;
      return fixture.event();
    },
  });
  const hooks = await plugin();
  const args: Record<string, unknown> = { subagent_type: "review-general", deckExecution: fixture.event() };
  let rejection: unknown;
  try {
    await hooks["tool.execute.before"]({ tool: "delegate", sessionID: "non-apply-with-marker", callID: "non-apply-with-marker-call" }, { args });
  } catch (error) {
    rejection = error;
  }
  expect(rejection).toBeUndefined();
  expect(args.deckExecution).toBeUndefined();
  expect(resolverCalls).toBe(0);
  expect(bridgeCalls).toBe(0);
});

test("D-REACH-28 OpenCode invalid invocationAuthorization string yields invalid-evidence with zero resolver/bridge/effect", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  let resolverCalls = 0;
  let bridgeCalls = 0;
  const plugin = createOpenCodeDeveloperTeamExecutionPluginV1({
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
  const hooks = await plugin();
  await hooks["chat.message"](
    { sessionID: "invalid-mode", messageID: "invalid-mode-message" },
    { message: { role: "user" }, parts: [{ type: "text", text: "Apply." }] },
  );
  await expect(
    hooks["tool.execute.before"](
      { tool: "delegate", sessionID: "invalid-mode", callID: "invalid-mode-call" },
      { args: { subagent_type: "deck-developer-apply-general" } },
    ),
  ).rejects.toThrow("invalid-evidence");
  expect(resolverCalls).toBe(0);
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-29 OpenCode null invocationAuthorization yields invalid-evidence with zero resolver/bridge/effect", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  let resolverCalls = 0;
  let bridgeCalls = 0;
  const plugin = createOpenCodeDeveloperTeamExecutionPluginV1({
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
  const hooks = await plugin();
  await hooks["chat.message"](
    { sessionID: "null-mode", messageID: "null-mode-message" },
    { message: { role: "user" }, parts: [{ type: "text", text: "Apply." }] },
  );
  await expect(
    hooks["tool.execute.before"](
      { tool: "delegate", sessionID: "null-mode", callID: "null-mode-call" },
      { args: { subagent_type: "deck-developer-apply-general" } },
    ),
  ).rejects.toThrow("invalid-evidence");
  expect(resolverCalls).toBe(0);
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-30 OpenCode object invocationAuthorization yields invalid-evidence with zero resolver/bridge/effect", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  let resolverCalls = 0;
  let bridgeCalls = 0;
  const plugin = createOpenCodeDeveloperTeamExecutionPluginV1({
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
  const hooks = await plugin();
  await hooks["chat.message"](
    { sessionID: "object-mode", messageID: "object-mode-message" },
    { message: { role: "user" }, parts: [{ type: "text", text: "Apply." }] },
  );
  await expect(
    hooks["tool.execute.before"](
      { tool: "delegate", sessionID: "object-mode", callID: "object-mode-call" },
      { args: { subagent_type: "deck-developer-apply-general" } },
    ),
  ).rejects.toThrow("invalid-evidence");
  expect(resolverCalls).toBe(0);
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-31 OpenCode empty string invocationAuthorization yields invalid-evidence with zero resolver/bridge/effect", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  let resolverCalls = 0;
  let bridgeCalls = 0;
  const plugin = createOpenCodeDeveloperTeamExecutionPluginV1({
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
  const hooks = await plugin();
  await hooks["chat.message"](
    { sessionID: "empty-mode", messageID: "empty-mode-message" },
    { message: { role: "user" }, parts: [{ type: "text", text: "Apply." }] },
  );
  await expect(
    hooks["tool.execute.before"](
      { tool: "delegate", sessionID: "empty-mode", callID: "empty-mode-call" },
      { args: { subagent_type: "deck-developer-apply-general" } },
    ),
  ).rejects.toThrow("invalid-evidence");
  expect(resolverCalls).toBe(0);
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-32 OpenCode post-init mutation of invalid invocationAuthorization does not bypass", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  const options: any = {
    authorizationService: fixture.authorizationService,
    bridge: fixture.bridge,
    invocationAuthorization: "invalid-mode",
  };
  const plugin = createOpenCodeDeveloperTeamExecutionPluginV1(options);
  options.invocationAuthorization = "invocation-required";
  const hooks = await plugin();
  await hooks["chat.message"](
    { sessionID: "post-mutate", messageID: "post-mutate-message" },
    { message: { role: "user" }, parts: [{ type: "text", text: "Apply." }] },
  );
  await expect(
    hooks["tool.execute.before"](
      { tool: "delegate", sessionID: "post-mutate", callID: "post-mutate-call" },
      { args: { subagent_type: "deck-developer-apply-general" } },
    ),
  ).rejects.toThrow("invalid-evidence");
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-33 OpenCode late global provider does not bypass invalid invocationAuthorization", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  let bridgeCalls = 0;
  const plugin = createOpenCodeDeveloperTeamExecutionPluginV1({
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
  const hooks = await plugin();
  (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL] = {
    resolveOpenCode: async () => fixture.event(),
  } as any;
  try {
    await hooks["chat.message"](
      { sessionID: "late-global-invalid", messageID: "late-global-invalid-message" },
      { message: { role: "user" }, parts: [{ type: "text", text: "Apply." }] },
    );
    await expect(
      hooks["tool.execute.before"](
        { tool: "delegate", sessionID: "late-global-invalid", callID: "late-global-invalid-call" },
        { args: { subagent_type: "deck-developer-apply-general" } },
      ),
    ).rejects.toThrow("invalid-evidence");
  } finally {
    delete (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL];
  }
  expect(bridgeCalls).toBe(0);
});

test("D-REACH-34 OpenCode installed resolver with missing receipt yields invalid-evidence in invocation-required", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  let bridgeCalls = 0;
  let resolverCalls = 0;
  const plugin = createOpenCodeDeveloperTeamExecutionPluginV1({
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
  const hooks = await plugin();
  await expect(
    hooks["tool.execute.before"](
      { tool: "delegate", sessionID: "missing-receipt", callID: "missing-receipt-call" },
      { args: { subagent_type: "deck-developer-apply-general" } },
    ),
  ).rejects.toThrow("invalid-evidence");
  expect(resolverCalls).toBe(1);
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-35 OpenCode installed resolver with missing receipt yields invalid-evidence in static-compatible shadow", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  let bridgeCalls = 0;
  let resolverCalls = 0;
  const plugin = createOpenCodeDeveloperTeamExecutionPluginV1({
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
  const hooks = await plugin();
  await expect(
    hooks["tool.execute.before"](
      { tool: "delegate", sessionID: "missing-receipt-shadow", callID: "missing-receipt-shadow-call" },
      { args: { subagent_type: "deck-developer-apply-general" } },
    ),
  ).rejects.toThrow("invalid-evidence");
  expect(resolverCalls).toBe(1);
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-36 OpenCode absent resolver in invocation-required remains AUTHZ_MISSING", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  let bridgeCalls = 0;
  const plugin = createOpenCodeDeveloperTeamExecutionPluginV1({
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
  const hooks = await plugin();
  await hooks["chat.message"](
    { sessionID: "absent-resolver", messageID: "absent-resolver-message" },
    { message: { role: "user" }, parts: [{ type: "text", text: "Apply." }] },
  );
  await expect(
    hooks["tool.execute.before"](
      { tool: "delegate", sessionID: "absent-resolver", callID: "absent-resolver-call" },
      { args: { subagent_type: "deck-developer-apply-general" } },
    ),
  ).rejects.toThrow("modification-not-authorized:AUTHZ_MISSING");
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-37 OpenCode getter invocationAuthorization invalid-then-valid fails invalid-evidence with single mode read", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
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
  const plugin = createOpenCodeDeveloperTeamExecutionPluginV1(options as any);
  const hooks = await plugin();
  await hooks["chat.message"](
    { sessionID: "getter-mode", messageID: "getter-mode-message" },
    { message: { role: "user" }, parts: [{ type: "text", text: "Apply." }] },
  );
  await expect(
    hooks["tool.execute.before"](
      { tool: "delegate", sessionID: "getter-mode", callID: "getter-mode-call" },
      { args: { subagent_type: "deck-developer-apply-general" } },
    ),
  ).rejects.toThrow("invalid-evidence");
  expect(modeReads).toBe(1);
  expect(resolverCalls).toBe(0);
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});

test("D-REACH-38 OpenCode Proxy provider invocationAuthorization invalid-then-valid fails invalid-evidence with single mode read", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
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
        if (prop === "resolveOpenCode") {
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
    const plugin = createOpenCodeDeveloperTeamExecutionPluginV1({
      authorizationService: fixture.authorizationService,
      bridge: {
        ...fixture.bridge,
        execute: async (event: unknown) => {
          bridgeCalls += 1;
          return fixture.bridge.execute(event);
        },
      },
    });
    const hooks = await plugin();
    await hooks["chat.message"](
      { sessionID: "proxy-provider-mode", messageID: "proxy-provider-mode-message" },
      { message: { role: "user" }, parts: [{ type: "text", text: "Apply." }] },
    );
    await expect(
      hooks["tool.execute.before"](
        { tool: "delegate", sessionID: "proxy-provider-mode", callID: "proxy-provider-mode-call" },
        { args: { subagent_type: "deck-developer-apply-general" } },
      ),
    ).rejects.toThrow("invalid-evidence");
  } finally {
    delete (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL];
  }
  expect(modeReads).toBe(1);
  expect(resolverCalls).toBe(0);
  expect(bridgeCalls).toBe(0);
  expect(fixture.delegationCount()).toBe(0);
});
