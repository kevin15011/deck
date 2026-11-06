import { discoverSharedSkillCatalog, refreshSharedSkillCatalogView } from "../../../core/src/skill-discovery/shared";
import { preparationAuthorityScope, observedPreparationCapabilities } from "@deck/core/session/preparation";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, mkdirSync, linkSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parsePreparationRequest, type PreparationDelegation, type PreparationInvocation, type PreparationObservation, type PreparationPort, type PreparationScope, type PreparationSnapshot } from "@deck/core/session/preparation";
import type { SkillDiscoverySourceProviderV1 } from "@deck/core";
import { createCoreGenericProjectSources, discoverSkills } from "../../../core/src/skill-discovery/discovery";
import { canonicalizeSkillRegistry, computeSkillRegistrySourceScopeHash, parseSkillRegistryDocument } from "../../../core/src/skill-discovery/registry";
import { createSkillRegistryWriteAuthority, createSkillRegistryWriter, declaresNewerSkillRegistrySchema, POSIX_ATOMIC_REPLACE_PORT_V1 } from "../../../core/src/skill-discovery/persistence";
import { SKILL_DISCOVERY_V1_BOUNDS } from "../../../core/src/skill-discovery/contracts";
import { migrateRetiredTestingPolicy } from "./retired-testing-policy";

import { planOpenSpecInitialization } from "./openspec-repair";

const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const CLEANUP = "retired-testing-policy";
const TARGET = "openspec/config.yaml";
const REGISTRY = ".atl/skill-registry.md";
const locks = new Map<string, Promise<void>>();
/** Trusted adapter binding, never a tool argument. Production supplies none until index evidence
 * and a project-scoped initializer have been proven. This bounded lane is synchronous only. */
export type IndexInitializerBinding = {
  bindingId: string; projectRoot: string; backendId: string; generation: string;
  inputDigest: string; validUntil: number; status: "ready" | "needs-index";
  expectedPostDigest: string;
  initializeProjectSync(projectRoot: string): undefined;
};
const indexDigest = (binding: IndexInitializerBinding) => hash(JSON.stringify([binding.projectRoot, binding.bindingId, binding.backendId, binding.generation, binding.inputDigest]));
const policyEvidence = new Map<string, ReturnType<typeof migrateRetiredTestingPolicy>>();
function inspectPolicy(root: string, source: string) {
  const key = hash(`${root}\0${source}`);
  const previous = policyEvidence.get(key);
  if (previous) return previous;
  const result = Object.freeze(migrateRetiredTestingPolicy(source));
  policyEvidence.set(key, result);
  if (policyEvidence.size > 64) policyEvidence.delete(policyEvidence.keys().next().value!);
  return result;
}
function boundedDiff(before: string, after: string): string {
  const a = before.split("\n"), b = after.split("\n");
  let start = 0, end = 0;
  while (start < Math.min(a.length, b.length) && a[start] === b[start]) start++;
  while (end < Math.min(a.length, b.length) - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const removed = a.slice(start, a.length - end), added = b.slice(start, b.length - end);
  const diff = [`--- ${TARGET}`, `+++ ${TARGET}`, `@@ -${start + 1},${removed.length} +${start + 1},${added.length} @@`, ...removed.map(line => `-${line}`), ...added.map(line => `+${line}`)].join("\n");
  return diff.length > 16384 ? diff.slice(0, 16384) + "\n[diff truncated]" : diff;
}

/** Bounded regular-file reader. Missing and unreadable are distinct evidence. Never follows links. */
function read(root: string, target: string, maximum = 128 * 1024, deadline = Infinity): string {
  if (Date.now() > deadline) throw new Error("read-budget-exceeded");
  const path = join(root, target);
  if (realpathSync(root) !== root || realpathSync(dirname(path)) !== dirname(path)) throw new Error("path-untrusted");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > maximum) throw new Error("read-budget-exceeded");
    const bytes = Buffer.alloc(maximum + 1);
    // A short regular-file read is unknown evidence, never an unbounded retry loop.
    const size = readSync(fd, bytes, 0, bytes.length, 0);
    const after = fstatSync(fd), pathStat = lstatSync(path);
    if (Date.now() > deadline) throw new Error("read-budget-exceeded");
    if (size > maximum || after.size !== size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || pathStat.ino !== before.ino || pathStat.dev !== before.dev || !pathStat.isFile()) throw new Error("source-changed");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
  } finally { closeSync(fd); }
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function canonicalScope(scope: PreparationScope): PreparationScope {
  if (scope.members.length > 32 || scope.members.some(m => Object.keys(m.capabilities).length > 16) || realpathSync(scope.projectRoot) !== scope.projectRoot) throw new Error("scope-untrusted");
  return freeze(JSON.parse(JSON.stringify({ ...scope, members: [...scope.members].sort((a, b) => a.bindingId.localeCompare(b.bindingId)) })));
}

/** One logical session's project evidence, independent of its participating roster.
 * Each boundary checks both dependency paths (including absent paths). No optional
 * backend is contacted here. Synchronous reads serialize concurrent callers.
 */
class ComponentEvidenceCoordinator {
  private readonly files = new Map<string, { fingerprint: string; source?: string; missing?: true }>();
  constructor(private readonly onRead?: (path: string) => void) {}
  private fingerprint(root: string, target: string, deadline: number): string {
    if (Date.now() > deadline) throw new Error("read-budget-exceeded");
    const path = join(root, target);
    if (realpathSync(root) !== root) throw new Error("path-untrusted");
    try {
      if (realpathSync(dirname(path)) !== dirname(path)) throw new Error("path-untrusted");
      const stat = lstatSync(path, { bigint: true });
      if (!stat.isFile()) throw new Error("path-untrusted");
      return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode].join(":");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
      throw error;
    }
  }
  read = (root: string, target: string, maximum = 128 * 1024, deadline = Infinity): string => {
    const fingerprint = this.fingerprint(root, target, deadline), prior = this.files.get(target);
    if (Date.now() > deadline) throw new Error("read-budget-exceeded");
    if (prior?.fingerprint === fingerprint) {
      if (prior.missing) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return prior.source!;
    }
    this.files.delete(target);
    this.onRead?.(target);
    try {
      const source = read(root, target, maximum, deadline);
      if (this.fingerprint(root, target, deadline) !== fingerprint) throw new Error("source-changed");
      this.files.set(target, { fingerprint, source });
      return source;
    } catch (error) {
      if (fingerprint === "missing" && (error as NodeJS.ErrnoException).code === "ENOENT") this.files.set(target, { fingerprint, missing: true });
      throw error;
    }
  };
}

/** Read-only evaluator: local bounded reads only; runtime availability never proves index state. */
export function runProjectReadinessPreflightV1(input: PreparationScope): PreparationSnapshot {
  return evaluateProjectReadiness(input, read);
}
function evaluateProjectReadiness(input: PreparationScope, readEvidence: typeof read): PreparationSnapshot {
  // Cooperative deadline: synchronous filesystem calls cannot promise a hard wall-clock bound.
  // At most two file reads, 640 KiB total, 32 metadata operations (including
  // cache fingerprints/absent paths), 4096 YAML nodes/depth 32, and 32 participants.
  const deadline = Date.now() + 250;
  const scope = canonicalScope(input), observations: PreparationObservation[] = [];
  const requiredBy = scope.members.map(m => m.bindingId);
  const project = (component: string, status: PreparationObservation["status"], reason: string, evidence: string, repair: PreparationObservation["repair"] = "none", consumers = requiredBy) => {
    observations.push({ component, scope: "project", status, reason, evidenceDigest: hash(evidence), repair, requiredBy: consumers });
  };
  try {
    const source = readEvidence(scope.projectRoot, TARGET, 128 * 1024, deadline);
    try {
      const result = inspectPolicy(scope.projectRoot, source);
      if (Date.now() > deadline) throw new Error("read-budget-exceeded");
      planOpenSpecInitialization(source);
      project("openspec", result.initialized ? "ready" : "degraded", result.initialized ? "config-readable" : "config-uninitialized", source, result.initialized ? "none" : "project");
      project(CLEANUP, result.changed ? "degraded" : "ready", result.changed ? "retired-policy-present" : "policy-current", source, result.changed ? "project" : "none");
    } catch (e) { const malformed = (e as Error).message === "yaml-malformed"; project("openspec", malformed ? "degraded" : "indeterminate", malformed ? "config-malformed" : "config-unsupported", source, malformed ? "report-only" : "none"); }
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === "ENOENT";
    project("openspec", missing ? "degraded" : "indeterminate", missing ? "config-missing" : "config-unreadable", missing ? "missing" : "unreadable", missing ? "project" : "none");
  }
  try {
    const source = readEvidence(scope.projectRoot, REGISTRY, SKILL_DISCOVERY_V1_BOUNDS.maxFileBytes, deadline);
    const parsed = parseSkillRegistryDocument(source);
    if (Date.now() > deadline) throw new Error("read-budget-exceeded");
    if (declaresNewerSkillRegistrySchema(Buffer.from(source))) project("skill-registry", "degraded", "managed-by-newer-schema", source, "report-only");
    else if (!parsed.ok || !parsed.frontmatter) project("skill-registry", "degraded", "registry-invalid", source, "report-only");
    else if (parsed.frontmatter.completeness !== "complete") project("skill-registry", "degraded", "registry-truncated", source, "report-only");
    else project("skill-registry", "indeterminate", "runner-exposure-unverified", source);
  }
  catch (e) { const missing = (e as NodeJS.ErrnoException).code === "ENOENT"; project("skill-registry", missing ? "degraded" : "indeterminate", missing ? "registry-missing" : "registry-unreadable", missing ? "missing" : "unreadable", missing ? "report-only" : "none"); }
  const indexConsumers = scope.members.filter(m => m.capabilities["codebase-memory"]?.enabled).map(m => m.bindingId);
  if (indexConsumers.length) project("codebase-memory-index", "indeterminate", "index-state-unverified", "unverified", "none", indexConsumers);
  for (const member of scope.members) for (const [component, capability] of Object.entries(observedPreparationCapabilities(member)).sort()) {
    if (!capability.enabled) continue;
    observations.push({ component, scope: "runner", bindingId: member.bindingId, status: capability.availability === "ready" ? "ready" : capability.availability === "unavailable" ? "degraded" : "indeterminate", reason: capability.availability === "unavailable" ? "runner-remediation-required" : capability.availability === "ready" ? "runtime-evidence" : "runtime-unverified", evidenceDigest: hash(JSON.stringify([member.bindingId, capability])), repair: capability.availability === "unavailable" ? "report-only" : "none", requiredBy: [member.bindingId] });
  }
  return freeze({ snapshotId: hash(JSON.stringify({ scope, observations })), scope, observations });
}

export { readinessBlock as formatReadinessBlockV1 } from "@deck/core/session/readiness-parity";

/** The host supplies authenticated invocation and durable intent records, never model role strings. */
export class ProjectPreparationService implements PreparationPort {
  constructor(private readonly options: { stateRoot?: string; indexBindings?: () => readonly IndexInitializerBinding[]; onProjectRead?: (path: string) => void; registryProviders?: () => readonly SkillDiscoverySourceProviderV1[]; registryProvider?: (runnerId: string) => SkillDiscoverySourceProviderV1 | undefined } = {}) {}
  private readonly registryEvidence = new Map<string, { digest: string; runnerId?: string; partial?: boolean; stale: boolean }>();
  private registryScope(scope: PreparationScope) { return JSON.stringify(canonicalScope(preparationAuthorityScope(scope))); }
  /** Adapter-owned launch preparation, outside the synchronous project preflight.
   * Shared composition evaluates all configured providers; legacy callers remain scoped. */
  async prepareRegistryEvidence(scope: PreparationScope, runnerId: string): Promise<void> {
    const key = this.registryScope(scope);
    const prior = this.registryEvidence.get(key);
    if (prior?.runnerId === runnerId) this.registryEvidence.delete(key);
    if (!scope.members.some(member => member.runnerId === runnerId)) return;
    if (this.options.registryProviders) {
      this.registryEvidence.delete(key);
      try {
        const source = read(scope.projectRoot, REGISTRY, SKILL_DISCOVERY_V1_BOUNDS.maxFileBytes);
        const parsed = parseSkillRegistryDocument(source);
        const candidate = await refreshSharedSkillCatalogView({ projectRoot: scope.projectRoot, providers: this.options.registryProviders() });
        if (!parsed.ok || parsed.frontmatter?.schema_version !== 2) return;
        if (read(scope.projectRoot, REGISTRY, SKILL_DISCOVERY_V1_BOUNDS.maxFileBytes) !== source) return;
        this.registryEvidence.set(key, { digest: hash(source), partial: candidate.frontmatter.completeness !== "complete", stale: candidate.frontmatter.fingerprint !== parsed.frontmatter.fingerprint });
        if (this.registryEvidence.size > 128) this.registryEvidence.delete(this.registryEvidence.keys().next().value!);
      } catch { /* Advisory failure never disables ordinary work. */ }
      return;
    }
    const provider = this.options.registryProvider?.(runnerId);
    if (!provider || provider.runnerId !== runnerId) return;
    try {
      const source = read(scope.projectRoot, REGISTRY, SKILL_DISCOVERY_V1_BOUNDS.maxFileBytes);
      const parsed = parseSkillRegistryDocument(source);
      if (!parsed.ok || parsed.frontmatter?.completeness !== "complete") return;
      const sourceSet = await provider.listSources({ projectRoot: scope.projectRoot });
      if (sourceSet.outcome !== "complete") return;
      const sourceDeclarations = [...createCoreGenericProjectSources(scope.projectRoot), ...sourceSet.sources];
      if (computeSkillRegistrySourceScopeHash({ activeRunnerId: runnerId, sourceDeclarations }) !== parsed.frontmatter.source_scope_hash) return;
      const discovery = await discoverSkills({ projectRoot: scope.projectRoot, activeRunnerId: runnerId, sourceSet });
      if (discovery.outcome !== "complete") return;
      const candidate = canonicalizeSkillRegistry({ activeRunnerId: runnerId, sourceDeclarations, discovery });
      if (candidate.frontmatter.completeness !== "complete" || read(scope.projectRoot, REGISTRY, SKILL_DISCOVERY_V1_BOUNDS.maxFileBytes) !== source) return;
      this.registryEvidence.set(key, { digest: hash(source), runnerId, stale: candidate.frontmatter.fingerprint !== parsed.frontmatter.fingerprint });
      if (this.registryEvidence.size > 128) this.registryEvidence.delete(this.registryEvidence.keys().next().value!);
    } catch { /* Incomplete evidence cannot authorize replacement or disable a role. */ }
  }
  private readonly coordinators = new Map<string, { epoch: string; evidence: ComponentEvidenceCoordinator }>();
  private readonly snapshots = new Map<string, PreparationSnapshot>();
  private readonly uncertain = new Set<string>();
  private readonly uncertainIndex = new Set<string>();
  private readonly uncertainRegistry = new Set<string>();
  private indexBinding(scope: PreparationScope): IndexInitializerBinding | undefined {
    const enabled = new Set(scope.members.filter(member => member.capabilities["codebase-memory"]?.enabled).map(member => member.bindingId));
    if (!enabled.size) return undefined;
    return this.options.indexBindings?.().filter(binding => enabled.has(binding.bindingId) && binding.projectRoot === scope.projectRoot
      && binding.backendId && binding.generation && /^[a-f0-9]{64}$/.test(binding.inputDigest) && binding.validUntil > Date.now()
      && /^[a-f0-9]{64}$/.test(binding.expectedPostDigest)).map(binding => ({ ...binding })).sort((a, b) => a.bindingId.localeCompare(b.bindingId))[0];
  }
  /** Restart recovery uses recorded postimages; it never replays an initializer. */
  reconcile(scope: PreparationScope, records: readonly import("@deck/core/session/preparation").PreparationEffectRecord[]) {
    const latest = new Map(records.map(record => [record.effectId, record]));
    const reconciled: import("@deck/core/session/preparation").PreparationEffectRecord[] = [];
    let uncertain = false, uncertainIndex = false, uncertainRegistry = false;
    for (const record of latest.values()) {
      if (record.component === "codebase-memory-index" && ["intent", "uncertain"].includes(record.state)) {
        const binding = this.indexBinding(scope);
        if (binding?.status === "ready" && binding.backendId === record.backendId && binding.inputDigest === record.after) reconciled.push({ ...record, state: "reconciled" });
        else uncertainIndex = true;
      }
      if (record.component === "skill-registry" && ["intent", "uncertain"].includes(record.state)) {
        try {
          if (hash(read(scope.projectRoot, REGISTRY, SKILL_DISCOVERY_V1_BOUNDS.maxFileBytes)) === record.after) reconciled.push({ ...record, state: "reconciled" });
          else uncertainRegistry = true;
        } catch { uncertainRegistry = true; }
      }
      if (![CLEANUP, "openspec"].includes(record.component) || !["intent", "uncertain"].includes(record.state)) continue;
      try {
        if (hash(read(scope.projectRoot, TARGET)) === record.after) reconciled.push({ ...record, state: "reconciled" });
        else uncertain = true;
      } catch { uncertain = true; }
    }
    if (uncertain) this.uncertain.add(scope.projectRoot); else this.uncertain.delete(scope.projectRoot);
    if (uncertainIndex) this.uncertainIndex.add(scope.projectRoot); else this.uncertainIndex.delete(scope.projectRoot);
    if (uncertainRegistry) this.uncertainRegistry.add(scope.projectRoot); else this.uncertainRegistry.delete(scope.projectRoot);
    return reconciled;
  }
  status(scope: PreparationScope): PreparationSnapshot {
    const key = JSON.stringify([scope.projectRoot, scope.sessionId]);
    let coordinator = this.coordinators.get(key);
    if (!coordinator || coordinator.epoch !== scope.epoch) {
      coordinator = { epoch: scope.epoch, evidence: new ComponentEvidenceCoordinator(this.options.onProjectRead) };
      this.coordinators.set(key, coordinator);
    }
    let snapshot = evaluateProjectReadiness(scope, coordinator.evidence.read);
    if (this.options.registryProvider || this.options.registryProviders) {
      const observations = snapshot.observations.map(o => o.component === "skill-registry" && ["registry-missing", "registry-invalid", "registry-truncated"].includes(o.reason) ? { ...o, repair: "project" as const } : o);
      snapshot = freeze({ ...snapshot, snapshotId: hash(JSON.stringify({ scope: snapshot.scope, observations })), observations });
    }
    const registryEvidence = this.registryEvidence.get(this.registryScope(scope));
    if (registryEvidence) {
      const observations = snapshot.observations.map(o => o.component === "skill-registry" && ["runner-exposure-unverified", "registry-truncated"].includes(o.reason) && o.evidenceDigest === registryEvidence.digest
        ? { ...o, sourceRunnerId: registryEvidence.runnerId, status: registryEvidence.stale ? "degraded" as const : registryEvidence.partial ? "indeterminate" as const : "ready" as const,
            reason: registryEvidence.stale ? "registry-stale" : registryEvidence.partial ? "registry-partial" : "registry-current", repair: registryEvidence.stale ? "project" as const : "none" as const } : o);
      snapshot = freeze({ ...snapshot, snapshotId: hash(JSON.stringify({ scope: snapshot.scope, observations })), observations });
    }
    if (this.uncertainRegistry.has(scope.projectRoot)) {
      const observations = snapshot.observations.map(o => o.component === "skill-registry" ? { ...o, status: "indeterminate" as const, reason: "repair-outcome-uncertain", repair: "none" as const } : o);
      snapshot = freeze({ ...snapshot, snapshotId: hash(JSON.stringify({ scope: snapshot.scope, observations })), observations });
    }
    const binding = this.indexBinding(scope);
    if (binding) {
      const observations = snapshot.observations.map(o => o.component === "codebase-memory-index" ? { ...o,
        status: binding.status === "ready" ? "ready" as const : "degraded" as const,
        reason: binding.status === "ready" ? "index-evidence-current" : "index-refresh-required",
        evidenceDigest: indexDigest(binding), repair: binding.status === "ready" ? "none" as const : "project" as const,
      } : o);
      snapshot = freeze({ ...snapshot, snapshotId: hash(JSON.stringify({ scope: snapshot.scope, observations })), observations });
    }
    if (this.uncertain.has(scope.projectRoot) || this.uncertainIndex.has(scope.projectRoot)) {
      const observations = snapshot.observations.map(o => [CLEANUP, "openspec"].includes(o.component) && this.uncertain.has(scope.projectRoot) || o.component === "codebase-memory-index" && this.uncertainIndex.has(scope.projectRoot) ? { ...o, status: "indeterminate" as const, reason: "repair-outcome-uncertain", repair: "none" as const } : o);
      snapshot = freeze({ ...snapshot, snapshotId: hash(JSON.stringify({ scope: snapshot.scope, observations })), observations });
    }
    const existing = this.snapshots.get(snapshot.snapshotId);
    if (existing) return existing;
    this.snapshots.set(snapshot.snapshotId, snapshot);
    if (this.snapshots.size > 128) { const oldest = this.snapshots.keys().next().value!; this.snapshots.delete(oldest); }
    return snapshot;
  }
  delegate(value: unknown, scope: PreparationScope, task: { taskId: string; attempt: number }): PreparationDelegation {
    const request = parsePreparationRequest(value), snapshot = this.snapshots.get(request.snapshotId);
    if (!snapshot || JSON.stringify(canonicalScope(preparationAuthorityScope(scope))) !== JSON.stringify(canonicalScope(preparationAuthorityScope(snapshot.scope)))) throw new Error("preparation-snapshot-stale");
    if (request.components.some(c => !snapshot.observations.some(o => o.component === c && o.scope === "project" && o.status === "degraded" && o.repair === "project"))) throw new Error("preparation-component-unavailable");
    return freeze({ ...request, ...task, id: randomUUID(), sessionId: scope.sessionId, epoch: scope.epoch, projectRoot: scope.projectRoot,
      expiresAt: Date.now() + 300_000, evidence: Object.fromEntries(request.components.map(c => [c, snapshot.observations.find(o => o.component === c && o.scope === "project")!.evidenceDigest])),
    });
  }
  async repair(value: unknown, invocation: PreparationInvocation): Promise<{ status: string; snapshot?: PreparationSnapshot; diff?: string }> {
    const request = parsePreparationRequest(value), d = invocation.delegation;
    const snapshot = this.snapshots.get(request.snapshotId);
    const live = () => {
      const scope = invocation.current();
      const reason = !scope ? "invocation-revoked"
        : d.snapshotId !== request.snapshotId ? "request-snapshot-mismatch"
        : !snapshot ? "snapshot-unavailable"
        : Date.now() > d.expiresAt ? "delegation-expired"
        : invocation.roleId !== "deck-setup" ? "role-mismatch"
        : !invocation.generation ? "generation-missing"
        : !invocation.launchId ? "launch-missing"
        : !invocation.nativeSessionId ? "native-session-missing"
        : d.sessionId !== scope.sessionId ? "session-mismatch"
        : d.epoch !== scope.epoch ? "epoch-mismatch"
        : d.projectRoot !== scope.projectRoot ? "project-mismatch"
        : request.components.some(c => !d.components.includes(c)) ? "component-outside-delegation"
        : JSON.stringify(canonicalScope(preparationAuthorityScope(scope))) !== JSON.stringify(canonicalScope(preparationAuthorityScope(snapshot.scope))) ? "authority-scope-changed"
        : undefined;
      if (reason) {
        invocation.rejected?.(reason);
        throw new Error("preparation-authority-revoked");
      }
      return scope!;
    };
    const scope = live(), key = join(scope.projectRoot, request.components[0] === "skill-registry" ? REGISTRY : TARGET);
    const prior = locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const tail = prior.then(() => held); locks.set(key, tail);
    await prior;
    try {
      live();
      if (request.components.length === 1 && request.components[0] === "skill-registry") {
        const component = "skill-registry";
        const observation = snapshot!.observations.find(o => o.component === component && ["registry-missing", "registry-invalid", "registry-truncated", "registry-stale"].includes(o.reason) && o.repair === "project");
        if (!observation || d.evidence[component] !== observation.evidenceDigest) throw new Error("preparation-finding-unavailable");
        if (!this.options.registryProviders && observation.sourceRunnerId && observation.sourceRunnerId !== invocation.runnerId) throw new Error("preparation-executor-unavailable");
        const effectId = hash(`${scope.projectRoot}:${component}:${observation.evidenceDigest}`);
        const previous = invocation.previous().filter(r => r.effectId === effectId).at(-1);
        const currentDigest = () => {
          try { return hash(read(scope.projectRoot, REGISTRY, SKILL_DISCOVERY_V1_BOUNDS.maxFileBytes)); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing"; throw error; }
        };
        if (previous) {
          if (currentDigest() !== previous.after) throw new Error("preparation-effect-uncertain");
          invocation.record({ ...previous, state: "reconciled" }); this.uncertainRegistry.delete(scope.projectRoot);
          return { status: "reconciled", snapshot: this.status(live()) };
        }
        if (this.uncertainRegistry.has(scope.projectRoot)) throw new Error("preparation-effect-uncertain");
        const expectedDigest = observation.reason === "registry-missing" ? "missing" : observation.evidenceDigest;
        if (currentDigest() !== expectedDigest) throw new Error("preparation-source-changed");
        let candidate: ReturnType<typeof canonicalizeSkillRegistry>;
        if (this.options.registryProviders) {
          if (!scope.members.some(m => m.runnerId === invocation.runnerId)) throw new Error("preparation-executor-unavailable");
          candidate = await discoverSharedSkillCatalog({ projectRoot: scope.projectRoot, providers: this.options.registryProviders() });
          live();
        } else {
          const provider = this.options.registryProvider?.(invocation.runnerId);
          if (!scope.members.some(m => m.runnerId === invocation.runnerId) || !provider || provider.runnerId !== invocation.runnerId) throw new Error("preparation-executor-unavailable");
          const sourceSet = await provider.listSources({ projectRoot: scope.projectRoot });
          live();
          const discovery = await discoverSkills({ projectRoot: scope.projectRoot, activeRunnerId: invocation.runnerId, sourceSet });
          live();
          if (discovery.outcome !== "complete") throw new Error("preparation-registry-exposure-unverified");
          candidate = canonicalizeSkillRegistry({ activeRunnerId: invocation.runnerId, sourceDeclarations: [...createCoreGenericProjectSources(scope.projectRoot), ...sourceSet.sources], discovery });
          if (candidate.frontmatter.completeness !== "complete") throw new Error("preparation-registry-exposure-unverified");
          if (observation.reason === "registry-stale") {
            const stored = parseSkillRegistryDocument(read(scope.projectRoot, REGISTRY, SKILL_DISCOVERY_V1_BOUNDS.maxFileBytes)).frontmatter;
            if (!stored || stored.source_scope_hash !== candidate.frontmatter.source_scope_hash || stored.fingerprint === candidate.frontmatter.fingerprint) throw new Error("preparation-registry-exposure-unverified");
          }
        }
        if (currentDigest() !== expectedDigest) throw new Error("preparation-source-changed");
        const record = { effectId, delegationId: d.id, component, before: observation.evidenceDigest, after: hash(candidate.document) };
        const projectRootDigest = `sha256:${hash(scope.projectRoot)}` as const;
        const action = expectedDigest === "missing" ? "initial_generation" : "regeneration";
        const authority = createSkillRegistryWriteAuthority({ projectRoot: scope.projectRoot, projectRootDigest, activeRunnerId: invocation.runnerId, candidateDigest: `sha256:${record.after}`, action, allowedTargets: [REGISTRY] });
        live();
        let reserved = false;
        try {
          const writer = createSkillRegistryWriter({ projectRoot: scope.projectRoot, stateRoot: this.options.stateRoot,
            failpoint: stage => { if (!stage.startsWith("after_replace") && stage !== "before_directory_sync" && stage !== "after_directory_sync") live(); },
            atomicReplace: {
              replace: async (temporary, target) => {
                live();
                if (target !== key || currentDigest() !== expectedDigest) throw new Error("preparation-source-changed");
                reserved = true;
                this.uncertainRegistry.add(scope.projectRoot);
                invocation.record({ ...record, state: "intent" });
                live();
                if (currentDigest() !== expectedDigest) throw new Error("preparation-source-changed");
                // No async gap between the final authority/source check and replacement.
                renameSync(temporary, target);
              },
              syncDirectory: POSIX_ATOMIC_REPLACE_PORT_V1.syncDirectory,
            },
          });
          const result = await writer.commit({ schema: "skill-registry-write-plan-v1", action, active_runner_id: invocation.runnerId,
            project_root_digest: projectRootDigest, allowed_targets: [REGISTRY], expected_registry_digest: expectedDigest === "missing" ? "missing" : `sha256:${expectedDigest}`,
            candidate_document: candidate.document, candidate_digest: `sha256:${record.after}` }, authority);
          if (result.outcome === "rejected") throw new Error(`preparation-registry-${result.reason_code}`);
          if (currentDigest() !== record.after) throw new Error("preparation-effect-uncertain");
          invocation.record({ ...record, state: "completed" }); this.uncertainRegistry.delete(scope.projectRoot);
        } catch (error) { if (reserved) invocation.record({ ...record, state: "uncertain" }); throw error; }
        if (candidate.frontmatter.schema_version === 2) this.registryEvidence.set(this.registryScope(scope), { digest: record.after, stale: false, partial: candidate.frontmatter.completeness !== "complete" });
        return { status: "changed", snapshot: this.status(live()) };
      }
      if (request.components.length === 1 && request.components[0] === "codebase-memory-index") {
        const component = "codebase-memory-index", binding = this.indexBinding(live());
        const observation = snapshot!.observations.find(o => o.component === component && o.status === "degraded" && o.repair === "project");
        if (!binding || !observation || d.evidence[component] !== observation.evidenceDigest) throw new Error("preparation-executor-unavailable");
        const effectId = hash(`${scope.projectRoot}:${component}:${observation.evidenceDigest}`);
        const previous = invocation.previous().filter(r => r.effectId === effectId).at(-1);
        if (previous) {
          if (previous.after !== binding.inputDigest || previous.backendId !== binding.backendId) throw new Error("preparation-effect-uncertain");
          invocation.record({ ...previous, state: "reconciled" }); this.uncertainIndex.delete(scope.projectRoot); return { status: "reconciled", snapshot: this.status(live()) };
        }
        if (indexDigest(binding) !== observation.evidenceDigest || binding.status !== "needs-index") throw new Error("preparation-source-changed");
        const record = { effectId, delegationId: d.id, component, before: observation.evidenceDigest, after: binding.expectedPostDigest, executorBindingId: binding.bindingId, backendId: binding.backendId };
        invocation.record({ ...record, state: "intent" });
        this.uncertainIndex.add(scope.projectRoot);
        const currentBinding = this.indexBinding(live());
        if (!currentBinding || currentBinding.bindingId !== binding.bindingId || currentBinding.inputDigest !== binding.inputDigest || currentBinding.expectedPostDigest !== binding.expectedPostDigest || currentBinding.generation !== binding.generation || currentBinding.backendId !== binding.backendId) throw new Error("preparation-executor-revoked");
        try {
          currentBinding.initializeProjectSync(scope.projectRoot);
          const after = this.indexBinding(live());
          if (!after || after.inputDigest !== record.after || after.status !== "ready") throw new Error("preparation-effect-uncertain");
          invocation.record({ ...record, state: "completed" });
          this.uncertainIndex.delete(scope.projectRoot);
        } catch (error) { invocation.record({ ...record, state: "uncertain" }); throw error; }
        return { status: "changed", snapshot: this.status(live()) };
      }
      if (request.components.length !== 1 || ![CLEANUP, "openspec"].includes(request.components[0]!)) throw new Error("preparation-component-unavailable");
      const component = request.components[0]!;
      const observation = snapshot!.observations.find(o => o.component === component && o.status === "degraded" && o.repair === "project");
      if (!observation) throw new Error("preparation-finding-unavailable");
      if (d.evidence[component] !== observation.evidenceDigest) throw new Error("preparation-evidence-mismatch");
      const sourceNow = () => { try { return read(scope.projectRoot, TARGET); } catch (error) {
        if (component === "openspec" && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      } };
      const source = sourceNow(), before = hash(source ?? "missing");
      const effectId = hash(`${scope.projectRoot}:${component}:${observation.evidenceDigest}`);
      const previous = invocation.previous().filter(r => r.effectId === effectId).at(-1);
      if (previous) {
        if (previous.after === before) { invocation.record({ ...previous, state: "reconciled" }); this.uncertain.delete(scope.projectRoot); return { status: "reconciled", snapshot: this.status(live()) }; }
        throw new Error("preparation-effect-uncertain");
      }
      if (before !== observation.evidenceDigest) throw new Error("preparation-source-changed");
      if (this.uncertain.has(scope.projectRoot)) throw new Error("preparation-effect-uncertain");
      const result = component === "openspec" ? { text: planOpenSpecInitialization(source), changed: true } : migrateRetiredTestingPolicy(source!);
      const after = hash(result.text);
      if (!result.changed) throw new Error("preparation-source-changed");
      const record = { effectId, delegationId: d.id, component, before, after };
      live();
      // Durable intent precedes the write. One exact effect consumes this reservation.
      invocation.record({ ...record, state: "intent" });
      this.uncertain.add(scope.projectRoot);
      live();
      const tmp = join(dirname(key), `.deck-preparation-${randomUUID()}.tmp`);
      try {
        if (source === undefined) mkdirSync(dirname(key), { recursive: true });
        if (realpathSync(dirname(key)) !== dirname(key)) throw new Error("path-untrusted");
        writeFileSync(tmp, result.text, { mode: source === undefined ? 0o600 : lstatSync(key).mode & 0o777, flag: "wx" });
        if (hash(sourceNow() ?? "missing") !== before) throw new Error("preparation-source-changed");
        live();
        // Creating a missing config must not replace a concurrently created file.
        if (source === undefined) { linkSync(tmp, key); unlinkSync(tmp); }
        else renameSync(tmp, key);
        if (hash(read(scope.projectRoot, TARGET)) !== after) throw new Error("preparation-effect-uncertain");
        invocation.record({ ...record, state: "completed" });
        this.uncertain.delete(scope.projectRoot);
      } catch (error) {
        try { unlinkSync(tmp); } catch {}
        invocation.record({ ...record, state: "uncertain" });
        throw error;
      }
      return { status: "changed", snapshot: this.status(live()), diff: boundedDiff(source ?? "", result.text) };
    } finally { release(); if (locks.get(key) === tail) locks.delete(key); }
  }
}
