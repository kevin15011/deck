import { createHash, createHmac, createSecretKey, randomBytes as secureRandomBytes, timingSafeEqual } from "node:crypto";
import {
  assertDigest,
  assertExactKeys,
  canonicalJson,
  deepFreeze,
  sha256Digest,
  type Sha256Digest,
} from "../contracts/canonical";

const MAXIMUM_LIFETIME_MS = 300_000;
const MAXIMUM_CLOCK_SKEW_MS = 30_000;
const MAX_COMPONENTS = 32;
const MAX_NEXT_ACTIONS = 16;
const MAX_BLOCKERS = 16;

export type SkillRegistryStatusV1 = "ready" | "missing" | "stale" | "invalid" | "indeterminate";
export type OpenSpecPreparationStatusV1 = "initialized" | "missing" | "unreadable" | "malformed" | "uninitialized";
export type SessionPreparationNeedV1 = "openspec" | "skill_registry";
export type DeckPreparationComponentStatusV1 = "ready" | "changed" | "unchanged" | "unavailable" | "skipped" | "blocked";

export interface SkillDiscoveryContextV1 {
  readonly registry_path: string;
  readonly status: SkillRegistryStatusV1;
  readonly reason_code: string;
  readonly guidance: string;
  readonly active_runner_id: string;
  readonly authority_reminder_version: string;
}

export interface SessionPreparationRequestV1 {
  readonly schema: "session-preparation-request-v1";
  readonly sessionId: string;
  readonly invocationId: string;
  readonly activeRunnerId: string;
  readonly projectRootDigest: Sha256Digest;
  readonly openSpecStatus: OpenSpecPreparationStatusV1;
  readonly skillDiscoveryContext: SkillDiscoveryContextV1;
}

export type SessionPreparationOperationV1 =
  | { readonly component: "openspec"; readonly action: "inspect" | "merge"; readonly target: "openspec/config.yaml" }
  | { readonly component: "skill_registry"; readonly action: "validate" | "discover" | "refresh"; readonly target: ".atl/skill-registry.md" }
  | { readonly component: "codebase_memory"; readonly action: "index_repository"; readonly target: ".codebase-memory" }
  | { readonly component: "serena"; readonly action: "onboard_project"; readonly target: ".serena" }
  | { readonly component: `capability:${string}`; readonly action: "initialize_project"; readonly target: string }
  | { readonly component: "owned_ignore"; readonly action: "reconcile"; readonly target: ".gitignore" };

export interface SessionPreparationDelegationV1 {
  readonly sessionIdDigest: Sha256Digest;
  readonly invocationId: string;
  readonly agentId: "deck-init";
  readonly activeRunnerId: string;
  readonly projectRootDigest: Sha256Digest;
  readonly needs: readonly SessionPreparationNeedV1[];
  readonly allowedOperations: readonly SessionPreparationOperationV1[];
  readonly blockedTargets: readonly string[];
}

export interface SessionPreparationAuthorizationClaimsV1 extends SessionPreparationDelegationV1 {
  readonly schema: "session-preparation-authorization-v1";
  readonly authorizationId: `prep-authz:v1:${string}`;
  readonly delegationDigest: Sha256Digest;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly maxUses: 1;
}

export interface SessionPreparationAuthorizationEnvelopeV1 {
  readonly claims: SessionPreparationAuthorizationClaimsV1;
  readonly proof: {
    readonly algorithm: "hmac-sha256";
    readonly ephemeralKeyId: Sha256Digest;
    readonly value: string;
  };
}

export interface SessionPreparationAuthorizationIssueInputV1 extends Omit<SessionPreparationDelegationV1, "sessionIdDigest"> {
  readonly sessionId: string;
  readonly delegationDigest: Sha256Digest;
}

export interface SessionPreparationAuthorizationExpectationV1 extends SessionPreparationAuthorizationIssueInputV1 {
  readonly component: SessionPreparationOperationV1["component"];
  readonly action: string;
  readonly target: string;
}

export type SessionPreparationAuthorizationRejectionCodeV1 =
  | "AUTHZ_PROVIDER_MISSING"
  | "AUTHZ_MISSING"
  | "AUTHZ_MALFORMED"
  | "AUTHZ_PROOF_INVALID"
  | "AUTHZ_EXPIRED"
  | "AUTHZ_FUTURE"
  | "AUTHZ_LIFETIME_INVALID"
  | "AUTHZ_REPLAYED"
  | "AUTHZ_RESTARTED"
  | "AUTHZ_REVOKED"
  | "AUTHZ_SESSION_MISMATCH"
  | "AUTHZ_INVOCATION_MISMATCH"
  | "AUTHZ_AGENT_MISMATCH"
  | "AUTHZ_RUNNER_MISMATCH"
  | "AUTHZ_ROOT_MISMATCH"
  | "AUTHZ_DELEGATION_MISMATCH"
  | "AUTHZ_NEEDS_MISMATCH"
  | "AUTHZ_OPERATION_SET_MISMATCH"
  | "AUTHZ_BLOCKED_TARGET_SET_MISMATCH"
  | "AUTHZ_OPERATION_MISMATCH"
  | "AUTHZ_TARGET_MISMATCH"
  | "AUTHZ_BLOCKED_TARGET";

export type SessionPreparationAuthorizationValidationResultV1 =
  | { readonly accepted: true; readonly reference: { readonly authorizationId: string; readonly claimsDigest: Sha256Digest } }
  | { readonly accepted: false; readonly code: SessionPreparationAuthorizationRejectionCodeV1 };

export interface SessionPreparationAuthorizationServiceV1 {
  readonly ephemeralKeyId: Sha256Digest;
  issue(input: SessionPreparationAuthorizationIssueInputV1, lifetimeMs?: number): SessionPreparationAuthorizationEnvelopeV1;
  validateAndReserve(envelope: unknown, expected: SessionPreparationAuthorizationExpectationV1): SessionPreparationAuthorizationValidationResultV1;
  revoke(authorizationId: string): void;
}

export interface SessionPreparationAuthorizationServiceOptionsV1 {
  readonly now?: () => Date;
  readonly randomBytes?: (length: number) => Uint8Array;
}

export interface DeckPreparationComponentHandoffV1 {
  readonly id: string;
  readonly status: DeckPreparationComponentStatusV1;
  readonly reasonCode: string;
}

export interface DeckPreparationNextActionV1 {
  readonly kind: "tui_capability_setup" | "bounded_direct_discovery";
  readonly componentId: string;
}

export interface DeckPreparationTelemetryV1 {
  readonly durationBucket: "under_1s" | "under_10s" | "under_60s" | "over_60s";
  readonly requestedEffects: number;
  readonly committedEffects: number;
  readonly noOpEffects: number;
  readonly rejectedEffects: number;
}

export interface DeckPreparationHandoffBaseV1 {
  readonly kind: "deck-preparation-handoff-v1";
  readonly sessionIdDigest: Sha256Digest;
  readonly invocationId: string;
  readonly projectRootDigest: Sha256Digest;
  readonly activeRunnerId: string;
  readonly delegationDigest: Sha256Digest;
  readonly authorityReferenceDigest: Sha256Digest;
  readonly dependencyDigest: Sha256Digest;
  readonly components: readonly DeckPreparationComponentHandoffV1[];
  readonly skillDiscoveryContext: SkillDiscoveryContextV1;
  readonly nextActions: readonly DeckPreparationNextActionV1[];
  readonly telemetry: DeckPreparationTelemetryV1;
  readonly blockers: readonly string[];
}

export interface DeckPreparationHandoffV1 extends DeckPreparationHandoffBaseV1 {
  readonly preparationStatus: "completed" | "partial" | "blocked";
  readonly continueToTriage: boolean;
  readonly legacyOutcome: "success" | "already-initialized" | "failed";
}

export type SessionPreparationStateResultV1 =
  | { readonly status: "not_needed"; readonly shouldDelegate: false; readonly needs: readonly [] }
  | { readonly status: "delegated"; readonly shouldDelegate: true; readonly needs: readonly SessionPreparationNeedV1[] }
  | { readonly status: "blocked"; readonly shouldDelegate: false; readonly needs: readonly []; readonly code: "PREPARATION_ROOT_MISMATCH" | "PREPARATION_RUNNER_MISMATCH" | "PREPARATION_INVOCATION_MISMATCH" | "PREPARATION_OPENSPEC_UNSAFE" };

export type SessionPreparationCompletionResultV1 =
  | { readonly accepted: true; readonly handoff: DeckPreparationHandoffV1 }
  | { readonly accepted: false; readonly code: "PREPARATION_SESSION_MISSING" | "PREPARATION_NOT_DELEGATED" | "PREPARATION_RESULT_MISMATCH" };

export interface SessionPreparationStateV1 {
  prepare(value: unknown): SessionPreparationStateResultV1;
  complete(sessionId: string, handoff: unknown): SessionPreparationCompletionResultV1;
  clear(sessionId: string): void;
}

function boundedString(value: unknown, field: string, maximum = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`invalid-evidence: ${field}`);
  return value;
}

function assertSafeRelativeTarget(value: unknown, field: string): string {
  const target = boundedString(value, field, 512).replaceAll("\\", "/");
  if (target.startsWith("/") || /^[A-Za-z]:\//.test(target) || target.split("/").includes("..")) throw new Error(`invalid-evidence: ${field}`);
  return target.replace(/\/$/, "");
}

function parseSkillDiscoveryContext(value: unknown): SkillDiscoveryContextV1 {
  assertExactKeys(value, ["registry_path", "status", "reason_code", "guidance", "active_runner_id", "authority_reminder_version"], "skill discovery context fields");
  if (!["ready", "missing", "stale", "invalid", "indeterminate"].includes(String(value.status))) throw new Error("invalid-evidence: skillDiscoveryContext.status");
  return deepFreeze({
    registry_path: assertSafeRelativeTarget(value.registry_path, "skillDiscoveryContext.registry_path"),
    status: value.status as SkillRegistryStatusV1,
    reason_code: boundedString(value.reason_code, "skillDiscoveryContext.reason_code"),
    guidance: boundedString(value.guidance, "skillDiscoveryContext.guidance", 1024),
    active_runner_id: boundedString(value.active_runner_id, "skillDiscoveryContext.active_runner_id"),
    authority_reminder_version: boundedString(value.authority_reminder_version, "skillDiscoveryContext.authority_reminder_version"),
  });
}

export function parseSessionPreparationRequestV1(value: unknown): SessionPreparationRequestV1 {
  assertExactKeys(value, ["schema", "sessionId", "invocationId", "activeRunnerId", "projectRootDigest", "openSpecStatus", "skillDiscoveryContext"], "session preparation request fields");
  if (value.schema !== "session-preparation-request-v1") throw new Error("unsupported-contract-version");
  if (!["initialized", "missing", "unreadable", "malformed", "uninitialized"].includes(String(value.openSpecStatus))) throw new Error("invalid-evidence: sessionPreparation.openSpecStatus");
  assertDigest(value.projectRootDigest, "sessionPreparation.projectRootDigest");
  const skillDiscoveryContext = parseSkillDiscoveryContext(value.skillDiscoveryContext);
  const activeRunnerId = boundedString(value.activeRunnerId, "sessionPreparation.activeRunnerId");
  if (skillDiscoveryContext.active_runner_id !== activeRunnerId) throw new Error("invalid-evidence: sessionPreparation.runnerBinding");
  return deepFreeze({
    schema: "session-preparation-request-v1",
    sessionId: boundedString(value.sessionId, "sessionPreparation.sessionId"),
    invocationId: boundedString(value.invocationId, "sessionPreparation.invocationId"),
    activeRunnerId,
    projectRootDigest: value.projectRootDigest,
    openSpecStatus: value.openSpecStatus as OpenSpecPreparationStatusV1,
    skillDiscoveryContext,
  });
}

function parseNeeds(value: unknown): readonly SessionPreparationNeedV1[] {
  if (!Array.isArray(value) || value.length > 2 || value.some((need) => need !== "openspec" && need !== "skill_registry")) throw new Error("invalid-evidence: authorization.needs");
  const needs = [...new Set(value as SessionPreparationNeedV1[])].sort();
  if (needs.length !== value.length) throw new Error("invalid-evidence: authorization.needs");
  return deepFreeze(needs);
}

function parseOperation(value: unknown): SessionPreparationOperationV1 {
  assertExactKeys(value, ["component", "action", "target"], "preparation operation fields");
  const component = boundedString(value.component, "operation.component");
  const action = boundedString(value.action, "operation.action");
  const target = assertSafeRelativeTarget(value.target, "operation.target");
  const exact = (expectedComponent: string, actions: readonly string[], expectedTarget: string) => component === expectedComponent && actions.includes(action) && target === expectedTarget;
  const valid = exact("openspec", ["inspect", "merge"], "openspec/config.yaml")
    || exact("skill_registry", ["validate", "discover", "refresh"], ".atl/skill-registry.md")
    || exact("codebase_memory", ["index_repository"], ".codebase-memory")
    || exact("serena", ["onboard_project"], ".serena")
    || exact("owned_ignore", ["reconcile"], ".gitignore")
    || (/^capability:[a-z0-9][a-z0-9-]{0,63}$/.test(component) && action === "initialize_project");
  if (!valid) throw new Error("invalid-evidence: authorization.operation");
  return deepFreeze({ component, action, target }) as SessionPreparationOperationV1;
}

function parseOperations(value: unknown): readonly SessionPreparationOperationV1[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COMPONENTS) throw new Error("invalid-evidence: authorization.allowedOperations");
  const operations = value.map(parseOperation).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  if (new Set(operations.map(canonicalJson)).size !== operations.length) throw new Error("invalid-evidence: authorization.allowedOperations");
  return deepFreeze(operations);
}

function parseBlockedTargets(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_BLOCKERS) throw new Error("invalid-evidence: authorization.blockedTargets");
  const targets = value.map((target, index) => assertSafeRelativeTarget(target, `authorization.blockedTargets[${index}]`)).sort();
  if (new Set(targets).size !== targets.length) throw new Error("invalid-evidence: authorization.blockedTargets");
  return deepFreeze(targets);
}

function parseDelegation(value: SessionPreparationDelegationV1): SessionPreparationDelegationV1 {
  assertDigest(value.sessionIdDigest, "delegation.sessionIdDigest");
  assertDigest(value.projectRootDigest, "delegation.projectRootDigest");
  if (value.agentId !== "deck-init") throw new Error("invalid-evidence: delegation.agentId");
  return deepFreeze({
    sessionIdDigest: value.sessionIdDigest,
    invocationId: boundedString(value.invocationId, "delegation.invocationId"),
    agentId: "deck-init",
    activeRunnerId: boundedString(value.activeRunnerId, "delegation.activeRunnerId"),
    projectRootDigest: value.projectRootDigest,
    needs: parseNeeds(value.needs),
    allowedOperations: parseOperations(value.allowedOperations),
    blockedTargets: parseBlockedTargets(value.blockedTargets),
  });
}

export function buildSessionPreparationDelegationDigestV1(value: SessionPreparationDelegationV1): Sha256Digest {
  return sha256Digest(parseDelegation(value));
}

function parseEnvelope(value: unknown): SessionPreparationAuthorizationEnvelopeV1 {
  assertExactKeys(value, ["claims", "proof"], "preparation authorization envelope fields");
  assertExactKeys(value.claims, ["schema", "authorizationId", "sessionIdDigest", "invocationId", "agentId", "activeRunnerId", "projectRootDigest", "delegationDigest", "needs", "allowedOperations", "blockedTargets", "issuedAt", "expiresAt", "nonce", "maxUses"], "preparation authorization claims fields");
  if (value.claims.schema !== "session-preparation-authorization-v1" || value.claims.maxUses !== 1) throw new Error("unsupported-contract-version");
  if (typeof value.claims.authorizationId !== "string" || !/^prep-authz:v1:[a-f0-9]{32}$/.test(value.claims.authorizationId)) throw new Error("invalid-evidence: authorization.authorizationId");
  assertDigest(value.claims.delegationDigest, "authorization.delegationDigest");
  const delegation = parseDelegation(value.claims as unknown as SessionPreparationDelegationV1);
  const issuedAt = boundedString(value.claims.issuedAt, "authorization.issuedAt");
  const expiresAt = boundedString(value.claims.expiresAt, "authorization.expiresAt");
  const nonce = boundedString(value.claims.nonce, "authorization.nonce");
  assertExactKeys(value.proof, ["algorithm", "ephemeralKeyId", "value"], "preparation authorization proof fields");
  if (value.proof.algorithm !== "hmac-sha256") throw new Error("unsupported-contract-version");
  assertDigest(value.proof.ephemeralKeyId, "authorization.proof.ephemeralKeyId");
  if (typeof value.proof.value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.proof.value)) throw new Error("invalid-evidence: authorization.proof.value");
  return deepFreeze({
    claims: { schema: "session-preparation-authorization-v1", authorizationId: value.claims.authorizationId as `prep-authz:v1:${string}`, ...delegation, delegationDigest: value.claims.delegationDigest, issuedAt, expiresAt, nonce, maxUses: 1 },
    proof: { algorithm: "hmac-sha256", ephemeralKeyId: value.proof.ephemeralKeyId, value: value.proof.value },
  });
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function pathsIntersect(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function denied(code: SessionPreparationAuthorizationRejectionCodeV1): SessionPreparationAuthorizationValidationResultV1 {
  return { accepted: false, code };
}

export function createSessionPreparationAuthorizationServiceV1(options: SessionPreparationAuthorizationServiceOptionsV1 = {}): SessionPreparationAuthorizationServiceV1 {
  const now = options.now ?? (() => new Date());
  const randomBytes = options.randomBytes ?? ((length: number) => secureRandomBytes(length));
  const draw = (length: number, field: string) => {
    const bytes = Buffer.from(randomBytes(length));
    if (bytes.length !== length) throw new Error(`invalid-evidence: ${field}`);
    return bytes;
  };
  const keyBytes = draw(32, "authorization.key");
  const ephemeralKeyId = `sha256:${createHash("sha256").update(keyBytes).digest("hex")}` as Sha256Digest;
  const key = createSecretKey(keyBytes);
  keyBytes.fill(0);
  const consumedNonces = new Set<string>();
  const revokedAuthorizationIds = new Set<string>();
  const sign = (claims: SessionPreparationAuthorizationClaimsV1) => createHmac("sha256", key).update(canonicalJson(claims), "utf8").digest("base64url");

  function issue(input: SessionPreparationAuthorizationIssueInputV1, lifetimeMs = MAXIMUM_LIFETIME_MS): SessionPreparationAuthorizationEnvelopeV1 {
    if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > MAXIMUM_LIFETIME_MS) throw new Error("invalid-evidence: authorization.lifetimeMs");
    const issued = now();
    if (!(issued instanceof Date) || Number.isNaN(issued.valueOf())) throw new Error("invalid-evidence: authorization.now");
    assertDigest(input.delegationDigest, "authorization.delegationDigest");
    const delegation = parseDelegation({ ...input, sessionIdDigest: sha256Digest(boundedString(input.sessionId, "authorization.sessionId")) });
    if (buildSessionPreparationDelegationDigestV1(delegation) !== input.delegationDigest) throw new Error("invalid-evidence: authorization.delegationDigest");
    const claims: SessionPreparationAuthorizationClaimsV1 = deepFreeze({
      schema: "session-preparation-authorization-v1",
      authorizationId: `prep-authz:v1:${draw(16, "authorization.id").toString("hex")}`,
      ...delegation,
      delegationDigest: input.delegationDigest,
      issuedAt: issued.toISOString(),
      expiresAt: new Date(issued.valueOf() + lifetimeMs).toISOString(),
      nonce: draw(32, "authorization.nonce").toString("hex"),
      maxUses: 1,
    });
    return deepFreeze({ claims, proof: { algorithm: "hmac-sha256", ephemeralKeyId, value: sign(claims) } });
  }

  function validateAndReserve(envelopeValue: unknown, expected: SessionPreparationAuthorizationExpectationV1): SessionPreparationAuthorizationValidationResultV1 {
    if (envelopeValue === undefined || envelopeValue === null) return denied("AUTHZ_MISSING");
    let envelope: SessionPreparationAuthorizationEnvelopeV1;
    try { envelope = parseEnvelope(envelopeValue); } catch { return denied("AUTHZ_MALFORMED"); }
    if (envelope.proof.ephemeralKeyId !== ephemeralKeyId) return denied("AUTHZ_RESTARTED");
    const supplied = Buffer.from(envelope.proof.value, "utf8");
    const signed = Buffer.from(sign(envelope.claims), "utf8");
    if (supplied.length !== signed.length || !timingSafeEqual(supplied, signed)) return denied("AUTHZ_PROOF_INVALID");
    const current = now();
    const currentTime = current instanceof Date ? current.valueOf() : Number.NaN;
    const issuedAt = Date.parse(envelope.claims.issuedAt);
    const expiresAt = Date.parse(envelope.claims.expiresAt);
    if (![currentTime, issuedAt, expiresAt].every(Number.isFinite)) return denied("AUTHZ_MALFORMED");
    if (expiresAt - issuedAt > MAXIMUM_LIFETIME_MS) return denied("AUTHZ_LIFETIME_INVALID");
    if (issuedAt - currentTime > MAXIMUM_CLOCK_SKEW_MS) return denied("AUTHZ_FUTURE");
    if (currentTime >= expiresAt) return denied("AUTHZ_EXPIRED");
    if (revokedAuthorizationIds.has(envelope.claims.authorizationId)) return denied("AUTHZ_REVOKED");
    if (consumedNonces.has(envelope.claims.nonce)) return denied("AUTHZ_REPLAYED");
    if (envelope.claims.sessionIdDigest !== sha256Digest(expected.sessionId)) return denied("AUTHZ_SESSION_MISMATCH");
    if (envelope.claims.invocationId !== expected.invocationId) return denied("AUTHZ_INVOCATION_MISMATCH");
    if (envelope.claims.agentId !== expected.agentId) return denied("AUTHZ_AGENT_MISMATCH");
    if (envelope.claims.activeRunnerId !== expected.activeRunnerId) return denied("AUTHZ_RUNNER_MISMATCH");
    if (envelope.claims.projectRootDigest !== expected.projectRootDigest) return denied("AUTHZ_ROOT_MISMATCH");
    if (envelope.claims.delegationDigest !== expected.delegationDigest) return denied("AUTHZ_DELEGATION_MISMATCH");
    if (!same(envelope.claims.needs, parseNeeds(expected.needs))) return denied("AUTHZ_NEEDS_MISMATCH");
    let expectedOperations: readonly SessionPreparationOperationV1[];
    let expectedBlockedTargets: readonly string[];
    try {
      expectedOperations = parseOperations(expected.allowedOperations);
      expectedBlockedTargets = parseBlockedTargets(expected.blockedTargets);
    } catch { return denied("AUTHZ_MALFORMED"); }
    if (!same(envelope.claims.allowedOperations, expectedOperations)) return denied("AUTHZ_OPERATION_SET_MISMATCH");
    if (!same(envelope.claims.blockedTargets, expectedBlockedTargets)) return denied("AUTHZ_BLOCKED_TARGET_SET_MISMATCH");
    const sameOperation = envelope.claims.allowedOperations.find((operation) => operation.component === expected.component && operation.action === expected.action);
    if (!sameOperation) return denied("AUTHZ_OPERATION_MISMATCH");
    const expectedTarget = (() => { try { return assertSafeRelativeTarget(expected.target, "authorization.expectedTarget"); } catch { return undefined; } })();
    if (!expectedTarget || sameOperation.target !== expectedTarget) return denied("AUTHZ_TARGET_MISMATCH");
    if (envelope.claims.blockedTargets.some((blocked) => pathsIntersect(expectedTarget, blocked))) return denied("AUTHZ_BLOCKED_TARGET");
    consumedNonces.add(envelope.claims.nonce);
    return { accepted: true, reference: { authorizationId: envelope.claims.authorizationId, claimsDigest: sha256Digest(envelope.claims) } };
  }

  function revoke(authorizationId: string): void {
    if (!/^prep-authz:v1:[a-f0-9]{32}$/.test(authorizationId)) throw new Error("invalid-evidence: authorization.authorizationId");
    revokedAuthorizationIds.add(authorizationId);
  }

  return Object.freeze({ ephemeralKeyId, issue, validateAndReserve, revoke });
}

export function consumeSessionPreparationAuthorizationV1(service: SessionPreparationAuthorizationServiceV1 | undefined, envelope: unknown, expected: SessionPreparationAuthorizationExpectationV1): SessionPreparationAuthorizationValidationResultV1 {
  return service ? service.validateAndReserve(envelope, expected) : denied("AUTHZ_PROVIDER_MISSING");
}

export function createSessionPreparationStateV1(): SessionPreparationStateV1 {
  const records = new Map<string, { request: SessionPreparationRequestV1; result: SessionPreparationStateResultV1; handoff?: DeckPreparationHandoffV1 }>();
  function prepare(value: unknown): SessionPreparationStateResultV1 {
    const request = parseSessionPreparationRequestV1(value);
    const prior = records.get(request.sessionId);
    if (prior) {
      if (prior.request.projectRootDigest !== request.projectRootDigest) return { status: "blocked", shouldDelegate: false, needs: [], code: "PREPARATION_ROOT_MISMATCH" };
      if (prior.request.activeRunnerId !== request.activeRunnerId) return { status: "blocked", shouldDelegate: false, needs: [], code: "PREPARATION_RUNNER_MISMATCH" };
      if (prior.request.invocationId !== request.invocationId) return { status: "blocked", shouldDelegate: false, needs: [], code: "PREPARATION_INVOCATION_MISMATCH" };
      return prior.result;
    }
    const needs: SessionPreparationNeedV1[] = [];
    if (request.openSpecStatus !== "initialized") needs.push("openspec");
    if (request.skillDiscoveryContext.status !== "ready") needs.push("skill_registry");
    const result: SessionPreparationStateResultV1 = request.openSpecStatus === "malformed" || request.openSpecStatus === "unreadable"
      ? { status: "blocked", shouldDelegate: false, needs: [], code: "PREPARATION_OPENSPEC_UNSAFE" }
      : needs.length === 0
      ? { status: "not_needed", shouldDelegate: false, needs: [] }
      : { status: "delegated", shouldDelegate: true, needs: deepFreeze(needs) };
    records.set(request.sessionId, { request, result: deepFreeze(result) });
    return result;
  }
  function complete(sessionIdValue: string, handoffValue: unknown): SessionPreparationCompletionResultV1 {
    const sessionId = boundedString(sessionIdValue, "sessionPreparation.sessionId");
    const record = records.get(sessionId);
    if (!record) return { accepted: false, code: "PREPARATION_SESSION_MISSING" };
    if (record.result.status !== "delegated") return { accepted: false, code: "PREPARATION_NOT_DELEGATED" };
    let handoff: DeckPreparationHandoffV1;
    try { handoff = parseDeckPreparationHandoffV1(handoffValue); } catch { return { accepted: false, code: "PREPARATION_RESULT_MISMATCH" }; }
    if (handoff.sessionIdDigest !== sha256Digest(sessionId)
      || handoff.invocationId !== record.request.invocationId
      || handoff.projectRootDigest !== record.request.projectRootDigest
      || handoff.activeRunnerId !== record.request.activeRunnerId) return { accepted: false, code: "PREPARATION_RESULT_MISMATCH" };
    if (record.handoff && !same(record.handoff, handoff)) return { accepted: false, code: "PREPARATION_RESULT_MISMATCH" };
    record.handoff ??= handoff;
    return { accepted: true, handoff: record.handoff };
  }
  function clear(sessionId: string): void { records.delete(boundedString(sessionId, "sessionPreparation.sessionId")); }
  return Object.freeze({ prepare, complete, clear });
}

function parseComponent(value: unknown): DeckPreparationComponentHandoffV1 {
  assertExactKeys(value, ["id", "status", "reasonCode"], "preparation component fields");
  const id = boundedString(value.id, "component.id");
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) throw new Error("invalid-evidence: component.id");
  if (!["ready", "changed", "unchanged", "unavailable", "skipped", "blocked"].includes(String(value.status))) throw new Error("invalid-evidence: component.status");
  return deepFreeze({ id, status: value.status as DeckPreparationComponentStatusV1, reasonCode: boundedString(value.reasonCode, "component.reasonCode") });
}

function parseNextAction(value: unknown): DeckPreparationNextActionV1 {
  assertExactKeys(value, ["kind", "componentId"], "preparation next action fields");
  if (value.kind !== "tui_capability_setup" && value.kind !== "bounded_direct_discovery") throw new Error("invalid-evidence: nextAction.kind");
  const componentId = boundedString(value.componentId, "nextAction.componentId");
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(componentId)) throw new Error("invalid-evidence: nextAction.componentId");
  return deepFreeze({ kind: value.kind, componentId });
}

function parseTelemetry(value: unknown): DeckPreparationTelemetryV1 {
  assertExactKeys(value, ["durationBucket", "requestedEffects", "committedEffects", "noOpEffects", "rejectedEffects"], "preparation telemetry fields");
  if (!["under_1s", "under_10s", "under_60s", "over_60s"].includes(String(value.durationBucket))) throw new Error("invalid-evidence: telemetry.durationBucket");
  const counts = [value.requestedEffects, value.committedEffects, value.noOpEffects, value.rejectedEffects];
  if (counts.some((count) => !Number.isSafeInteger(count) || Number(count) < 0 || Number(count) > 10_000)) throw new Error("invalid-evidence: telemetry.effectCount");
  return deepFreeze(value as unknown as DeckPreparationTelemetryV1);
}

function parseHandoffBase(value: unknown, includeOutcome: boolean): DeckPreparationHandoffBaseV1 {
  const outcomeKeys = includeOutcome ? ["preparationStatus", "continueToTriage", "legacyOutcome"] : [];
  assertExactKeys(value, ["kind", ...outcomeKeys, "sessionIdDigest", "invocationId", "projectRootDigest", "activeRunnerId", "delegationDigest", "authorityReferenceDigest", "dependencyDigest", "components", "skillDiscoveryContext", "nextActions", "telemetry", "blockers"], "preparation handoff fields");
  if (value.kind !== "deck-preparation-handoff-v1") throw new Error("unsupported-contract-version");
  for (const field of ["sessionIdDigest", "projectRootDigest", "delegationDigest", "authorityReferenceDigest", "dependencyDigest"] as const) assertDigest(value[field], `handoff.${field}`);
  if (!Array.isArray(value.components) || value.components.length > MAX_COMPONENTS) throw new Error("invalid-evidence: handoff.components");
  if (!Array.isArray(value.nextActions) || value.nextActions.length > MAX_NEXT_ACTIONS) throw new Error("invalid-evidence: handoff.nextActions");
  if (!Array.isArray(value.blockers) || value.blockers.length > MAX_BLOCKERS) throw new Error("invalid-evidence: handoff.blockers");
  const components = value.components.map(parseComponent).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(components.map(({ id }) => id)).size !== components.length) throw new Error("invalid-evidence: handoff.components");
  const nextActions = value.nextActions.map(parseNextAction).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  const blockers = value.blockers.map((blocker, index) => boundedString(blocker, `handoff.blockers[${index}]`)).sort();
  return deepFreeze({
    kind: "deck-preparation-handoff-v1",
    sessionIdDigest: value.sessionIdDigest as Sha256Digest,
    invocationId: boundedString(value.invocationId, "handoff.invocationId"),
    projectRootDigest: value.projectRootDigest as Sha256Digest,
    activeRunnerId: boundedString(value.activeRunnerId, "handoff.activeRunnerId"),
    delegationDigest: value.delegationDigest as Sha256Digest,
    authorityReferenceDigest: value.authorityReferenceDigest as Sha256Digest,
    dependencyDigest: value.dependencyDigest as Sha256Digest,
    components,
    skillDiscoveryContext: parseSkillDiscoveryContext(value.skillDiscoveryContext),
    nextActions,
    telemetry: parseTelemetry(value.telemetry),
    blockers,
  });
}

export function aggregateDeckPreparationHandoffV1(value: DeckPreparationHandoffBaseV1): DeckPreparationHandoffV1 {
  const base = parseHandoffBase(value, false);
  const openSpec = base.components.find(({ id }) => id === "openspec");
  const hardBlocked = base.blockers.length > 0 || openSpec?.status === "blocked" || base.components.some(({ id, status }) => status === "blocked" && id !== "registry" && id !== "skill_registry");
  const partial = !hardBlocked && base.components.some(({ status }) => status === "unavailable" || status === "blocked");
  const preparationStatus = hardBlocked ? "blocked" : partial ? "partial" : "completed";
  const allUnchanged = base.components.length > 0 && base.components.every(({ status }) => status === "unchanged");
  return deepFreeze({
    preparationStatus,
    continueToTriage: preparationStatus !== "blocked",
    legacyOutcome: preparationStatus === "completed" ? (allUnchanged ? "already-initialized" : "success") : "failed",
    ...base,
  });
}

export function parseDeckPreparationHandoffV1(value: unknown): DeckPreparationHandoffV1 {
  const base = parseHandoffBase(value, true);
  const aggregated = aggregateDeckPreparationHandoffV1(base);
  const candidate = value as Record<string, unknown>;
  if (candidate.preparationStatus !== aggregated.preparationStatus || candidate.continueToTriage !== aggregated.continueToTriage || candidate.legacyOutcome !== aggregated.legacyOutcome) throw new Error("invalid-evidence: handoff.aggregation");
  return aggregated;
}
