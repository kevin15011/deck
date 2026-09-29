import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
import type { QaRunnerHostAuthorityV1 } from "../../sdd-runtime/src/execution/qa-runner-host-authority";
import { applyOpenCodeDeveloperTeamInstall, buildOpenCodeDeveloperTeamInstallPlan } from "./developer-team-install";
import { createOpenCodeDeveloperTeamExecutionBridgeV1 } from "./developer-team-execution-bridge";
import createOpenCodeDeveloperTeamExecutionPluginDefault, { createOpenCodeDeveloperTeamExecutionPluginV1 } from "../assets/opencode/plugins/developer-team-execution";

import { createHash } from "node:crypto";
import {
  buildSessionPreparationDelegationDigestV1,
  createSessionPreparationAuthorizationServiceV1,
  type SessionPreparationAuthorizationExpectationV1,
} from "../../sdd-runtime/src/execution/session-preparation";

function openCodePreparationAuthority(
  sessionId: string,
  invocationId: string,
  activeRunnerId = "opencode",
) {
  const service = createSessionPreparationAuthorizationServiceV1();
  const projectRootDigest = `sha256:${createHash("sha256").update("/project", "utf8").digest("hex")}` as `sha256:${string}`;
  const sessionIdDigest = `sha256:${createHash("sha256").update(JSON.stringify(sessionId), "utf8").digest("hex")}` as `sha256:${string}`;
  const allowedOperations = [{ component: "skill_registry", action: "refresh", target: ".atl/skill-registry.md" }] as const;
  const needs = ["skill_registry"] as const;
  const blockedTargets = ["openspec/changes/runner-capability-standardization"] as const;
  const delegationDigest = buildSessionPreparationDelegationDigestV1({
    sessionIdDigest,
    invocationId,
    agentId: "deck-setup",
    activeRunnerId,
    projectRootDigest,
    needs,
    allowedOperations,
    blockedTargets,
  });
  const issue = {
    sessionId,
    invocationId,
    agentId: "deck-setup",
    activeRunnerId,
    projectRootDigest,
    delegationDigest,
    needs,
    allowedOperations,
    blockedTargets,
  } as const;
  const expectation = {
    ...issue,
    component: "skill_registry",
    action: "refresh",
    target: ".atl/skill-registry.md",
  } satisfies SessionPreparationAuthorizationExpectationV1;
  return {
    service,
    expectation,
    authorization: service.issue(issue),
  };
}
let pluginModuleInstance = 0;
const verifiedCanonicalBun = "/var/folders/tn/z_26gcr948v50zmhpkp4pr2w0000gn/T/opencode/bun-1.3.12/node_modules/@oven/bun-darwin-aarch64/bin/bun";

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
  return (await loadInstalledOpenCodePluginModule()).createOpenCodeDeveloperTeamExecutionPluginV1;
}

async function loadInstalledOpenCodePluginModule() {
  const configDir = mkdtempSync(join(tmpdir(), "deck-opencode-plugin-module-"));
  const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/deck-project", { configDir });
  applyOpenCodeDeveloperTeamInstall(plan, { configDir });
  const pluginPath = plan.executionPlugin!.absolutePath;
  try {
    const module = await import(`${pathToFileURL(pluginPath).href}?instance=${++pluginModuleInstance}`) as {
      createOpenCodeDeveloperTeamExecutionPluginV1: (options?: Record<string, unknown>) => () => Promise<Record<string, any>>;
    };
    return module as typeof module & { default: (input?: Record<string, unknown>) => Promise<Record<string, any>> };
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
  const args: Record<string, unknown> = { subagent_type: "deck-apply-fast" };
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
    expect(pluginContent).not.toContain("deck_project_memory_recall");
    expect(pluginContent).not.toContain("DECK_RUNNER_MEMORY_");
    expect(pluginContent).toContain("deterministic-targeted-repair-authority-v1");
    const sourceContent = readFileSync(join(process.cwd(), "packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.ts"), "utf8");
    expect(pluginContent).toContain(`source-sha256:${createHash("sha256").update(sourceContent).digest("hex")}`);
    const generatedContent = readFileSync(join(process.cwd(), "packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.generated.js"), "utf8");
    expect(pluginContent).toBe(generatedContent);
    expect(pluginContent).not.toContain(process.cwd());
    expect(pluginContent).not.toContain("supermemory_search_memory");
    expect(pluginContent).not.toContain("supermemory_add_memory");
    expect(pluginContent).not.toContain("x-sm-project");
    const orchestratorSkill = readFileSync(
      join(configDir, "skills", "deck-lead", "SKILL.md"),
      "utf8",
    );
    expect(orchestratorSkill).toContain("Quality is not a universal gate");
    expect(orchestratorSkill).toContain("implement a clear, reversible, low-risk change directly");
    expect(result.fileResults.find((entry) => entry.kind === "plugin")).toEqual({ agentId: "developer-team-execution", kind: "plugin", status: "created", absolutePath: pluginPath });
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});

test("managed installed default plugin denies both Apply roles without trusted host authority", async () => {
  const key = "OPENCODE_DECK_INVOCATION_AUTHORIZATION";
  const previous = process.env[key];
  process.env[key] = "invocation-required";
  delete (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL];
  try {
    const module = await loadInstalledOpenCodePluginModule();
    const hooks = await module.default({ directory: process.cwd(), worktree: process.cwd(), client: {} });
    for (const role of ["deck-apply-fast", "deck-apply-deep"]) {
      await expect(hooks["tool.execute.before"](
        { tool: "delegate", sessionID: `managed-denied-${role}`, callID: `call-${role}` },
        { args: { subagent_type: role } },
      )).rejects.toThrow("modification-not-authorized:AUTHZ_MISSING");
    }
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test("managed installed default plugin authorizes both Apply roles only through the trusted host provider", async () => {
  const key = "OPENCODE_DECK_INVOCATION_AUTHORIZATION";
  const previous = process.env[key];
  process.env[key] = "invocation-required";
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  let authorityReads = 0;
  (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL] = {
    invocationAuthorization: "static-compatible",
    resolveOpenCode: async () => new Proxy(fixture.event() as unknown as Record<string, unknown>, {
      get(target, property, receiver) {
        if (property === "dossier") authorityReads += 1;
        return Reflect.get(target, property, receiver);
      },
    }),
  };
  try {
    const module = await loadInstalledOpenCodePluginModule();
    const hooks = await module.default({ directory: process.cwd(), worktree: process.cwd(), client: {} });
    for (const role of ["deck-apply-fast", "deck-apply-deep"]) {
      const sessionID = `managed-authorized-${role}`;
      await hooks["chat.message"](
        { sessionID, messageID: `message-${role}` },
        { message: { role: "user" }, parts: [{ type: "text", text: "Apply the authorized batch." }] },
      );
      await expect(hooks["tool.execute.before"](
        { tool: "delegate", sessionID, callID: `call-${role}` },
        { args: { subagent_type: role } },
      )).resolves.toBeUndefined();
    }
    expect(authorityReads).toBeGreaterThanOrEqual(2);
  } finally {
    delete (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test("D-REACH-04b OpenCode canonical source builds to exactly one outfile bundle", () => {
  const bunPath = process.env.DECK_CANONICAL_BUN_1_3_12 ?? verifiedCanonicalBun;
  if (!existsSync(bunPath)) {
    console.warn(`Skipping canonical Bun build regression because ${bunPath} is unavailable.`);
    return;
  }
  const outputDir = mkdtempSync(join(tmpdir(), "deck-opencode-canonical-build-"));
  try {
    const input = join(process.cwd(), "packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.ts");
    const output = join(outputDir, "developer-team-execution.generated.js");
    const build = Bun.spawnSync({
      cmd: [bunPath, "build", input, "--target=bun", "--format=esm", "--minify", `--outfile=${output}`],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(new TextDecoder().decode(build.stderr).trim()).toBe("");
    expect(build.success).toBe(true);
    expect(readdirSync(outputDir).sort()).toEqual(["developer-team-execution.generated.js"]);
    expect(readFileSync(output, "utf8")).toContain('"tool.execute.before"');
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
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
      { args: { subagent_type: "deck-apply-fast" } },
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
      { args: { subagent_type: "deck-apply-fast" } },
    ),
  ).rejects.toThrow("invalid-evidence");
});

test("D-REACH-18 OpenCode caller-only deckExecution with no provider fails closed in invocation-required", async () => {
  const fixture = createRunnerHostFixtureV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1);
  const args: Record<string, unknown> = {
    subagent_type: "deck-apply-fast",
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
    subagent_type: "deck-apply-fast",
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
    subagent_type: "deck-apply-fast",
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
        subagent_type: "deck-apply-fast",
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
  const args = { subagent_type: "deck-apply-fast", deckExecution: fixture.event() };
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
    await hooks["tool.execute.before"]({ tool: "delegate", sessionID: "session-provider-error", callID: "provider-error" }, { args: { subagent_type: "deck-apply-fast" } });
  } catch (error) {
    rejection = error;
  }
  expect(rejection).toBeUndefined();
  expect(String(rejection)).not.toContain("SECRET_PROVIDER_SENTINEL");
});

function openCodeMessageUpdatedEvent(sessionID: string, id: string, fields: Record<string, unknown>) {
  return { event: { type: "message.updated", properties: { info: { id, sessionID, role: "assistant", ...fields } } } };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

test("OpenCode execution hooks ignore legacy Deck memory loopback configuration", async () => {
  const posts: unknown[] = [];
  const hooks = await createOpenCodeDeveloperTeamExecutionPluginV1({
    memoryLoopback: {
      endpoint: "http://127.0.0.1:1/deck-runner-memory/v1",
      token: "legacy-token",
      post: async (...args: unknown[]) => { posts.push(args); return { ok: true }; },
    },
  } as never)();
  expect(hooks.tool?.deck_project_memory_recall).toBeUndefined();
  await hooks["chat.message"]({ sessionID: "session", messageID: "message" }, { message: { role: "user" }, parts: [{ text: "remember this" }] });
  const output = { system: [] as string[] };
  await hooks["experimental.chat.system.transform"]({ sessionID: "session" }, output);
  expect(output.system).toEqual([]);
  expect(posts).toEqual([]);
});

test("OpenCode invocation-required hook blocks when the trusted provider is absent", async () => {
  const createPlugin = await loadOpenCodePluginFactory();
  const hooks = await createPlugin({ invocationAuthorization: "invocation-required" })();
  await hooks["chat.message"]({ sessionID: "session-required", messageID: "message-required" }, { message: { role: "user" }, parts: [] });
  await expect(hooks["tool.execute.before"](
    { tool: "delegate", sessionID: "session-required", callID: "required-missing-provider" },
    { args: { subagent_type: "deck-apply-fast" } },
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
    { args: { subagent_type: "deck-apply-fast" } },
  )).rejects.toThrow("invalid-evidence");
});

const HOST_CONTEXT_SYMBOL = Symbol.for("deck.developer-team.execution-context.v1");

test("D-REACH-SKILL-01 canonical plugin source uses trusted tool context to correlate a prepared native skill", async () => {
  const calls: string[] = [];
  let outcome: { outcome: "unobserved" | "loaded" } = { outcome: "unobserved" };
  const binding = { schema: "task-skill-discovery-binding-v1" as const, binding_id: "binding" };
  const host = {
    schema: "task-skill-discovery-host-v1" as const,
    open: async () => binding,
    search: async () => ({ schema: "skill-candidate-search-result-v1" as const, source_mode: "registry" as const, completeness: "complete" as const, candidates: [{ observation_id: "sha256:one", name: "helper", source_category: "user_runner" as const, scope: "user" as const, task_signals: [], technology_signals: [], path_signals: [] }], truncated: false, diagnostics: [] }),
    prepare: async () => ({ selection: { outcome: "selected" as const, reference: { schema: "skill-selection-reference-v1" as const, selection_id: "sha256:one", session_id: "native", task_id: "lead", active_runner_id: "opencode", observation_id: "sha256:one" } }, preparation: { outcome: "loadable" as const, expected_name: "helper" } }),
    beforeNativeLoad: async (_binding: unknown, input: { call_id: string }) => { calls.push(`before:${input.call_id}`); return { outcome: "armed" as const }; },
    observeNativeLoad: async (_binding: unknown, input: { call_id: string; directory?: string }) => { calls.push(`after:${input.call_id}:${input.directory}`); outcome = { outcome: "loaded" }; return outcome; },
    getOutcome: () => outcome, retire: () => {}, dispose: () => {},
  };
  const hooks = await createOpenCodeDeveloperTeamExecutionPluginV1({ skillDiscoveryHost: host } as any)();
  const tool = hooks.tool?.deck_skill_discovery;
  expect(tool).toBeDefined();
  if (!tool) throw new Error("missing skill discovery tool");
  await tool.execute({ operation: "search", terms: ["helper"] }, { sessionID: "native", messageID: "lead" });
  await tool.execute({ operation: "prepare", observation_id: "sha256:one" }, { sessionID: "native", messageID: "lead" });
  await hooks["tool.execute.before"]({ tool: "skill", sessionID: "native", callID: "skill-1" }, { args: { name: "helper" } });
  await hooks["tool.execute.after"]({ tool: "skill", sessionID: "native", callID: "skill-1" }, { metadata: { name: "helper", dir: "safe-dir" } });
  expect(calls).toEqual(["before:skill-1", "after:skill-1:safe-dir"]);
  expect(JSON.parse(await tool.execute({ operation: "status" }, { sessionID: "native", messageID: "lead" }))).toEqual({ outcome: "loaded" });
});

test("D-REACH-SKILL-02 canonical plugin source leaves unprepared native skill calls uncredited", async () => {
  const calls: string[] = [];
  const binding = { schema: "task-skill-discovery-binding-v1" as const, binding_id: "binding" };
  const host = {
    schema: "task-skill-discovery-host-v1" as const,
    open: async () => binding,
    search: async () => ({ schema: "skill-candidate-search-result-v1" as const, source_mode: "registry" as const, completeness: "complete" as const, candidates: [], truncated: false, diagnostics: [] }),
    prepare: async () => ({ selection: { outcome: "missing" as const }, preparation: { outcome: "missing" as const } }),
    beforeNativeLoad: async () => { calls.push("before"); return { outcome: "unprepared" as const }; },
    observeNativeLoad: async () => { calls.push("after"); return { outcome: "loaded" as const }; },
    getOutcome: () => ({ outcome: "unobserved" as const }), retire: () => {}, dispose: () => {},
  };
  const hooks = await createOpenCodeDeveloperTeamExecutionPluginV1({ skillDiscoveryHost: host } as any)();
  const tool = hooks.tool?.deck_skill_discovery;
  if (!tool) throw new Error("missing skill discovery tool");
  await tool.execute({ operation: "search", terms: ["missing"] }, { sessionID: "native", messageID: "lead" });
  await hooks["tool.execute.before"]({ tool: "skill", sessionID: "native", callID: "skill-1" }, { args: { name: "ordinary" } });
  await hooks["tool.execute.after"]({ tool: "skill", sessionID: "native", callID: "skill-1" }, { metadata: { name: "ordinary", dir: "safe-dir" } });
  expect(calls).toEqual([]);
});

test("D-REACH-SKILL-03 canonical plugin constructs the real SDD host from trusted native boundaries", async () => {
  const hooks = await createOpenCodeDeveloperTeamExecutionPluginV1({
    skillDiscovery: {
      projectRoot: process.cwd(),
      registryStatus: "ready",
      readRegistry: async () => [{
        name: "helper",
        source_category: "runner_exposed",
        scope: "runner",
        locator: "runner:opencode:inventory/helper",
        observation_id: "sha256:helper",
        runner_id: "opencode",
        task_signals: ["lead"],
        technology_signals: [],
        path_signals: [],
      }],
      discoverDirectly: async () => ({ outcome: "complete", observations: [], diagnostics: [] }),
      provider: {
        schema: "skill-discovery-source-provider-v1",
        runnerId: "opencode",
        listSources: async () => ({ outcome: "complete", sources: [], diagnostics: [] }),
        resolveLocator: async () => ({ status: "available", loadReference: JSON.stringify({ name: "helper", dir: "safe-dir" }) }),
      },
    },
  } as any)();
  const tool = hooks.tool?.deck_skill_discovery;
  expect(tool).toBeDefined();
  if (!tool) throw new Error("missing skill discovery tool");
  const searched = JSON.parse(await tool.execute({ operation: "search", terms: ["lead"] }, { sessionID: "native", messageID: "lead-message" }));
  expect(searched.candidates[0].name).toBe("helper");
  expect(JSON.parse(await tool.execute({ operation: "prepare", observation_id: "sha256:helper" }, { sessionID: "native", messageID: "lead-message" })).preparation).toEqual({ outcome: "loadable" });
  await hooks["tool.execute.before"]({ tool: "skill", sessionID: "native", callID: "skill-1" }, { args: { name: "helper" } });
  await hooks["tool.execute.after"]({ tool: "skill", sessionID: "native", callID: "skill-1" }, { metadata: { name: "helper", dir: "safe-dir" } });
  expect(JSON.parse(await tool.execute({ operation: "status" }, { sessionID: "native", messageID: "lead-message" }))).toEqual({ outcome: "loaded" });
});

test("D-REACH-SKILL-04 canonical plugin rejects invalid discovery input and prepared rejected calls", async () => {
  let searches = 0;
  const binding = { schema: "task-skill-discovery-binding-v1" as const, binding_id: "binding" };
  const host = {
    schema: "task-skill-discovery-host-v1" as const,
    open: async () => binding,
    search: async () => { searches += 1; return { schema: "skill-candidate-search-result-v1" as const, source_mode: "registry" as const, completeness: "complete" as const, candidates: [{ observation_id: "sha256:one", name: "helper", source_category: "user_runner" as const, scope: "user" as const, task_signals: [], technology_signals: [], path_signals: [] }], truncated: false, diagnostics: [] }; },
    prepare: async () => ({ selection: { outcome: "selected" as const, reference: { schema: "skill-selection-reference-v1" as const, selection_id: "sha256:one", session_id: "native", task_id: "lead", active_runner_id: "opencode", observation_id: "sha256:one" } }, preparation: { outcome: "loadable" as const } }),
    beforeNativeLoad: async () => ({ outcome: "rejected" as const }),
    observeNativeLoad: async () => ({ outcome: "unobserved" as const }),
    getOutcome: () => ({ outcome: "unobserved" as const }), retire: () => {}, dispose: () => {},
  };
  const hooks = await createOpenCodeDeveloperTeamExecutionPluginV1({ skillDiscoveryHost: host } as any)();
  const tool = hooks.tool?.deck_skill_discovery;
  if (!tool) throw new Error("missing skill discovery tool");
  expect(JSON.parse(await tool.execute({ operation: "search", terms: ["valid", 3] }, { sessionID: "native", messageID: "lead" }))).toEqual({ outcome: "invalid-request" });
  expect(searches).toBe(0);
  await tool.execute({ operation: "search", terms: ["valid"] }, { sessionID: "native", messageID: "lead" });
  await tool.execute({ operation: "prepare", observation_id: "sha256:one" }, { sessionID: "native", messageID: "lead" });
  await expect(hooks["tool.execute.before"]({ tool: "skill", sessionID: "native", callID: "skill-1" }, { args: { name: "helper" } })).rejects.toThrow("invalid-evidence");
});

test("D-REACH-SKILL-05 canonical plugin records correlated native skill errors as failed", async () => {
  let outcome: { outcome: "unobserved" | "failed" } = { outcome: "unobserved" };
  const binding = { schema: "task-skill-discovery-binding-v1" as const, binding_id: "binding" };
  const host = {
    schema: "task-skill-discovery-host-v1" as const,
    open: async () => binding,
    search: async () => ({ schema: "skill-candidate-search-result-v1" as const, source_mode: "registry" as const, completeness: "complete" as const, candidates: [{ observation_id: "sha256:one", name: "helper", source_category: "user_runner" as const, scope: "user" as const, task_signals: [], technology_signals: [], path_signals: [] }], truncated: false, diagnostics: [] }),
    prepare: async () => ({ selection: { outcome: "selected" as const, reference: { schema: "skill-selection-reference-v1" as const, selection_id: "sha256:one", session_id: "native", task_id: "lead", active_runner_id: "opencode", observation_id: "sha256:one" } }, preparation: { outcome: "loadable" as const, expected_name: "helper" } }),
    beforeNativeLoad: async () => ({ outcome: "armed" as const }),
    observeNativeLoad: async (_binding: unknown, input: { failed?: boolean }) => { if (input.failed) outcome = { outcome: "failed" }; return outcome; },
    getOutcome: () => outcome, retire: () => {}, dispose: () => {},
  };
  const hooks = await createOpenCodeDeveloperTeamExecutionPluginV1({ skillDiscoveryHost: host } as any)();
  const tool = hooks.tool?.deck_skill_discovery;
  if (!tool) throw new Error("missing skill discovery tool");
  await tool.execute({ operation: "search", terms: ["valid"] }, { sessionID: "native", messageID: "lead" });
  await tool.execute({ operation: "prepare", observation_id: "sha256:one" }, { sessionID: "native", messageID: "lead" });
  await hooks["tool.execute.before"]({ tool: "skill", sessionID: "native", callID: "skill-1" }, { args: { name: "helper" } });
  await hooks.event({ event: { type: "tool.execute.error", sessionID: "native", callID: "skill-1", tool: "skill", args: { name: "helper" } } as any });
  expect(JSON.parse(await tool.execute({ operation: "status" }, { sessionID: "native", messageID: "lead" }))).toEqual({ outcome: "failed" });
});

test("D-REACH-SKILL-06 canonical plugin keeps one active workflow generation per native session", async () => {
  const hooks = await createOpenCodeDeveloperTeamExecutionPluginDefault({ directory: process.cwd(), worktree: process.cwd(), client: { request: async () => [{ name: "helper", dir: "/tmp/helper", taskSignals: ["native-only"] }] } } as any);
  const tool = hooks.tool?.deck_skill_discovery;
  if (!tool) throw new Error("missing skill discovery tool");
  const parentSearch = JSON.parse(await tool.execute({ operation: "search", terms: ["native-only"] }, { sessionID: "parent", messageID: "m1" }));
  const prepared = JSON.parse(await tool.execute({ operation: "prepare", observation_id: parentSearch.candidates[0].observation_id }, { sessionID: "parent", messageID: "m2" }));
  expect(prepared.preparation).toEqual({ outcome: "loadable" });
  expect(prepared.preparation.expected_name).toBeUndefined();
  expect(prepared.preparation.expected_directory).toBeUndefined();
  await tool.execute({ operation: "search", terms: ["native-only"] }, { sessionID: "child", messageID: "child-m1" });
  expect(JSON.parse(await tool.execute({ operation: "status" }, { sessionID: "parent", messageID: "m3" }))).toEqual({ outcome: "unobserved" });
  await hooks["tool.execute.before"]({ tool: "skill", sessionID: "parent", callID: "call-1" }, { args: { name: "helper" } });
  await hooks["tool.execute.after"]({ tool: "skill", sessionID: "parent", callID: "call-1" }, { metadata: { name: "helper", dir: "/tmp/helper" } });
  expect(JSON.parse(await tool.execute({ operation: "status" }, { sessionID: "parent", messageID: "m4" }))).toEqual({ outcome: "loaded" });
  expect(JSON.parse(await tool.execute({ operation: "status" }, { sessionID: "child", messageID: "child-m2" }))).toEqual({ outcome: "unobserved" });
});

test("D-REACH-SKILL-07 canonical plugin invalidates old generation after a new search", async () => {
  const hooks = await createOpenCodeDeveloperTeamExecutionPluginDefault({ directory: process.cwd(), worktree: process.cwd(), client: { request: async () => [{ name: "helper", dir: "/tmp/helper", taskSignals: ["native-only"] }] } } as any);
  const tool = hooks.tool?.deck_skill_discovery;
  if (!tool) throw new Error("missing skill discovery tool");
  const firstSearch = JSON.parse(await tool.execute({ operation: "search", terms: ["native-only"] }, { sessionID: "native", messageID: "m1" }));
  await tool.execute({ operation: "prepare", observation_id: firstSearch.candidates[0].observation_id }, { sessionID: "native", messageID: "m2" });
  await tool.execute({ operation: "search", terms: ["native-only"] }, { sessionID: "native", messageID: "m3" });
  await hooks["tool.execute.before"]({ tool: "skill", sessionID: "native", callID: "call-1" }, { args: { name: "helper" } });
  await hooks["tool.execute.after"]({ tool: "skill", sessionID: "native", callID: "call-1" }, { metadata: { name: "helper", dir: "/tmp/helper" } });
  expect(JSON.parse(await tool.execute({ operation: "status" }, { sessionID: "native", messageID: "m4" }))).toEqual({ outcome: "unobserved" });
});

test("D-REACH-SKILL-08 default export constructs real discovery host from raw native plugin input", async () => {
  const calls: unknown[] = [];
  const hooks = await createOpenCodeDeveloperTeamExecutionPluginDefault({
    directory: process.cwd(),
    worktree: process.cwd(),
    client: {
      request: async (input: unknown) => {
        calls.push(input);
        return [{ name: "helper", dir: "/native/helper", path: "/native/helper/SKILL.md", content: "discard me", taskSignals: ["native-only"] }];
      },
    },
  } as any);
  const tool = hooks.tool?.deck_skill_discovery;
  expect(tool).toBeDefined();
  if (!tool) throw new Error("missing skill discovery tool");
  const searched = JSON.parse(await tool.execute({ operation: "search", terms: ["native-only"] }, { sessionID: "native", messageID: "m1" }));
  expect(searched.candidates[0]).toMatchObject({ name: "helper", source_category: "runner_exposed" });
  expect(calls.length).toBeGreaterThan(0);
  expect(JSON.parse(await tool.execute({ operation: "prepare", observation_id: searched.candidates[0].observation_id }, { sessionID: "native", messageID: "m2" })).preparation).toEqual({ outcome: "loadable" });
  await hooks["tool.execute.before"]({ tool: "skill", sessionID: "native", callID: "skill-1" }, { args: { name: "helper" } });
  await hooks["tool.execute.after"]({ tool: "skill", sessionID: "native", callID: "skill-1" }, { metadata: { name: "helper", dir: "/native/helper" } });
  expect(JSON.parse(await tool.execute({ operation: "status" }, { sessionID: "native", messageID: "m3" }))).toEqual({ outcome: "loaded" });
});

test("D-REACH-SKILL-08B default export reads OpenCode SDK skill envelope without content and correlates SKILL.md locations", async () => {
  let contentRead = false;
  const calls: unknown[] = [];
  const projectLocation = "/native/project-helper/SKILL.md";
  const userLocation = "/native/user-helper/SKILL.md";
  const rows = [
    { name: "project-helper", description: "Project skill", location: projectLocation, get content() { contentRead = true; throw new Error("content read"); } },
    { name: "user-helper", description: "User skill", location: userLocation, get content() { contentRead = true; throw new Error("content read"); } },
  ];
  const hooks = await createOpenCodeDeveloperTeamExecutionPluginDefault({
    directory: process.cwd(),
    worktree: process.cwd(),
    client: {
      _client: {
        get: async (input: unknown) => {
          calls.push(input);
          return { data: rows, request: { secret: "must-not-serialize" }, response: { status: 200, ok: true } };
        },
      },
      app: {},
    },
  } as any);
  const tool = hooks.tool?.deck_skill_discovery;
  if (!tool) throw new Error("missing skill discovery tool");

  const projectSearch = JSON.parse(await tool.execute({ operation: "search", terms: ["project-helper"] }, { sessionID: "native", messageID: "m1" }));
  const userSearch = JSON.parse(await tool.execute({ operation: "search", terms: ["user-helper"] }, { sessionID: "native-user", messageID: "m1" }));
  const serialized = JSON.stringify(projectSearch) + JSON.stringify(userSearch);

  expect(calls).toEqual([{ url: "/skill" }, { url: "/skill" }]);
  expect(projectSearch.candidates[0]).toMatchObject({ name: "project-helper", source_category: "runner_exposed" });
  expect(userSearch.candidates[0]).toMatchObject({ name: "user-helper", source_category: "runner_exposed" });
  expect(serialized).not.toContain("must-not-serialize");
  expect(serialized).not.toContain("Project skill");
  expect(contentRead).toBe(false);

  const prepared = JSON.parse(await tool.execute({ operation: "prepare", observation_id: projectSearch.candidates[0].observation_id }, { sessionID: "native", messageID: "m2" }));
  expect(prepared.preparation).toEqual({ outcome: "loadable" });
  await hooks["tool.execute.before"]({ tool: "skill", sessionID: "native", callID: "skill-1" }, { args: { name: "project-helper" } });
  await hooks["tool.execute.after"]({ tool: "skill", sessionID: "native", callID: "skill-1" }, { metadata: { name: "project-helper", dir: "/native/project-helper" } });
  expect(JSON.parse(await tool.execute({ operation: "status" }, { sessionID: "native", messageID: "m3" }))).toEqual({ outcome: "loaded" });
  expect(contentRead).toBe(false);
});

test("D-REACH-SKILL-08C native SDK fallback is used only when public inventory methods are unavailable", async () => {
  let lowLevelCalls = 0;
  const hooks = await createOpenCodeDeveloperTeamExecutionPluginDefault({
    directory: process.cwd(),
    worktree: process.cwd(),
    client: {
      request: async () => [],
      _client: { get: async () => { lowLevelCalls += 1; return { data: [{ name: "helper", location: "/native/helper/SKILL.md" }], response: { status: 200, ok: true } }; } },
    },
  } as any);
  const tool = hooks.tool?.deck_skill_discovery;
  if (!tool) throw new Error("missing skill discovery tool");

  const searched = JSON.parse(await tool.execute({ operation: "search", terms: ["helper"] }, { sessionID: "native", messageID: "m1" }));
  expect(searched.candidates).toEqual([]);
  expect(lowLevelCalls).toBe(0);
});

test("D-REACH-SKILL-08D user filesystem skill reconciles to exact native SDK location", async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-native-user-skill-"));
  try {
    const home = join(root, "home");
    const projectRoot = join(root, "project");
    const skillDir = join(home, ".config", "opencode", "skills", "user-acceptance");
    mkdirSync(skillDir, { recursive: true });
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: user-acceptance\ndescription: User acceptance\n---\n# User acceptance\n");
    const skillFile = realpathSync(join(skillDir, "SKILL.md"));
    const canonicalSkillDir = realpathSync(skillDir);
    const script = `
      import pluginDefault from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.ts")).href)};
      let contentRead = false;
      const hooks = await pluginDefault({ directory: ${JSON.stringify(projectRoot)}, worktree: ${JSON.stringify(projectRoot)}, client: { _client: { get: async () => ({ data: [{ name: "user-acceptance", description: "Native user", location: ${JSON.stringify(skillFile)}, get content() { contentRead = true; throw new Error("content read"); } }], response: { status: 200, ok: true } }) } } });
      const tool = hooks.tool?.deck_skill_discovery;
      if (!tool) throw new Error("missing skill discovery tool");
      const searched = JSON.parse(await tool.execute({ operation: "search", terms: ["user-acceptance"] }, { sessionID: "child", messageID: "m1" }));
      if (searched.candidates[0]?.name !== "user-acceptance" || searched.candidates[0]?.source_category !== "user_runner") throw new Error(` + "`unexpected candidate ${JSON.stringify(searched)}`" + `);
      const prepared = JSON.parse(await tool.execute({ operation: "prepare", observation_id: searched.candidates[0].observation_id }, { sessionID: "child", messageID: "m2" }));
      if (JSON.stringify(prepared.preparation) !== JSON.stringify({ outcome: "loadable" })) throw new Error(` + "`unexpected preparation ${JSON.stringify(prepared)}`" + `);
      await hooks["tool.execute.before"]({ tool: "skill", sessionID: "child", callID: "skill-1" }, { args: { name: "user-acceptance" } });
      await hooks["tool.execute.after"]({ tool: "skill", sessionID: "child", callID: "skill-1" }, { metadata: { name: "user-acceptance", dir: ${JSON.stringify(canonicalSkillDir)} } });
      const status = JSON.parse(await tool.execute({ operation: "status" }, { sessionID: "child", messageID: "m3" }));
      if (JSON.stringify(status) !== JSON.stringify({ outcome: "loaded" })) throw new Error(` + "`unexpected status ${JSON.stringify(status)}`" + `);
      if (contentRead) throw new Error("content was read");
    `;
    const run = Bun.spawnSync({ cmd: [process.execPath, "--eval", script], cwd: process.cwd(), env: { ...process.env, HOME: home }, stdout: "pipe", stderr: "pipe" });
    if (!run.success) throw new Error(new TextDecoder().decode(run.stderr));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("D-REACH-SKILL-08E filesystem skill rejects stale, missing, and same-name different native locations", async () => {
  for (const mode of ["stale", "missing", "same-name-other-location"] as const) {
    const root = mkdtempSync(join(tmpdir(), `deck-native-user-skill-${mode}-`));
    try {
      const home = join(root, "home");
      const projectRoot = join(root, "project");
      const skillDir = join(home, ".config", "opencode", "skills", "user-acceptance");
      mkdirSync(skillDir, { recursive: true });
      mkdirSync(projectRoot, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), "---\nname: user-acceptance\n---\n# User acceptance\n");
      const skillFile = realpathSync(join(skillDir, "SKILL.md"));
      const canonicalSkillDir = realpathSync(skillDir);
      const initialRows = mode === "missing" ? [] : [{ name: "user-acceptance", location: mode === "same-name-other-location" ? join(root, "other", "SKILL.md") : skillFile }];
      const staleRows = [{ name: "user-acceptance", location: join(root, "stale", "SKILL.md") }];
      const script = `
        import pluginDefault from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.ts")).href)};
        let rows = ${JSON.stringify(initialRows)};
        const hooks = await pluginDefault({ directory: ${JSON.stringify(projectRoot)}, worktree: ${JSON.stringify(projectRoot)}, client: { _client: { get: async () => ({ data: rows, response: { status: 200, ok: true } }) } } });
        const tool = hooks.tool?.deck_skill_discovery;
        if (!tool) throw new Error("missing skill discovery tool");
        const searched = JSON.parse(await tool.execute({ operation: "search", terms: ["user-acceptance"] }, { sessionID: ${JSON.stringify(mode)}, messageID: "m1" }));
        if (searched.candidates[0]?.name !== "user-acceptance" || searched.candidates[0]?.source_category !== "user_runner") throw new Error(` + "`unexpected candidate ${JSON.stringify(searched)}`" + `);
        if (${JSON.stringify(mode)} === "stale") rows = ${JSON.stringify(staleRows)};
        const prepared = JSON.parse(await tool.execute({ operation: "prepare", observation_id: searched.candidates[0].observation_id }, { sessionID: ${JSON.stringify(mode)}, messageID: "m2" }));
        if (JSON.stringify(prepared.preparation) !== JSON.stringify({ outcome: "rejected" })) throw new Error(` + "`unexpected preparation ${JSON.stringify(prepared)}`" + `);
        await hooks["tool.execute.before"]({ tool: "skill", sessionID: ${JSON.stringify(mode)}, callID: "skill-1" }, { args: { name: "user-acceptance" } });
        await hooks["tool.execute.after"]({ tool: "skill", sessionID: ${JSON.stringify(mode)}, callID: "skill-1" }, { metadata: { name: "user-acceptance", dir: ${JSON.stringify(canonicalSkillDir)} } });
        const status = JSON.parse(await tool.execute({ operation: "status" }, { sessionID: ${JSON.stringify(mode)}, messageID: "m3" }));
        if (JSON.stringify(status) !== JSON.stringify({ outcome: "unobserved" })) throw new Error(` + "`unexpected status ${JSON.stringify(status)}`" + `);
      `;
      const run = Bun.spawnSync({ cmd: [process.execPath, "--eval", script], cwd: process.cwd(), env: { ...process.env, HOME: home }, stdout: "pipe", stderr: "pipe" });
      if (!run.success) throw new Error(new TextDecoder().decode(run.stderr));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("D-REACH-SKILL-08F default plugin prefers a validated ready registry and still prepares through exact native exposure", async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-ready-registry-skill-"));
  try {
    const home = join(root, "home");
    const projectRoot = join(root, "project");
    const skillDir = join(home, ".config", "opencode", "skills", "registry-acceptance");
    mkdirSync(skillDir, { recursive: true });
    mkdirSync(join(projectRoot, ".atl"), { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: registry-acceptance\ndescription: Registry acceptance\n---\n# Registry acceptance\n");
    const skillFile = realpathSync(join(skillDir, "SKILL.md"));
    const canonicalSkillDir = realpathSync(skillDir);
    const script = `
      import pluginDefault from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.ts")).href)};
      import { createOpenCodeSkillDiscoveryProvider } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages/adapter-opencode/src/skill-discovery-provider.ts")).href)};
      import { discoverSkills, discoverSkillsFromProvider } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages/core/src/skill-discovery/discovery.ts")).href)};
      import { canonicalizeSkillRegistry } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages/core/src/skill-discovery/registry.ts")).href)};
      import { writeFile } from "node:fs/promises";
      import { join } from "node:path";
      import { createHash } from "node:crypto";
      const projectRoot = ${JSON.stringify(projectRoot)};
      const opaqueId = "skill-" + createHash("sha256").update("registry-acceptance\\0" + ${JSON.stringify(canonicalSkillDir)}, "utf8").digest("hex").slice(0, 32);
      const provider = createOpenCodeSkillDiscoveryProvider({ skillInventoryDiscovery: async () => ({ outcome: "complete", observations: [{ opaqueId, name: "registry-acceptance", pathSignals: [${JSON.stringify(skillFile)}] }], diagnostics: [] }) });
      const sourceSet = await provider.listSources({ projectRoot });
      const discovery = await discoverSkills({ projectRoot, activeRunnerId: "opencode", sourceSet });
      const snapshot = canonicalizeSkillRegistry({ activeRunnerId: "opencode", sourceDeclarations: sourceSet.sources.map((source) => source.declaration), discovery });
      await writeFile(join(projectRoot, ".atl", "skill-registry.md"), snapshot.document);
      const hooks = await pluginDefault({ directory: projectRoot, worktree: projectRoot, client: { _client: { get: async () => ({ data: [{ name: "registry-acceptance", location: ${JSON.stringify(skillFile)} }], response: { status: 200, ok: true } }) } } });
      const tool = hooks.tool?.deck_skill_discovery;
      if (!tool) throw new Error("missing skill discovery tool");
      const searched = JSON.parse(await tool.execute({ operation: "search", terms: ["registry-acceptance"] }, { sessionID: "ready", messageID: "m1" }));
      if (searched.source_mode !== "registry") throw new Error(` + "`unexpected source mode ${JSON.stringify(searched)}`" + `);
      if (searched.candidates[0]?.name !== "registry-acceptance") throw new Error(` + "`unexpected candidate ${JSON.stringify(searched)}`" + `);
      const prepared = JSON.parse(await tool.execute({ operation: "prepare", observation_id: searched.candidates[0].observation_id }, { sessionID: "ready", messageID: "m2" }));
      if (JSON.stringify(prepared.preparation) !== JSON.stringify({ outcome: "loadable" })) throw new Error(` + "`unexpected preparation ${JSON.stringify(prepared)}`" + `);
      await hooks["tool.execute.before"]({ tool: "skill", sessionID: "ready", callID: "skill-1" }, { args: { name: "registry-acceptance" } });
      await hooks["tool.execute.after"]({ tool: "skill", sessionID: "ready", callID: "skill-1" }, { metadata: { name: "registry-acceptance", dir: ${JSON.stringify(canonicalSkillDir)} } });
      const status = JSON.parse(await tool.execute({ operation: "status" }, { sessionID: "ready", messageID: "m3" }));
      if (JSON.stringify(status) !== JSON.stringify({ outcome: "loaded" })) throw new Error(` + "`unexpected status ${JSON.stringify(status)}`" + `);
    `;
    const run = Bun.spawnSync({ cmd: [process.execPath, "--eval", script], cwd: process.cwd(), env: { ...process.env, HOME: home }, stdout: "pipe", stderr: "pipe" });
    if (!run.success) throw new Error(new TextDecoder().decode(run.stderr));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("D-REACH-SKILL-08G non-ready registries fall back to direct discovery and stale registry candidates cannot load", async () => {
  for (const mode of ["missing", "invalid", "stale", "indeterminate"] as const) {
    const root = mkdtempSync(join(tmpdir(), `deck-nonready-registry-${mode}-`));
    try {
      const home = join(root, "home");
      const projectRoot = join(root, "project");
      const skillDir = join(home, ".config", "opencode", "skills", "registry-current");
      mkdirSync(skillDir, { recursive: true });
      mkdirSync(join(projectRoot, ".atl"), { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), "---\nname: registry-current\n---\n# Registry current\n");
      const skillFile = realpathSync(join(skillDir, "SKILL.md"));
      const canonicalSkillDir = realpathSync(skillDir);
      const script = `
        import pluginDefault from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.ts")).href)};
        import { createOpenCodeSkillDiscoveryProvider } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages/adapter-opencode/src/skill-discovery-provider.ts")).href)};
        import { discoverSkills } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages/core/src/skill-discovery/discovery.ts")).href)};
        import { canonicalizeSkillRegistry } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages/core/src/skill-discovery/registry.ts")).href)};
        import { mkdir, rm, writeFile } from "node:fs/promises";
        import { join } from "node:path";
        import { createHash } from "node:crypto";
        const projectRoot = ${JSON.stringify(projectRoot)};
        const mode = ${JSON.stringify(mode)};
        const opaqueId = "skill-" + createHash("sha256").update("registry-current\\0" + ${JSON.stringify(canonicalSkillDir)}, "utf8").digest("hex").slice(0, 32);
        const provider = createOpenCodeSkillDiscoveryProvider({ skillInventoryDiscovery: async () => ({ outcome: "complete", observations: [{ opaqueId, name: "registry-current", pathSignals: [${JSON.stringify(skillFile)}] }], diagnostics: [] }) });
        if (mode !== "missing") {
          const sourceSet = await provider.listSources({ projectRoot });
          const discovery = await discoverSkills({ projectRoot, activeRunnerId: "opencode", sourceSet });
          const snapshot = canonicalizeSkillRegistry({ activeRunnerId: "opencode", sourceDeclarations: sourceSet.sources.map((source) => source.declaration), discovery });
          await writeFile(join(projectRoot, ".atl", "skill-registry.md"), mode === "invalid" ? "not: valid: yaml" : snapshot.document);
        }
        if (mode === "stale") await writeFile(${JSON.stringify(join(skillDir, "SKILL.md"))}, "---\\nname: registry-mutated\\n---\\n# Registry mutated\\n");
        if (mode === "indeterminate") { await rm(${JSON.stringify(skillDir)}, { recursive: true, force: true }); await writeFile(${JSON.stringify(skillDir)}, "not a directory"); }
        const hooks = await pluginDefault({ directory: projectRoot, worktree: projectRoot, client: { _client: { get: async () => ({ data: [{ name: "registry-current", location: ${JSON.stringify(skillFile)} }], response: { status: 200, ok: true } }) } } });
        const tool = hooks.tool?.deck_skill_discovery;
        if (!tool) throw new Error("missing skill discovery tool");
        const searched = JSON.parse(await tool.execute({ operation: "search", terms: ["registry-current"] }, { sessionID: mode, messageID: "m1" }));
        if (searched.source_mode !== "direct_discovery") throw new Error(` + "`unexpected source mode ${JSON.stringify(searched)}`" + `);
        if (mode !== "indeterminate" && searched.candidates[0]?.name !== "registry-current") throw new Error(` + "`unexpected candidate ${JSON.stringify(searched)}`" + `);
        if (mode === "indeterminate" && searched.candidates.length !== 1) throw new Error(` + "`unexpected indeterminate fallback ${JSON.stringify(searched)}`" + `);
        if (searched.candidates[0]) {
          const prepared = JSON.parse(await tool.execute({ operation: "prepare", observation_id: searched.candidates[0].observation_id }, { sessionID: mode, messageID: "m2" }));
          const expected = { outcome: "loadable" };
          if (JSON.stringify(prepared.preparation) !== JSON.stringify(expected)) throw new Error(` + "`unexpected preparation ${JSON.stringify({mode, prepared})}`" + `);
          if (prepared.preparation.outcome === "loadable") {
            await hooks["tool.execute.before"]({ tool: "skill", sessionID: mode, callID: "skill-1" }, { args: { name: "registry-current" } });
            await hooks["tool.execute.after"]({ tool: "skill", sessionID: mode, callID: "skill-1" }, { metadata: { name: "registry-current", dir: ${JSON.stringify(canonicalSkillDir)} } });
            const status = JSON.parse(await tool.execute({ operation: "status" }, { sessionID: mode, messageID: "m3" }));
            if (JSON.stringify(status) !== JSON.stringify({ outcome: "loaded" })) throw new Error(` + "`unexpected status ${JSON.stringify({mode, status})}`" + `);
          }
        }
      `;
      const run = Bun.spawnSync({ cmd: [process.execPath, "--eval", script], cwd: process.cwd(), env: { ...process.env, HOME: home }, stdout: "pipe", stderr: "pipe" });
      if (!run.success) throw new Error(new TextDecoder().decode(run.stderr));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("D-REACH-SKILL-08H mutable native inventory invalidates ready registry without indefinite cache or double-read fallback", async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-mutable-registry-inventory-"));
  try {
    const home = join(root, "home");
    const projectRoot = join(root, "project");
    mkdirSync(join(projectRoot, ".atl"), { recursive: true });
    const oneDir = join(root, "native", "one");
    const twoDir = join(root, "native", "two");
    mkdirSync(oneDir, { recursive: true });
    mkdirSync(twoDir, { recursive: true });
    const oneFile = join(oneDir, "SKILL.md");
    const twoFile = join(twoDir, "SKILL.md");
    writeFileSync(oneFile, "# one\n");
    writeFileSync(twoFile, "# two\n");
    const script = `
      import pluginDefault from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.ts")).href)};
      import { createOpenCodeSkillDiscoveryProvider } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages/adapter-opencode/src/skill-discovery-provider.ts")).href)};
      import { discoverSkills } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages/core/src/skill-discovery/discovery.ts")).href)};
      import { canonicalizeSkillRegistry } from ${JSON.stringify(pathToFileURL(join(process.cwd(), "packages/core/src/skill-discovery/registry.ts")).href)};
      import { writeFile } from "node:fs/promises";
      import { join } from "node:path";
      import { createHash } from "node:crypto";
      const projectRoot = ${JSON.stringify(projectRoot)};
      const oneDir = ${JSON.stringify(oneDir)};
      const twoDir = ${JSON.stringify(twoDir)};
      const oneFile = ${JSON.stringify(oneFile)};
      const twoFile = ${JSON.stringify(twoFile)};
      const opaque = (name, dir) => "skill-" + createHash("sha256").update(name + "\\0" + dir, "utf8").digest("hex").slice(0, 32);
      const registryProvider = createOpenCodeSkillDiscoveryProvider({ skillInventoryDiscovery: async () => ({ outcome: "complete", observations: [{ opaqueId: opaque("inventory-one", oneDir), name: "inventory-one", pathSignals: [oneFile] }], diagnostics: [] }) });
      const sourceSet = await registryProvider.listSources({ projectRoot });
      const discovery = await discoverSkills({ projectRoot, activeRunnerId: "opencode", sourceSet });
      const snapshot = canonicalizeSkillRegistry({ activeRunnerId: "opencode", sourceDeclarations: sourceSet.sources.map((source) => source.declaration), discovery });
      await writeFile(join(projectRoot, ".atl", "skill-registry.md"), snapshot.document);
      let rows = [{ name: "inventory-one", location: oneFile }];
      let inventoryCalls = 0;
      const hooks = await pluginDefault({ directory: projectRoot, worktree: projectRoot, client: { _client: { get: async () => { inventoryCalls += 1; return { data: rows, response: { status: 200, ok: true } }; } } } });
      const tool = hooks.tool?.deck_skill_discovery;
      if (!tool) throw new Error("missing skill discovery tool");
      const first = JSON.parse(await tool.execute({ operation: "search", terms: ["inventory"] }, { sessionID: "mutable", messageID: "m1" }));
      if (first.source_mode !== "registry" || first.candidates.map((candidate) => candidate.name).join(",") !== "inventory-one") throw new Error(` + "`unexpected first ${JSON.stringify(first)}`" + `);
      rows = [{ name: "inventory-two", location: twoFile }];
      const second = JSON.parse(await tool.execute({ operation: "search", terms: ["inventory"] }, { sessionID: "mutable", messageID: "m2" }));
      if (second.source_mode !== "direct_discovery" || second.candidates.map((candidate) => candidate.name).join(",") !== "inventory-two") throw new Error(` + "`unexpected second ${JSON.stringify(second)}`" + `);
      if (inventoryCalls !== 2) throw new Error(` + "`unexpected inventory call count ${inventoryCalls}`" + `);
    `;
    const run = Bun.spawnSync({ cmd: [process.execPath, "--eval", script], cwd: process.cwd(), env: { ...process.env, HOME: home }, stdout: "pipe", stderr: "pipe" });
    if (!run.success) throw new Error(new TextDecoder().decode(run.stderr));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("D-REACH-SKILL-09 duplicate and malformed native inventory are non-loadable", async () => {
  for (const response of [
    { skills: [{ name: "helper", dir: "/native/a", taskSignals: ["native-only"] }, { name: "helper", dir: "/native/b", taskSignals: ["native-only"] }] },
    { skills: [{ name: "helper", content: "missing dir", taskSignals: ["native-only"] }] },
  ]) {
    const hooks = await createOpenCodeDeveloperTeamExecutionPluginDefault({
      directory: process.cwd(), worktree: process.cwd(), client: { request: async () => response },
    } as any);
    const tool = hooks.tool?.deck_skill_discovery;
    if (!tool) throw new Error("missing skill discovery tool");
    const searched = JSON.parse(await tool.execute({ operation: "search", terms: ["native-only"] }, { sessionID: `native-${Math.random()}`, messageID: "m1" }));
    expect(searched.candidates.length).toBe(0);
  }
});

test("D-REACH-SKILL-09B native inventory envelope semantics and descriptor fallback stay non-loadable", async () => {
  for (const response of [
    { data: [{ name: "helper", dir: "/native/helper", taskSignals: ["native-only"] }] },
    { response: "ok", data: [{ name: "helper", dir: "/native/helper", taskSignals: ["native-only"] }] },
    { response: { status: 500, ok: false }, data: [{ name: "helper", dir: "/native/helper", taskSignals: ["native-only"] }] },
    { response: {}, data: [{ name: "helper", dir: "/native/helper", taskSignals: ["native-only"] }] },
    { response: [], data: [{ name: "helper", dir: "/native/helper", taskSignals: ["native-only"] }] },
    { response: { status: 200, ok: false }, data: [{ name: "helper", dir: "/native/helper", taskSignals: ["native-only"] }] },
    { response: { status: 500, ok: true }, data: [{ name: "helper", dir: "/native/helper", taskSignals: ["native-only"] }] },
    { error: "boom", response: { status: 500 }, data: [{ name: "helper", dir: "/native/helper", taskSignals: ["native-only"] }] },
    { outcome: "indeterminate", skills: [{ name: "helper", dir: "/native/helper", taskSignals: ["native-only"] }] },
    { completeness: "truncated", skills: [{ name: "helper", dir: "/native/helper", taskSignals: ["native-only"] }] },
    { status: "error", skills: [{ name: "helper", dir: "/native/helper", taskSignals: ["native-only"] }] },
    { status: "mystery", skills: [{ name: "helper", dir: "/native/helper", taskSignals: ["native-only"] }] },
  ]) {
    const hooks = await createOpenCodeDeveloperTeamExecutionPluginDefault({ directory: process.cwd(), worktree: process.cwd(), client: { request: async () => response } } as any);
    const tool = hooks.tool?.deck_skill_discovery;
    if (!tool) throw new Error("missing skill discovery tool");
    const searched = JSON.parse(await tool.execute({ operation: "search", terms: ["native-only"] }, { sessionID: `native-${Math.random()}`, messageID: "m1" }));
    expect(searched.candidates.length).toBe(0);
  }

  const projectRoot = mkdtempSync(join(tmpdir(), "deck-descriptor-not-native-"));
  try {
    mkdirSync(join(projectRoot, ".agents", "skills", "helper"), { recursive: true });
    writeFileSync(join(projectRoot, ".agents", "skills", "helper", "SKILL.md"), "---\nname: helper\ntask_signals:\n  - descriptor-only\n---\n# Helper\n");
    const hooks = await createOpenCodeDeveloperTeamExecutionPluginDefault({ directory: projectRoot, worktree: projectRoot, client: { request: async () => [] } } as any);
    const tool = hooks.tool?.deck_skill_discovery;
    if (!tool) throw new Error("missing skill discovery tool");
    const searched = JSON.parse(await tool.execute({ operation: "search", terms: ["descriptor-only"] }, { sessionID: "native", messageID: "m1" }));
    expect(searched.candidates[0].name).toBe("helper");
    expect(JSON.parse(await tool.execute({ operation: "prepare", observation_id: searched.candidates[0].observation_id }, { sessionID: "native", messageID: "m2" })).preparation).not.toEqual({ outcome: "loadable" });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("D-REACH-SKILL-09C native inventory bounds never read content or row 65", async () => {
  let contentRead = false;
  const row = { name: "helper", dir: "/native/helper", taskSignals: ["native-only"], get content() { contentRead = true; throw new Error("content read"); } };
  let hooks = await createOpenCodeDeveloperTeamExecutionPluginDefault({ directory: process.cwd(), worktree: process.cwd(), client: { request: async () => [row] } } as any);
  let tool = hooks.tool?.deck_skill_discovery;
  if (!tool) throw new Error("missing skill discovery tool");
  const searched = JSON.parse(await tool.execute({ operation: "search", terms: ["native-only"] }, { sessionID: "native-content", messageID: "m1" }));
  expect(searched.candidates[0].name).toBe("helper");
  expect(contentRead).toBe(false);

  let row65Read = false;
  const rows = Array.from({ length: 64 }, (_, index) => ({ name: `helper-${index}`, dir: `/native/helper-${index}`, taskSignals: ["native-only"] }));
  Object.defineProperty(rows, "64", { get() { row65Read = true; throw new Error("row65 read"); } });
  hooks = await createOpenCodeDeveloperTeamExecutionPluginDefault({ directory: process.cwd(), worktree: process.cwd(), client: { request: async () => rows } } as any);
  tool = hooks.tool?.deck_skill_discovery;
  if (!tool) throw new Error("missing skill discovery tool");
  const tooMany = JSON.parse(await tool.execute({ operation: "search", terms: ["native-only"] }, { sessionID: "native-row65", messageID: "m1" }));
  expect(tooMany.candidates.length).toBe(0);
  expect(row65Read).toBe(false);
});

test("D-REACH-SKILL-10 changed native exposure rejects old prepared rendezvous", async () => {
  let dir = "/native/a";
  const hooks = await createOpenCodeDeveloperTeamExecutionPluginDefault({
    directory: process.cwd(), worktree: process.cwd(), client: { request: async () => [{ name: "helper", dir, taskSignals: ["native-only"] }] },
  } as any);
  const tool = hooks.tool?.deck_skill_discovery;
  if (!tool) throw new Error("missing skill discovery tool");
  const searched = JSON.parse(await tool.execute({ operation: "search", terms: ["native-only"] }, { sessionID: "native", messageID: "m1" }));
  await tool.execute({ operation: "prepare", observation_id: searched.candidates[0].observation_id }, { sessionID: "native", messageID: "m2" });
  dir = "/native/b";
  await expect(hooks["tool.execute.before"]({ tool: "skill", sessionID: "native", callID: "skill-1" }, { args: { name: "helper" } })).rejects.toThrow("invalid-evidence");
  await hooks["tool.execute.after"]({ tool: "skill", sessionID: "native", callID: "skill-1" }, { metadata: { name: "helper", dir: "/native/a" } });
  expect(JSON.parse(await tool.execute({ operation: "status" }, { sessionID: "native", messageID: "m3" }))).toEqual({ outcome: "unobserved" });
});

test("D-REACH-SKILL-11 mismatch is terminal, missing evidence is unobserved, and message part errors fail", async () => {
  const hooks = await createOpenCodeDeveloperTeamExecutionPluginDefault({
    directory: process.cwd(), worktree: process.cwd(), client: { request: async () => [{ name: "helper", dir: "/native/helper", taskSignals: ["native-only"] }] },
  } as any);
  const tool = hooks.tool?.deck_skill_discovery;
  if (!tool) throw new Error("missing skill discovery tool");
  let searched = JSON.parse(await tool.execute({ operation: "search", terms: ["native-only"] }, { sessionID: "native", messageID: "m1" }));
  await tool.execute({ operation: "prepare", observation_id: searched.candidates[0].observation_id }, { sessionID: "native", messageID: "m2" });
  await hooks["tool.execute.before"]({ tool: "skill", sessionID: "native", callID: "call-mismatch" }, { args: { name: "helper" } });
  await hooks["tool.execute.after"]({ tool: "skill", sessionID: "native", callID: "call-mismatch" }, { metadata: { name: "helper", dir: "/native/wrong" } });
  await hooks["tool.execute.after"]({ tool: "skill", sessionID: "native", callID: "call-mismatch" }, { metadata: { name: "helper", dir: "/native/helper" } });
  expect(JSON.parse(await tool.execute({ operation: "status" }, { sessionID: "native", messageID: "m3" }))).toEqual({ outcome: "unobserved" });

  searched = JSON.parse(await tool.execute({ operation: "search", terms: ["native-only"] }, { sessionID: "native", messageID: "m4" }));
  await tool.execute({ operation: "prepare", observation_id: searched.candidates[0].observation_id }, { sessionID: "native", messageID: "m5" });
  await hooks["tool.execute.before"]({ tool: "skill", sessionID: "native", callID: "call-missing" }, { args: { name: "helper" } });
  await hooks["tool.execute.after"]({ tool: "skill", sessionID: "native", callID: "call-missing" }, {});
  expect(JSON.parse(await tool.execute({ operation: "status" }, { sessionID: "native", messageID: "m6" }))).toEqual({ outcome: "unobserved" });

  searched = JSON.parse(await tool.execute({ operation: "search", terms: ["native-only"] }, { sessionID: "native", messageID: "m7" }));
  await tool.execute({ operation: "prepare", observation_id: searched.candidates[0].observation_id }, { sessionID: "native", messageID: "m8" });
  await hooks["tool.execute.before"]({ tool: "skill", sessionID: "native", callID: "call-error" }, { args: { name: "helper" } });
  await hooks.event({ event: { type: "message.part.updated", sessionID: "native", properties: { part: { type: "tool", tool: "skill", callID: "call-error", state: { status: "error" }, args: { name: "helper" } } } } as any });
  expect(JSON.parse(await tool.execute({ operation: "status" }, { sessionID: "native", messageID: "m9" }))).toEqual({ outcome: "failed" });
});

test("D-REACH-SKILL-13 nested message part error uses part session and call without root session", async () => {
  const hooks = await createOpenCodeDeveloperTeamExecutionPluginDefault({
    directory: process.cwd(), worktree: process.cwd(), client: { request: async () => [{ name: "helper", dir: "/native/helper", taskSignals: ["native-only"] }] },
  } as any);
  const tool = hooks.tool?.deck_skill_discovery;
  if (!tool) throw new Error("missing skill discovery tool");
  const searched = JSON.parse(await tool.execute({ operation: "search", terms: ["native-only"] }, { sessionID: "native", messageID: "m1" }));
  await tool.execute({ operation: "prepare", observation_id: searched.candidates[0].observation_id }, { sessionID: "native", messageID: "m2" });
  await hooks["tool.execute.before"]({ tool: "skill", sessionID: "native", callID: "call-error" }, { args: { name: "helper" } });
  await hooks.event({ event: { type: "message.part.updated", properties: { part: { type: "tool", tool: "skill", sessionID: "native", callID: "call-error", state: { status: "error" }, args: { name: "helper" } } } } as any });
  expect(JSON.parse(await tool.execute({ operation: "status" }, { sessionID: "native", messageID: "m3" }))).toEqual({ outcome: "failed" });
  await hooks["tool.execute.after"]({ tool: "skill", sessionID: "native", callID: "call-error" }, { metadata: { name: "helper", dir: "/native/helper" } });
  expect(JSON.parse(await tool.execute({ operation: "status" }, { sessionID: "native", messageID: "m4" }))).toEqual({ outcome: "failed" });
});

test("D-REACH-SKILL-14 debug state is not agent-facing and inspector is option-only", async () => {
  const defaultInputSnapshots: Array<{ activeGenerations: number; bindings: number; calls: number; prepared: number; candidateNames: number }> = [];
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const defaultHooks = await createOpenCodeDeveloperTeamExecutionPluginDefault({
      directory: process.cwd(), worktree: process.cwd(), client: { request: async () => [{ name: "helper", dir: "/native/helper", taskSignals: ["native-only"] }] },
      skillDiscoveryInspector: (snapshot: any) => defaultInputSnapshots.push(snapshot),
    } as any);
    const defaultTool = defaultHooks.tool?.deck_skill_discovery;
    if (!defaultTool) throw new Error("missing default skill discovery tool");
    expect(JSON.parse(await defaultTool.execute({ operation: "__debug_state", __test: true, skillDiscoveryInspector: () => defaultInputSnapshots.push({ activeGenerations: 999, bindings: 999, calls: 999, prepared: 999, candidateNames: 999 }) }, { sessionID: "native", messageID: "debug" }))).toEqual({ outcome: "invalid-request" });
    await defaultTool.execute({ operation: "search", terms: ["native-only"] }, { sessionID: "native", messageID: "m1" });
    expect(defaultInputSnapshots).toEqual([]);

    const directSnapshots: Array<{ activeGenerations: number; bindings: number; calls: number; prepared: number; candidateNames: number }> = [];
    const directHooks = await createOpenCodeDeveloperTeamExecutionPluginV1({
      skillDiscovery: {
        projectRoot: process.cwd(), registryStatus: "missing",
        provider: { schema: "skill-discovery-source-provider-v1", runnerId: "opencode", listSources: async () => ({ outcome: "complete", sources: [], diagnostics: [] }), resolveLocator: async () => ({ status: "missing" }) },
        discoverDirectly: async () => ({ outcome: "complete", observations: [{ name: "helper", source_category: "runner_exposed", scope: "runner", locator: "runner:opencode:inventory/helper", runner_id: "opencode", task_signals: ["native-only"], technology_signals: [], path_signals: [] }], diagnostics: [] }),
      },
      skillDiscoveryInspector: (snapshot: any) => directSnapshots.push(snapshot),
    } as any)();
    const directTool = directHooks.tool?.deck_skill_discovery;
    if (!directTool) throw new Error("missing direct skill discovery tool");
    await directTool.execute({ operation: "search", terms: ["native-only"] }, { sessionID: "direct", messageID: "m1" });
    expect(directSnapshots.at(-1)?.activeGenerations).toBeGreaterThan(0);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("D-REACH-SKILL-12 repeated rotations and invalidations stay bounded and usable", async () => {
  let requests = 0;
  const snapshots: Array<{ activeGenerations: number; bindings: number; calls: number; prepared: number; candidateNames: number }> = [];
  const projectRoot = mkdtempSync(join(tmpdir(), "deck-skill-stress-"));
  try {
    const hooks = await createOpenCodeDeveloperTeamExecutionPluginV1({
      skillDiscoveryInspector: (snapshot: any) => snapshots.push(snapshot),
    })({
      directory: projectRoot, worktree: projectRoot, client: { request: async () => { requests += 1; return [{ name: "helper", dir: "/native/helper", taskSignals: ["native-only"] }]; } },
    } as any);
    const tool = hooks.tool?.deck_skill_discovery;
    if (!tool) throw new Error("missing skill discovery tool");
    for (let index = 0; index < 100; index += 1) {
      const sessionID = `native-${index}`;
      await tool.execute({ operation: "search", terms: ["native-only"] }, { sessionID, messageID: `m-${index}` });
    }
    for (let index = 0; index < 80; index += 1) {
      await tool.execute({ operation: "search", terms: ["native-only"] }, { sessionID: "native-active", messageID: `active-${index}` });
    }
    const searched = JSON.parse(await tool.execute({ operation: "search", terms: ["native-only"] }, { sessionID: "native-active", messageID: "final" }));
    expect(searched.candidates[0].name).toBe("helper");
    expect(requests).toBeLessThanOrEqual(181);
    expect(snapshots.length).toBeGreaterThan(0);
    const max = snapshots.reduce((acc, item) => ({ activeGenerations: Math.max(acc.activeGenerations, item.activeGenerations), bindings: Math.max(acc.bindings, item.bindings), calls: Math.max(acc.calls, item.calls), prepared: Math.max(acc.prepared, item.prepared), candidateNames: Math.max(acc.candidateNames, item.candidateNames) }), { activeGenerations: 0, bindings: 0, calls: 0, prepared: 0, candidateNames: 0 });
    expect(max.activeGenerations).toBeLessThanOrEqual(64);
    expect(max.bindings).toBeLessThanOrEqual(64);
    expect(max.calls).toBe(0);
    expect(max.prepared).toBe(0);
    expect(max.candidateNames).toBeLessThanOrEqual(64);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("OpenCode production execution plugin does not expose dead Supermemory capture hooks", () => {
  const configDir = mkdtempSync(join(tmpdir(), "deck-opencode-no-dead-capture-"));
  try {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/deck-project", { configDir });
    applyOpenCodeDeveloperTeamInstall(plan, { configDir });
    const pluginContent = readFileSync(plan.executionPlugin!.absolutePath, "utf8");
    expect(pluginContent).not.toContain("captureSupermemoryConversationTurn");
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});

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
  const args: Record<string, unknown> = { subagent_type: "deck-apply-fast" };
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
  const args: Record<string, unknown> = { subagent_type: "deck-apply-fast" };
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
  const args: Record<string, unknown> = { subagent_type: "deck-apply-fast" };
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
  const args: Record<string, unknown> = { subagent_type: "deck-apply-fast" };
  await expect(
    hooks["tool.execute.before"]({ tool: "delegate", sessionID: "non-object-resolver", callID: "non-object-resolver-call" }, { args }),
  ).rejects.toThrow("invalid-evidence");
  expect(resolverCalls).toBe(1);
  expect(bridgeCalls).toBe(0);
});

test("D-REACH-26 OpenCode unrelated role strips caller deckExecution, provider not called, zero bridge", async () => {
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
  const args: Record<string, unknown> = { subagent_type: "deck-investigate", deckExecution: fixture.event() };
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

test("D-REACH-27 OpenCode unrelated role preserves zero bridge/effect even when caller provides deckExecution", async () => {
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
  const args: Record<string, unknown> = { subagent_type: "deck-investigate", deckExecution: fixture.event() };
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
      { args: { subagent_type: "deck-apply-fast" } },
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
      { args: { subagent_type: "deck-apply-fast" } },
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
      { args: { subagent_type: "deck-apply-fast" } },
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
      { args: { subagent_type: "deck-apply-fast" } },
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
      { args: { subagent_type: "deck-apply-fast" } },
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
        { args: { subagent_type: "deck-apply-fast" } },
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
      { args: { subagent_type: "deck-apply-fast" } },
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
      { args: { subagent_type: "deck-apply-fast" } },
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
      { args: { subagent_type: "deck-apply-fast" } },
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
      { args: { subagent_type: "deck-apply-fast" } },
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
        { args: { subagent_type: "deck-apply-fast" } },
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


test("T03 OpenCode reserves trusted preparation authority before one native deck-setup delegation", async () => {
  const authority = openCodePreparationAuthority("prep-session", "prep-call");
  let providerCalls = 0;
  let poisonCalls = 0;
  (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL] = {
    sessionPreparationAuthorizationService: authority.service,
    resolveOpenCodeSessionPreparation: async () => {
      providerCalls += 1;
      return { authorization: authority.authorization, expectation: authority.expectation };
    },
  };
  try {
    const hooks = await createOpenCodeDeveloperTeamExecutionPluginV1()();
    const args: Record<string, unknown> = {
      subagent_type: "deck-setup",
      deckPreparation: { authorization: "caller-poison" },
      install: () => { poisonCalls += 1; },
      network: () => { poisonCalls += 1; },
      git: () => { poisonCalls += 1; },
    };
    let nativeDelegations = 0;
    await hooks["tool.execute.before"](
      { tool: "delegate", sessionID: "prep-session", callID: "prep-call" },
      { args },
    );
    nativeDelegations += 1;
    expect(providerCalls).toBe(1);
    expect(nativeDelegations).toBe(1);
    expect(poisonCalls).toBe(0);
    expect(args.deckPreparation).toEqual({
      kind: "deck-preparation-authority-reference-v1",
      authorizationId: authority.authorization.claims.authorizationId,
      claimsDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
  } finally {
    delete (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL];
  }
});

test("T03 OpenCode fails closed before delegation for replay and runner mismatch", async () => {
  const replay = openCodePreparationAuthority("replay-session", "replay-call");
  let resolution: { authorization: unknown; expectation: SessionPreparationAuthorizationExpectationV1 } = replay;
  (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL] = {
    sessionPreparationAuthorizationService: replay.service,
    resolveOpenCodeSessionPreparation: async () => resolution,
  };
  try {
    const hooks = await createOpenCodeDeveloperTeamExecutionPluginV1()();
    const invoke = (sessionID: string, callID: string) => hooks["tool.execute.before"](
      { tool: "delegate", sessionID, callID },
      { args: { subagent_type: "deck-setup" } },
    );
    await invoke("replay-session", "replay-call");
    await expect(invoke("replay-session", "replay-call")).rejects.toThrow("modification-not-authorized:AUTHZ_REPLAYED");

    const mismatch = openCodePreparationAuthority("mismatch-session", "mismatch-call", "pi");
    resolution = { authorization: mismatch.authorization, expectation: mismatch.expectation };
    (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL] = {
      sessionPreparationAuthorizationService: mismatch.service,
      resolveOpenCodeSessionPreparation: async () => resolution,
    };
    const mismatchHooks = await createOpenCodeDeveloperTeamExecutionPluginV1()();
    await expect(mismatchHooks["tool.execute.before"](
      { tool: "delegate", sessionID: "mismatch-session", callID: "mismatch-call" },
      { args: { subagent_type: "deck-setup" } },
    )).rejects.toThrow("modification-not-authorized:AUTHZ_RUNNER_MISMATCH");
  } finally {
    delete (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL];
  }
});

test("T03 OpenCode never resolves preparation for unrelated agents and clears closed sessions", async () => {
  let providerCalls = 0;
  const cleared: string[] = [];
  (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL] = {
    resolveOpenCodeSessionPreparation: async () => { providerCalls += 1; },
    clearSessionPreparationSession: (sessionId: string) => { cleared.push(sessionId); },
  };
  try {
    const hooks = await createOpenCodeDeveloperTeamExecutionPluginV1()();
    await hooks["tool.execute.before"](
      { tool: "delegate", sessionID: "ordinary-session", callID: "ordinary-call" },
      { args: { subagent_type: "deck-apply-deep", deckPreparation: "caller-poison" } },
    );
    expect(providerCalls).toBe(0);
    await hooks.event({ event: { type: "session.deleted", properties: { info: { id: "ordinary-session" } } } });
    expect(cleared).toEqual(["ordinary-session"]);
  } finally {
    delete (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL];
  }
});


test("T03 OpenCode rejects caller-only preparation metadata when the host provider is absent", async () => {
  const hooks = await createOpenCodeDeveloperTeamExecutionPluginV1()();
  const args: Record<string, unknown> = {
    subagent_type: "deck-setup",
    deckPreparation: { authorization: "caller-only" },
  };
  await expect(hooks["tool.execute.before"](
    { tool: "delegate", sessionID: "missing-provider-session", callID: "missing-provider-call" },
    { args },
  )).rejects.toThrow("modification-not-authorized:AUTHZ_PROVIDER_MISSING");
  expect(args.deckPreparation).toBeUndefined();
});

test("D-REACH-39 OpenCode registers correlated QA hooks for the native task tool and strips caller QA authority", async () => {
  const reference = Object.freeze({ token: "trusted-qa-reference" });
  const prepared: unknown[] = [];
  const consumed: Array<{ receivedReference: unknown; result: unknown }> = [];
  const qaAuthority = {
    prepare: async (request: unknown) => {
      prepared.push(request);
      return Object.freeze({
        invocationId: "qa-call",
        digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        reference,
      }) as unknown as Awaited<ReturnType<QaRunnerHostAuthorityV1["prepare"]>>;
    },
    consume: async (receivedReference: unknown, result: unknown) => {
      consumed.push({ receivedReference, result });
      return { code: "accepted" } as never;
    },
    clearSession: () => undefined,
  } satisfies QaRunnerHostAuthorityV1;
  const createPlugin = await loadOpenCodePluginFactory();
  const plugin = createPlugin({
    invocationAuthorization: "invocation-required",
    qaAuthority,
  });
  const hooks = await plugin();
  const args: Record<string, unknown> = {
    subagent_type: "deck-quality",
    deckQaInvocation: { invocationId: "caller-poison" },
    deckQaResult: { status: "caller-poison" },
  };
  const input = { tool: "task", sessionID: "qa-session", callID: "qa-call" };

  expect(hooks["tool.execute.before"]).toBeDefined();
  expect(hooks["tool.execute.after"]).toBeDefined();
  await hooks["tool.execute.before"](input, { args });

  expect(prepared).toHaveLength(1);
  expect(Object.isFrozen(prepared[0])).toBe(true);
  expect(prepared[0]).toEqual({
    runnerId: "opencode",
    sessionId: "qa-session",
    invocationId: "qa-call",
    requestedRole: "verify",
  });
  expect(args.deckQaResult).toBeUndefined();
  expect(args.deckQaInvocation).toEqual({
    invocationId: "qa-call",
    digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    reference,
  });
  expect(Object.isFrozen(args.deckQaInvocation)).toBe(true);

  const result = {
    invocationId: "control-plane-verify-invocation",
    digest: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    outcome: "passed",
  };
  await hooks["tool.execute.after"](input, { args, result });
  expect(consumed).toEqual([{ receivedReference: reference, result }]);
});

test("D-REACH-40 OpenCode consumes a QA result once and rejects missing or mismatched correlation", async () => {
  let consumed = 0;
  const digest = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const qaAuthority = {
    prepare: async (request: unknown) => {
      const { invocationId } = request as { invocationId: string };
      return Object.freeze({ invocationId, digest, reference: Object.freeze({ invocationId }) }) as unknown as Awaited<ReturnType<QaRunnerHostAuthorityV1["prepare"]>>;
    },
    consume: async () => { consumed += 1; return { code: "accepted" } as never; },
    clearSession: () => undefined,
  } satisfies QaRunnerHostAuthorityV1;
  const plugin = createOpenCodeDeveloperTeamExecutionPluginV1({
    invocationAuthorization: "invocation-required",
    qaAuthority,
  });
  const hooks = await plugin();
  const args = { subagent_type: "deck-quality" };
  const mismatchedInput = { tool: "delegate", sessionID: "qa-once-session", callID: "qa-mismatch" };
  await hooks["tool.execute.before"](mismatchedInput, { args });

  await expect(hooks["tool.execute.after"]({ ...mismatchedInput, callID: "qa-other-call" }, {
    args,
    result: { invocationId: "control-plane-review-invocation", digest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" },
  })).rejects.toThrow("invalid-evidence");
  expect(consumed).toBe(0);
  await hooks["tool.execute.after"](mismatchedInput, {
    args,
    result: { invocationId: "control-plane-review-invocation", digest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" },
  });
  expect(consumed).toBe(1);
  await expect(hooks["tool.execute.before"](mismatchedInput, { args })).rejects.toThrow("invalid-evidence");

  const missingResultInput = { tool: "delegate", sessionID: "qa-once-session", callID: "qa-missing-result" };
  await hooks["tool.execute.before"](missingResultInput, { args });
  await expect(hooks["tool.execute.after"](missingResultInput, { args })).rejects.toThrow("invalid-evidence");
  expect(consumed).toBe(1);

  const input = { tool: "delegate", sessionID: "qa-once-session", callID: "qa-once" };
  await hooks["tool.execute.before"](input, { args });
  const result = { invocationId: "control-plane-review-once", digest };
  await hooks["tool.execute.after"](input, { args, result });
  expect(consumed).toBe(2);
  await expect(hooks["tool.execute.after"](input, { args, result })).rejects.toThrow("invalid-evidence");
  expect(consumed).toBe(2);
});

test("D-REACH-41 OpenCode invocation-required QA delegation fails closed without a provider", async () => {
  const hooks = await createOpenCodeDeveloperTeamExecutionPluginV1({ invocationAuthorization: "invocation-required" })();
  await expect(hooks["tool.execute.before"](
    { tool: "delegate", sessionID: "qa-missing", callID: "qa-missing-call" },
    { args: { subagent_type: "deck-quality", deckQaInvocation: { caller: true }, deckQaResult: { caller: true } } },
  )).rejects.toThrow("modification-not-authorized:AUTHZ_MISSING");
});

test("D-REACH-42 OpenCode clears pending QA correlation and invokes session cleanup", async () => {
  const cleared: string[] = [];
  const digest = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
  const qaAuthority = {
    prepare: async () => Object.freeze({ invocationId: "qa-cleanup-call", digest, reference: Object.freeze({ invocationId: "qa-cleanup-call" }) }) as unknown as Awaited<ReturnType<QaRunnerHostAuthorityV1["prepare"]>>,
    consume: async () => ({ code: "accepted" } as never),
    clearSession: (sessionId: unknown) => { cleared.push(sessionId as string); },
  } satisfies QaRunnerHostAuthorityV1;
  (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL] = {
    invocationAuthorization: "invocation-required",
    qaAuthority,
  };
  try {
    const hooks = await createOpenCodeDeveloperTeamExecutionPluginV1()();
    const input = { tool: "delegate", sessionID: "qa-cleanup", callID: "qa-cleanup-call" };
    const args = { subagent_type: "deck-quality" };
    await hooks["tool.execute.before"](input, { args });
    await hooks.event({ event: { type: "session.deleted", properties: { info: { id: "qa-cleanup" } } } });
    expect(cleared).toEqual(["qa-cleanup"]);
    await expect(hooks["tool.execute.after"](input, {
      args,
      result: { invocationId: "control-plane-cleanup-invocation", digest },
    })).rejects.toThrow("invalid-evidence");
  } finally {
    delete (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL];
  }
});

test("T03 OpenCode blocks missing and invalid provider claims before native delegation", async () => {
  const missing = openCodePreparationAuthority("missing-claim-session", "missing-claim-call");
  (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL] = {
    sessionPreparationAuthorizationService: missing.service,
    resolveOpenCodeSessionPreparation: async () => ({ authorization: undefined, expectation: missing.expectation }),
  };
  try {
    const missingHooks = await createOpenCodeDeveloperTeamExecutionPluginV1()();
    await expect(missingHooks["tool.execute.before"](
      { tool: "delegate", sessionID: "missing-claim-session", callID: "missing-claim-call" },
      { args: { subagent_type: "deck-setup" } },
    )).rejects.toThrow("modification-not-authorized:AUTHZ_MISSING");

    const invalid = openCodePreparationAuthority("invalid-claim-session", "invalid-claim-call");
    const invalidAuthorization = {
      ...invalid.authorization,
      proof: {
        ...invalid.authorization.proof,
        value: `${invalid.authorization.proof.value.startsWith("A") ? "B" : "A"}${invalid.authorization.proof.value.slice(1)}`,
      },
    };
    (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL] = {
      sessionPreparationAuthorizationService: invalid.service,
      resolveOpenCodeSessionPreparation: async () => ({ authorization: invalidAuthorization, expectation: invalid.expectation }),
    };
    const invalidHooks = await createOpenCodeDeveloperTeamExecutionPluginV1()();
    await expect(invalidHooks["tool.execute.before"](
      { tool: "delegate", sessionID: "invalid-claim-session", callID: "invalid-claim-call" },
      { args: { subagent_type: "deck-setup" } },
    )).rejects.toThrow("modification-not-authorized:AUTHZ_PROOF_INVALID");
  } finally {
    delete (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT_SYMBOL];
  }
});
