import { describe, expect, test } from "bun:test";
import { sha256Digest } from "../contracts/canonical";
import {
  aggregateDeckPreparationHandoffV1,
  buildSessionPreparationDelegationDigestV1,
  consumeSessionPreparationAuthorizationV1,
  createSessionPreparationAuthorizationServiceV1,
  createSessionPreparationStateV1,
  parseDeckPreparationHandoffV1,
  parseSessionPreparationRequestV1,
  type SessionPreparationAuthorizationExpectationV1,
  type SessionPreparationAuthorizationIssueInputV1,
  type SessionPreparationAuthorizationRejectionCodeV1,
  type SessionPreparationRequestV1,
  type DeckPreparationComponentStatusV1,
} from "./session-preparation";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

const request: SessionPreparationRequestV1 = {
  schema: "session-preparation-request-v1",
  sessionId: "session-1",
  invocationId: "invocation-1",
  activeRunnerId: "opencode",
  projectRootDigest: digest("1"),
  openSpecStatus: "initialized",
  skillDiscoveryContext: {
    registry_path: ".atl/skill-registry.md",
    status: "ready",
    reason_code: "fingerprint_match",
    guidance: "Use the project registry.",
    active_runner_id: "opencode",
    authority_reminder_version: "v1",
  },
};

const operations = [
  { component: "openspec", action: "merge", target: "openspec/config.yaml" },
  { component: "skill_registry", action: "refresh", target: ".atl/skill-registry.md" },
] as const;

function authorizationHarness(seed = 0) {
  let now = new Date("2026-07-28T12:00:00.000Z");
  let byte = seed;
  const service = createSessionPreparationAuthorizationServiceV1({
    now: () => now,
    randomBytes: (length) => new Uint8Array(length).fill(++byte),
  });
  const delegationDigest = buildSessionPreparationDelegationDigestV1({
    sessionIdDigest: sha256Digest(request.sessionId),
    invocationId: request.invocationId,
    agentId: "deck-init",
    activeRunnerId: request.activeRunnerId,
    projectRootDigest: request.projectRootDigest,
    needs: ["openspec", "skill_registry"],
    allowedOperations: operations,
    blockedTargets: [".git", "openspec/changes"],
  });
  const issue: SessionPreparationAuthorizationIssueInputV1 = {
    sessionId: request.sessionId,
    invocationId: request.invocationId,
    agentId: "deck-init",
    activeRunnerId: request.activeRunnerId,
    projectRootDigest: request.projectRootDigest,
    delegationDigest,
    needs: ["openspec", "skill_registry"],
    allowedOperations: operations,
    blockedTargets: [".git", "openspec/changes"],
  };
  const expected: SessionPreparationAuthorizationExpectationV1 = {
    ...issue,
    component: "skill_registry",
    action: "refresh",
    target: ".atl/skill-registry.md",
  };
  return { service, issue, expected, setNow: (value: string) => { now = new Date(value); } };
}

describe("session preparation request and once-per-session state", () => {
  test("parses all registry and OpenSpec classifications without deriving authority", () => {
    for (const status of ["ready", "missing", "stale", "invalid", "indeterminate"] as const) {
      const parsed = parseSessionPreparationRequestV1({
        ...request,
        skillDiscoveryContext: { ...request.skillDiscoveryContext, status },
      });
      expect(parsed.skillDiscoveryContext.status).toBe(status);
    }
    for (const openSpecStatus of ["initialized", "missing", "unreadable", "malformed", "uninitialized"] as const) {
      expect(parseSessionPreparationRequestV1({ ...request, openSpecStatus }).openSpecStatus).toBe(openSpecStatus);
    }
    expect(() => parseSessionPreparationRequestV1({ ...request, authority: "prompt-supplied" })).toThrow();
  });

  test("plans no delegation when ready and exactly one combined delegation when needed", () => {
    const ready = createSessionPreparationStateV1().prepare(request);
    expect(ready).toMatchObject({ status: "not_needed", shouldDelegate: false, needs: [] });

    const state = createSessionPreparationStateV1();
    const needed = state.prepare({
      ...request,
      openSpecStatus: "missing",
      skillDiscoveryContext: { ...request.skillDiscoveryContext, status: "stale" },
    });
    expect(needed).toMatchObject({ status: "delegated", shouldDelegate: true, needs: ["openspec", "skill_registry"] });
    expect(state.prepare({
      ...request,
      openSpecStatus: "missing",
      skillDiscoveryContext: { ...request.skillDiscoveryContext, status: "stale" },
    })).toEqual(needed);
    expect(createSessionPreparationStateV1().prepare({ ...request, openSpecStatus: "malformed" })).toMatchObject({ status: "blocked", code: "PREPARATION_OPENSPEC_UNSAFE" });
  });

  test("root or runner changes fail closed and cleanup permits only a new session record", () => {
    const state = createSessionPreparationStateV1();
    state.prepare(request);
    expect(state.prepare({ ...request, projectRootDigest: digest("3") })).toMatchObject({ status: "blocked", code: "PREPARATION_ROOT_MISMATCH" });
    const piRequest = { ...request, activeRunnerId: "pi", skillDiscoveryContext: { ...request.skillDiscoveryContext, active_runner_id: "pi" } };
    expect(state.prepare(piRequest)).toMatchObject({ status: "blocked", code: "PREPARATION_RUNNER_MISMATCH" });
    state.clear(request.sessionId);
    expect(state.prepare(piRequest)).toMatchObject({ status: "not_needed" });
  });

  test("records one identity-bound terminal handoff monotonically", () => {
    const state = createSessionPreparationStateV1();
    state.prepare({ ...request, openSpecStatus: "missing" });
    const handoff = aggregateDeckPreparationHandoffV1({
      kind: "deck-preparation-handoff-v1",
      sessionIdDigest: sha256Digest(request.sessionId),
      invocationId: request.invocationId,
      projectRootDigest: request.projectRootDigest,
      activeRunnerId: request.activeRunnerId,
      delegationDigest: digest("6"),
      authorityReferenceDigest: digest("7"),
      dependencyDigest: digest("8"),
      components: [{ id: "openspec", status: "changed", reasonCode: "initialized" }],
      skillDiscoveryContext: request.skillDiscoveryContext,
      nextActions: [],
      telemetry: { durationBucket: "under_1s", requestedEffects: 1, committedEffects: 1, noOpEffects: 0, rejectedEffects: 0 },
      blockers: [],
    });
    expect(state.complete(request.sessionId, handoff)).toMatchObject({ accepted: true, handoff: { preparationStatus: "completed" } });
    expect(state.complete(request.sessionId, handoff)).toMatchObject({ accepted: true });
    expect(state.complete(request.sessionId, { ...handoff, invocationId: "other" })).toEqual({ accepted: false, code: "PREPARATION_RESULT_MISMATCH" });
  });
});

describe("trusted one-use preparation authorization", () => {
  test("accepts and atomically reserves one exact matching operation", () => {
    const { service, issue, expected } = authorizationHarness();
    const envelope = service.issue(issue);
    expect(service.validateAndReserve(envelope, expected)).toMatchObject({ accepted: true });
    expect(service.validateAndReserve(envelope, expected)).toEqual({ accepted: false, code: "AUTHZ_REPLAYED" });
  });

  test("fails closed for absence, malformed proof, expiry, future, restart, and revocation", () => {
    const missing = authorizationHarness();
    expect(missing.service.validateAndReserve(undefined, missing.expected)).toEqual({ accepted: false, code: "AUTHZ_MISSING" });
    expect(missing.service.validateAndReserve({}, missing.expected)).toEqual({ accepted: false, code: "AUTHZ_MALFORMED" });

    const expired = authorizationHarness();
    const expiredEnvelope = expired.service.issue(expired.issue);
    expired.setNow("2026-07-28T12:05:00.000Z");
    expect(expired.service.validateAndReserve(expiredEnvelope, expired.expected)).toEqual({ accepted: false, code: "AUTHZ_EXPIRED" });

    const future = authorizationHarness();
    const futureEnvelope = future.service.issue(future.issue);
    future.setNow("2026-07-28T11:59:29.999Z");
    expect(future.service.validateAndReserve(futureEnvelope, future.expected)).toEqual({ accepted: false, code: "AUTHZ_FUTURE" });

    const firstProcess = authorizationHarness();
    const restartedEnvelope = firstProcess.service.issue(firstProcess.issue);
    const secondProcess = authorizationHarness(10);
    expect(secondProcess.service.validateAndReserve(restartedEnvelope, secondProcess.expected)).toEqual({ accepted: false, code: "AUTHZ_RESTARTED" });

    const revoked = authorizationHarness();
    const revokedEnvelope = revoked.service.issue(revoked.issue);
    revoked.service.revoke(revokedEnvelope.claims.authorizationId);
    expect(revoked.service.validateAndReserve(revokedEnvelope, revoked.expected)).toEqual({ accepted: false, code: "AUTHZ_REVOKED" });

    expect(consumeSessionPreparationAuthorizationV1(undefined, revokedEnvelope, revoked.expected)).toEqual({ accepted: false, code: "AUTHZ_PROVIDER_MISSING" });
  });

  test("rejects tampering and every bound identity, operation, and target mismatch", () => {
    const cases: [string, (value: SessionPreparationAuthorizationExpectationV1) => SessionPreparationAuthorizationExpectationV1, SessionPreparationAuthorizationRejectionCodeV1][] = [
      ["session", (value) => ({ ...value, sessionId: "session-2" }), "AUTHZ_SESSION_MISMATCH"],
      ["invocation", (value) => ({ ...value, invocationId: "invocation-2" }), "AUTHZ_INVOCATION_MISMATCH"],
      ["role", (value) => ({ ...value, agentId: "not-deck-init" as "deck-init" }), "AUTHZ_AGENT_MISMATCH"],
      ["runner", (value) => ({ ...value, activeRunnerId: "pi" }), "AUTHZ_RUNNER_MISMATCH"],
      ["root", (value) => ({ ...value, projectRootDigest: digest("4") }), "AUTHZ_ROOT_MISMATCH"],
      ["delegation", (value) => ({ ...value, delegationDigest: digest("5") }), "AUTHZ_DELEGATION_MISMATCH"],
      ["needs", (value) => ({ ...value, needs: ["skill_registry"] }), "AUTHZ_NEEDS_MISMATCH"],
      ["operations", (value) => ({ ...value, allowedOperations: [operations[0]] }), "AUTHZ_OPERATION_SET_MISMATCH"],
      ["blocked targets", (value) => ({ ...value, blockedTargets: [".git"] }), "AUTHZ_BLOCKED_TARGET_SET_MISMATCH"],
      ["component", (value) => ({ ...value, component: "openspec" }), "AUTHZ_OPERATION_MISMATCH"],
      ["action", (value) => ({ ...value, action: "inspect" }), "AUTHZ_OPERATION_MISMATCH"],
      ["target", (value) => ({ ...value, target: "openspec/config.yaml" }), "AUTHZ_TARGET_MISMATCH"],
    ];
    for (const [, mutate, code] of cases) {
      const { service, issue, expected } = authorizationHarness();
      expect(service.validateAndReserve(service.issue(issue), mutate(expected))).toEqual({ accepted: false, code });
    }

    const tampered = authorizationHarness();
    const envelope = tampered.service.issue(tampered.issue);
    expect(tampered.service.validateAndReserve({ ...envelope, proof: { ...envelope.proof, value: "A".repeat(43) } }, tampered.expected)).toEqual({ accepted: false, code: "AUTHZ_PROOF_INVALID" });
    expect(() => tampered.service.issue(tampered.issue, 300_001)).toThrow();

    const blocked = authorizationHarness();
    const blockedTargets = [".atl"];
    const blockedDelegationDigest = buildSessionPreparationDelegationDigestV1({
      sessionIdDigest: sha256Digest(blocked.issue.sessionId),
      invocationId: blocked.issue.invocationId,
      agentId: blocked.issue.agentId,
      activeRunnerId: blocked.issue.activeRunnerId,
      projectRootDigest: blocked.issue.projectRootDigest,
      needs: blocked.issue.needs,
      allowedOperations: blocked.issue.allowedOperations,
      blockedTargets,
    });
    const blockedIssue = { ...blocked.issue, blockedTargets, delegationDigest: blockedDelegationDigest };
    const blockedExpected = { ...blocked.expected, blockedTargets, delegationDigest: blockedDelegationDigest };
    expect(blocked.service.validateAndReserve(blocked.service.issue(blockedIssue), blockedExpected)).toEqual({ accepted: false, code: "AUTHZ_BLOCKED_TARGET" });
  });
});

describe("bounded handoff parsing and deterministic aggregation", () => {
  const component = (id: string, status: DeckPreparationComponentStatusV1) => ({ id, status, reasonCode: `${id}_${status}` });
  const base = {
    kind: "deck-preparation-handoff-v1" as const,
    sessionIdDigest: digest("2"),
    invocationId: request.invocationId,
    projectRootDigest: request.projectRootDigest,
    activeRunnerId: request.activeRunnerId,
    delegationDigest: digest("6"),
    authorityReferenceDigest: digest("7"),
    dependencyDigest: digest("8"),
    skillDiscoveryContext: request.skillDiscoveryContext,
    nextActions: [],
    blockers: [],
    telemetry: { durationBucket: "under_1s" as const, requestedEffects: 0, committedEffects: 0, noOpEffects: 2, rejectedEffects: 0 },
  };

  test("aggregates completed, partial, and blocked results with stable ordering and legacy outcomes", () => {
    expect(aggregateDeckPreparationHandoffV1({ ...base, components: [component("registry", "unchanged"), component("openspec", "unchanged")] })).toMatchObject({ preparationStatus: "completed", continueToTriage: true, legacyOutcome: "already-initialized", components: [{ id: "openspec" }, { id: "registry" }] });
    expect(aggregateDeckPreparationHandoffV1({ ...base, components: [component("openspec", "ready"), component("serena", "unavailable")], nextActions: [{ kind: "tui_capability_setup", componentId: "serena" }] })).toMatchObject({ preparationStatus: "partial", continueToTriage: true, legacyOutcome: "failed" });
    expect(aggregateDeckPreparationHandoffV1({ ...base, components: [component("openspec", "blocked")] })).toMatchObject({ preparationStatus: "blocked", continueToTriage: false, legacyOutcome: "failed" });
  });

  test("rejects unbounded or identity-mismatched handoff data", () => {
    const valid = aggregateDeckPreparationHandoffV1({ ...base, components: [component("openspec", "ready")] });
    expect(parseDeckPreparationHandoffV1(valid)).toEqual(valid);
    expect(() => parseDeckPreparationHandoffV1({ ...valid, rawOutput: "secret" })).toThrow();
    expect(() => aggregateDeckPreparationHandoffV1({ ...base, components: Array.from({ length: 33 }, (_, index) => component(`c${index}`, "ready")) })).toThrow();
    expect(() => aggregateDeckPreparationHandoffV1({ ...base, components: [component("openspec", "ready")], nextActions: [{ kind: "tui_capability_setup", componentId: "/home/user/secret" }] })).toThrow();
  });
});
