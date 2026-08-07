import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";

export type TelemetryRunnerV1 = "opencode" | "pi" | "codex";
export type TelemetryPhaseV1 = "apply" | "verify" | "review";
export type TelemetryRiskTierV1 = "low" | "medium" | "high" | "critical";
export type TelemetryLaneV1 = "fast" | "guarded" | "full_sdd";

export type UserOutcomeTelemetryEventNameV1 = "first-useful-result" | "accepted-result" | "decision" | "intervention" | "repeated-approval" | "retry" | "phase-launch" | "mode-handoff" | "unplanned-expansion" | "process-artifact-count";
export type UserOutcomeTelemetryEventV1 = Readonly<{ schema: "user-outcome-telemetry-v1"; event: UserOutcomeTelemetryEventNameV1; count: number }>;
export interface UserOutcomeMetricObservationV1 {
  readonly timeToFirstUsefulResultMs?: number;
  readonly timeToAcceptedDeliveryMs?: number;
  readonly userInterventionCount: number;
  readonly repairCycleCount: number;
  readonly verificationRunCount: number;
  readonly unnecessaryVerificationRerunCount: number;
  readonly terminalChangeCount: number;
  readonly honestClosureCount: number;
  readonly productWorkUnitCount: number;
  readonly processWorkUnitCount: number;
  readonly directPathAvailableButMissedCount: number;
}
export interface UserOutcomeTelemetryAggregateV1 {
  readonly schema: "user-outcome-telemetry-aggregate-v1";
  readonly eligibleExecutions: number;
  readonly firstUsefulResultCount: number;
  readonly firstUsefulResultTotalMs: number;
  readonly acceptedDeliveryCount: number;
  readonly acceptedDeliveryTotalMs: number;
  readonly userInterventionCount: number;
  readonly repairCycleCount: number;
  readonly verificationRunCount: number;
  readonly unnecessaryVerificationRerunCount: number;
  readonly terminalChangeCount: number;
  readonly honestClosureCount: number;
  readonly productWorkUnitCount: number;
  readonly processWorkUnitCount: number;
  readonly directPathAvailableButMissedCount: number;
}

type SafeExecutionTelemetryBaseV1 = Readonly<{
  schema: "safe-execution-telemetry-v1";
  runner: TelemetryRunnerV1;
  phase: TelemetryPhaseV1;
  riskTier: TelemetryRiskTierV1;
  wouldBeLane: TelemetryLaneV1;
  outcomeCode: string;
  count: number;
  durationMs: number;
}>;

export type SafeExecutionBaselineTelemetryEventV1 = SafeExecutionTelemetryBaseV1 & Readonly<{
  event: "baseline-recorded" | "shadow-compared" | "capability-probed";
}>;

export type SafeRolloutExecutionTelemetryEventV1 = SafeExecutionTelemetryBaseV1 & Readonly<{
  event: "rollout-execution-observed";
  mode: "baseline" | "candidate";
  observedDay: number;
  phaseLaunchCount: number;
  noPositiveDeltaCycleCount: number;
  registryConflictCount: number;
  controlPlaneOverheadMs: number;
  replayOutcome: "matched" | "mismatched";
  batchReferenceOutcome: "continuous" | "broken";
  authorizationOutcome: "enforced" | "bypassed";
  registryHistoryOutcome: "preserved" | "lost" | "duplicated";
  broadCheckOutcome: "compliant" | "missed";
  freshReviewOutcome: "compliant" | "missed";
  laneFloorOutcome: "preserved" | "downgraded";
  adapterOutcome: "parity" | "divergent";
  escapedCriticalFindingCount: number;
  escapedSecurityArchitectureFindingCount: number;
}>;

export type SafeExecutionTelemetryEventV1 =
  | SafeExecutionBaselineTelemetryEventV1
  | SafeRolloutExecutionTelemetryEventV1;

export type SafeTelemetrySinkV1 = Readonly<{
  emit(event: SafeExecutionTelemetryEventV1): Promise<void>;
}>;

export type ConfiguredTelemetrySinkV1 = SafeTelemetrySinkV1 & Readonly<{
  lastDiagnostic(): "telemetry-write-failed" | null;
}>;

export type RolloutSafetyObservationV1 = Readonly<{
  replayMismatchCount: number;
  batchReferenceBreakCount: number;
  authorizationBypassCount: number;
  registryHistoryLossCount: number;
  duplicateRegistryEventCount: number;
  broadCheckMissCount: number;
  freshReviewMissCount: number;
  laneFloorDowngradeCount: number;
  adapterDivergenceCount: number;
  escapedCriticalFindingCount: number;
  baselineSecurityArchitectureEscapeRate: number;
  candidateSecurityArchitectureEscapeRate: number;
}>;

export type RolloutMetricObservationV1 = Readonly<{
  riskTier: TelemetryRiskTierV1;
  lane: TelemetryLaneV1;
  baselineCount: number;
  candidateCount: number;
  baselineMedianAcceptedCompletionMs: number | null;
  candidateMedianAcceptedCompletionMs: number | null;
  baselineMedianPhaseLaunchCount: number | null;
  candidateMedianPhaseLaunchCount: number | null;
  baselineNoPositiveDeltaCycleRate: number | null;
  candidateNoPositiveDeltaCycleRate: number | null;
  baselineRegistryConflictRate: number | null;
  candidateRegistryConflictRate: number | null;
  candidateControlPlaneP95Ms: number | null;
}>;

export type RolloutObservationV1 = Readonly<{
  schema: "rollout-observation-v1";
  eligibleExecutions: number;
  consecutiveDays: number;
  observedRunners: readonly TelemetryRunnerV1[];
  safety: RolloutSafetyObservationV1;
  metrics: readonly RolloutMetricObservationV1[];
}>;

const BASE_TELEMETRY_KEYS = [
  "schema",
  "event",
  "runner",
  "phase",
  "riskTier",
  "wouldBeLane",
  "outcomeCode",
  "count",
  "durationMs",
] as const;

const ROLLOUT_TELEMETRY_KEYS = [
  ...BASE_TELEMETRY_KEYS,
  "mode",
  "observedDay",
  "phaseLaunchCount",
  "noPositiveDeltaCycleCount",
  "registryConflictCount",
  "controlPlaneOverheadMs",
  "replayOutcome",
  "batchReferenceOutcome",
  "authorizationOutcome",
  "registryHistoryOutcome",
  "broadCheckOutcome",
  "freshReviewOutcome",
  "laneFloorOutcome",
  "adapterOutcome",
  "escapedCriticalFindingCount",
  "escapedSecurityArchitectureFindingCount",
] as const;

const BASELINE_EVENTS = new Set(["baseline-recorded", "shadow-compared", "capability-probed"]);
const USER_OUTCOME_EVENTS = new Set<UserOutcomeTelemetryEventNameV1>(["first-useful-result", "accepted-result", "decision", "intervention", "repeated-approval", "retry", "phase-launch", "mode-handoff", "unplanned-expansion", "process-artifact-count"]);
const TELEMETRY_VALUES = Object.freeze({
  runner: new Set(["opencode", "pi"]),
  phase: new Set(["apply", "verify", "review"]),
  riskTier: new Set(["low", "medium", "high", "critical"]),
  wouldBeLane: new Set(["fast", "guarded", "full_sdd"]),
  mode: new Set(["baseline", "candidate"]),
  replayOutcome: new Set(["matched", "mismatched"]),
  batchReferenceOutcome: new Set(["continuous", "broken"]),
  authorizationOutcome: new Set(["enforced", "bypassed"]),
  registryHistoryOutcome: new Set(["preserved", "lost", "duplicated"]),
  broadCheckOutcome: new Set(["compliant", "missed"]),
  freshReviewOutcome: new Set(["compliant", "missed"]),
  laneFloorOutcome: new Set(["preserved", "downgraded"]),
  adapterOutcome: new Set(["parity", "divergent"]),
});

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 30;
const ROTATED_FILE = /^v1\.\d+(?:\.\d+)?\.jsonl$/;

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isBaseTelemetryEvent(output: Record<string, unknown>): boolean {
  return output.schema === "safe-execution-telemetry-v1"
    && TELEMETRY_VALUES.runner.has(output.runner as string)
    && TELEMETRY_VALUES.phase.has(output.phase as string)
    && TELEMETRY_VALUES.riskTier.has(output.riskTier as string)
    && TELEMETRY_VALUES.wouldBeLane.has(output.wouldBeLane as string)
    && typeof output.outcomeCode === "string"
    && output.outcomeCode.length <= 128
    && /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(output.outcomeCode)
    && isNonNegativeInteger(output.count)
    && isNonNegativeNumber(output.durationMs);
}

function isRolloutTelemetryEvent(output: Record<string, unknown>): boolean {
  return output.event === "rollout-execution-observed"
    && output.count === 1
    && TELEMETRY_VALUES.mode.has(output.mode as string)
    && isNonNegativeInteger(output.observedDay)
    && isNonNegativeInteger(output.phaseLaunchCount)
    && isNonNegativeInteger(output.noPositiveDeltaCycleCount)
    && isNonNegativeInteger(output.registryConflictCount)
    && isNonNegativeNumber(output.controlPlaneOverheadMs)
    && TELEMETRY_VALUES.replayOutcome.has(output.replayOutcome as string)
    && TELEMETRY_VALUES.batchReferenceOutcome.has(output.batchReferenceOutcome as string)
    && TELEMETRY_VALUES.authorizationOutcome.has(output.authorizationOutcome as string)
    && TELEMETRY_VALUES.registryHistoryOutcome.has(output.registryHistoryOutcome as string)
    && TELEMETRY_VALUES.broadCheckOutcome.has(output.broadCheckOutcome as string)
    && TELEMETRY_VALUES.freshReviewOutcome.has(output.freshReviewOutcome as string)
    && TELEMETRY_VALUES.laneFloorOutcome.has(output.laneFloorOutcome as string)
    && TELEMETRY_VALUES.adapterOutcome.has(output.adapterOutcome as string)
    && isNonNegativeInteger(output.escapedCriticalFindingCount)
    && isNonNegativeInteger(output.escapedSecurityArchitectureFindingCount);
}

export function serializeSafeTelemetryEvent(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("invalid-safe-telemetry-event");
  }
  const record = input as Record<string, unknown>;
  const keys = record.event === "rollout-execution-observed"
    ? ROLLOUT_TELEMETRY_KEYS
    : BASE_TELEMETRY_KEYS;
  const output: Record<string, unknown> = {};
  for (const key of keys) output[key] = record[key];
  const eventValid = BASELINE_EVENTS.has(output.event as string) || isRolloutTelemetryEvent(output);
  if (!isBaseTelemetryEvent(output) || !eventValid) {
    throw new Error("invalid-safe-telemetry-event");
  }
  return JSON.stringify(output);
}

/** Aggregate-only user-value telemetry deliberately excludes prompt, path, content, secrets, and per-invocation duration. */
export function serializeUserOutcomeTelemetryEventV1(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid-user-outcome-telemetry-event");
  const record = input as Record<string, unknown>;
  const output = { schema: record.schema, event: record.event, count: record.count };
  if (output.schema !== "user-outcome-telemetry-v1" || !USER_OUTCOME_EVENTS.has(output.event as UserOutcomeTelemetryEventNameV1) || !isNonNegativeInteger(output.count)) throw new Error("invalid-user-outcome-telemetry-event");
  return JSON.stringify(output);
}

const USER_OUTCOME_AGGREGATE_KEYS = [
  "schema",
  "eligibleExecutions",
  "firstUsefulResultCount",
  "firstUsefulResultTotalMs",
  "acceptedDeliveryCount",
  "acceptedDeliveryTotalMs",
  "userInterventionCount",
  "repairCycleCount",
  "verificationRunCount",
  "unnecessaryVerificationRerunCount",
  "terminalChangeCount",
  "honestClosureCount",
  "productWorkUnitCount",
  "processWorkUnitCount",
  "directPathAvailableButMissedCount",
] as const;

/** Builds aggregate user-value metrics without retaining prompts, paths, content, identities, or individual timings. */
export function aggregateUserOutcomeTelemetryV1(
  observations: readonly UserOutcomeMetricObservationV1[],
): UserOutcomeTelemetryAggregateV1 {
  if (!Array.isArray(observations)) throw new Error("invalid-user-outcome-telemetry-observation");
  const aggregate = {
    schema: "user-outcome-telemetry-aggregate-v1" as const,
    eligibleExecutions: observations.length,
    firstUsefulResultCount: 0,
    firstUsefulResultTotalMs: 0,
    acceptedDeliveryCount: 0,
    acceptedDeliveryTotalMs: 0,
    userInterventionCount: 0,
    repairCycleCount: 0,
    verificationRunCount: 0,
    unnecessaryVerificationRerunCount: 0,
    terminalChangeCount: 0,
    honestClosureCount: 0,
    productWorkUnitCount: 0,
    processWorkUnitCount: 0,
    directPathAvailableButMissedCount: 0,
  };
  for (const observation of observations) {
    if (!observation || typeof observation !== "object") throw new Error("invalid-user-outcome-telemetry-observation");
    for (const key of [
      "userInterventionCount",
      "repairCycleCount",
      "verificationRunCount",
      "unnecessaryVerificationRerunCount",
      "terminalChangeCount",
      "honestClosureCount",
      "productWorkUnitCount",
      "processWorkUnitCount",
      "directPathAvailableButMissedCount",
    ] as const) {
      if (!isNonNegativeInteger(observation[key])) throw new Error("invalid-user-outcome-telemetry-observation");
      aggregate[key] += observation[key];
    }
    if (observation.honestClosureCount > observation.terminalChangeCount) throw new Error("invalid-user-outcome-telemetry-observation");
    if (observation.unnecessaryVerificationRerunCount > observation.verificationRunCount) throw new Error("invalid-user-outcome-telemetry-observation");
    if (observation.timeToFirstUsefulResultMs !== undefined) {
      if (!isNonNegativeNumber(observation.timeToFirstUsefulResultMs)) throw new Error("invalid-user-outcome-telemetry-observation");
      aggregate.firstUsefulResultCount += 1;
      aggregate.firstUsefulResultTotalMs += observation.timeToFirstUsefulResultMs;
    }
    if (observation.timeToAcceptedDeliveryMs !== undefined) {
      if (!isNonNegativeNumber(observation.timeToAcceptedDeliveryMs)) throw new Error("invalid-user-outcome-telemetry-observation");
      aggregate.acceptedDeliveryCount += 1;
      aggregate.acceptedDeliveryTotalMs += observation.timeToAcceptedDeliveryMs;
    }
  }
  return Object.freeze(aggregate);
}

export function serializeUserOutcomeTelemetryAggregateV1(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid-user-outcome-telemetry-aggregate");
  const record = input as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of USER_OUTCOME_AGGREGATE_KEYS) output[key] = record[key];
  if (
    output.schema !== "user-outcome-telemetry-aggregate-v1"
    || USER_OUTCOME_AGGREGATE_KEYS.slice(1).some((key) => !isNonNegativeNumber(output[key]))
    || (output.honestClosureCount as number) > (output.terminalChangeCount as number)
    || (output.unnecessaryVerificationRerunCount as number) > (output.verificationRunCount as number)
  ) throw new Error("invalid-user-outcome-telemetry-aggregate");
  return JSON.stringify(output);
}

export function createNoopTelemetrySink(): SafeTelemetrySinkV1 {
  return Object.freeze({ async emit() {} });
}

export function createBoundedLocalTelemetrySink(capacity: number) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("invalid-telemetry-capacity");
  const events: SafeExecutionTelemetryEventV1[] = [];
  return Object.freeze({
    async emit(event: SafeExecutionTelemetryEventV1) {
      const safe = JSON.parse(serializeSafeTelemetryEvent(event)) as SafeExecutionTelemetryEventV1;
      events.push(Object.freeze(safe));
      if (events.length > capacity) events.splice(0, events.length - capacity);
    },
    snapshot(): readonly SafeExecutionTelemetryEventV1[] { return Object.freeze([...events]); },
  });
}

async function existingSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function existingFileTimes(path: string): Promise<Readonly<{ size: number; birthtimeMs: number; mtimeMs: number }> | null> {
  try {
    const metadata = await stat(path);
    return { size: metadata.size, birthtimeMs: metadata.birthtimeMs, mtimeMs: metadata.mtimeMs };
  } catch {
    return null;
  }
}

async function nextRotationPath(directory: string, nowMs: number): Promise<string> {
  const base = join(directory, `v1.${nowMs}.jsonl`);
  if (await existingSize(base) === 0) return base;
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const candidate = join(directory, `v1.${nowMs}.${suffix}.jsonl`);
    if (await existingSize(candidate) === 0) return candidate;
  }
  throw new Error("telemetry-rotation-exhausted");
}

async function pruneExpiredTelemetry(directory: string, cutoffMs: number): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isFile() && ROTATED_FILE.test(entry.name))
    .map(async (entry) => {
      const path = join(directory, entry.name);
      if ((await stat(path)).mtimeMs < cutoffMs) await rm(path, { force: true });
    }));
}

export function createConfiguredTelemetrySinkV1(options: Readonly<{
  mode: "off" | "local-safe";
  projectRoot: string;
  maxBytes?: number;
  retentionDays?: number;
  requiredForRollout?: boolean;
  now?: () => number;
}>): ConfiguredTelemetrySinkV1 {
  if (options.mode !== "off" && options.mode !== "local-safe") throw new Error("invalid-telemetry-mode");
  if (!options.projectRoot.trim()) throw new Error("invalid-telemetry-project-root");
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("invalid-telemetry-max-bytes");
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 30) {
    throw new Error("invalid-telemetry-retention-days");
  }
  if (options.mode === "off") {
    return Object.freeze({ async emit() {}, lastDiagnostic: () => null });
  }

  const directory = join(options.projectRoot, ".deck", "runtime", "execution-telemetry");
  const currentPath = join(directory, "v1.jsonl");
  const now = options.now ?? Date.now;
  let diagnostic: "telemetry-write-failed" | null = null;
  let queue = Promise.resolve();
  let currentStartedAt: number | null = null;

  async function write(event: SafeExecutionTelemetryEventV1): Promise<void> {
    const line = `${serializeSafeTelemetryEvent(event)}\n`;
    const nowMs = now();
    try {
      await mkdir(directory, { recursive: true });
      const retentionCutoff = nowMs - retentionDays * DAY_MS;
      await pruneExpiredTelemetry(directory, retentionCutoff);
      const current = await existingFileTimes(currentPath);
      if (currentStartedAt === null) {
        currentStartedAt = current === null
          ? nowMs
          : current.birthtimeMs > 0 ? current.birthtimeMs : current.mtimeMs;
      }
      const currentExpired = current !== null && current.size > 0 && currentStartedAt < retentionCutoff;
      if (currentExpired) {
        await rm(currentPath, { force: true });
        currentStartedAt = nowMs;
      }
      const size = currentExpired ? 0 : current?.size ?? 0;
      if (size > 0 && size + Buffer.byteLength(line) > maxBytes) {
        await rename(currentPath, await nextRotationPath(directory, nowMs));
        currentStartedAt = nowMs;
      }
      await appendFile(currentPath, line, "utf8");
      diagnostic = null;
    } catch {
      diagnostic = "telemetry-write-failed";
      if (options.requiredForRollout) throw new Error("telemetry-evidence-unavailable");
    }
  }

  return Object.freeze({
    emit(event: SafeExecutionTelemetryEventV1) {
      const result = queue.then(() => write(event));
      queue = result.catch(() => undefined);
      return result;
    },
    lastDiagnostic: () => diagnostic,
  });
}

export async function recordBoundedBaseline(
  executions: readonly SafeExecutionTelemetryEventV1[],
  sink: SafeTelemetrySinkV1,
  capacity: number,
): Promise<readonly SafeExecutionTelemetryEventV1[]> {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("invalid-telemetry-capacity");
  const recorded: SafeExecutionTelemetryEventV1[] = [];
  for (const execution of executions) {
    const event = Object.freeze(JSON.parse(serializeSafeTelemetryEvent(execution)) as SafeExecutionTelemetryEventV1);
    await sink.emit(event);
    recorded.push(event);
    if (recorded.length > capacity) recorded.splice(0, recorded.length - capacity);
  }
  return Object.freeze(recorded);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function percentile95(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
}

function rate(total: number, count: number): number {
  return count === 0 ? 0 : total / count;
}

function trailingConsecutiveDays(events: readonly SafeRolloutExecutionTelemetryEventV1[]): number {
  const days = [...new Set(events.map((event) => event.observedDay))].sort((left, right) => left - right);
  if (days.length === 0) return 0;
  let consecutive = 1;
  for (let index = days.length - 1; index > 0; index -= 1) {
    if (days[index]! - days[index - 1]! !== 1) break;
    consecutive += 1;
  }
  return consecutive;
}

export function aggregateRolloutTelemetryV1(
  events: readonly SafeExecutionTelemetryEventV1[],
): RolloutObservationV1 {
  const rolloutEvents = events.map((event) => JSON.parse(serializeSafeTelemetryEvent(event)) as SafeExecutionTelemetryEventV1)
    .filter((event): event is SafeRolloutExecutionTelemetryEventV1 => event.event === "rollout-execution-observed");
  const baseline = rolloutEvents.filter((event) => event.mode === "baseline");
  const candidate = rolloutEvents.filter((event) => event.mode === "candidate");
  const keys = [...new Set(rolloutEvents.map((event) => `${event.riskTier}:${event.wouldBeLane}`))];
  const riskOrder: readonly TelemetryRiskTierV1[] = ["low", "medium", "high", "critical"];
  const laneOrder: readonly TelemetryLaneV1[] = ["fast", "guarded", "full_sdd"];
  keys.sort((left, right) => {
    const [leftRisk, leftLane] = left.split(":") as [TelemetryRiskTierV1, TelemetryLaneV1];
    const [rightRisk, rightLane] = right.split(":") as [TelemetryRiskTierV1, TelemetryLaneV1];
    return riskOrder.indexOf(leftRisk) - riskOrder.indexOf(rightRisk)
      || laneOrder.indexOf(leftLane) - laneOrder.indexOf(rightLane);
  });

  const metrics = keys.map((key): RolloutMetricObservationV1 => {
    const [riskTier, lane] = key.split(":") as [TelemetryRiskTierV1, TelemetryLaneV1];
    const baselineBucket = baseline.filter((event) => event.riskTier === riskTier && event.wouldBeLane === lane);
    const candidateBucket = candidate.filter((event) => event.riskTier === riskTier && event.wouldBeLane === lane);
    return Object.freeze({
      riskTier,
      lane,
      baselineCount: baselineBucket.length,
      candidateCount: candidateBucket.length,
      baselineMedianAcceptedCompletionMs: median(baselineBucket.map((event) => event.durationMs)),
      candidateMedianAcceptedCompletionMs: median(candidateBucket.map((event) => event.durationMs)),
      baselineMedianPhaseLaunchCount: median(baselineBucket.map((event) => event.phaseLaunchCount)),
      candidateMedianPhaseLaunchCount: median(candidateBucket.map((event) => event.phaseLaunchCount)),
      baselineNoPositiveDeltaCycleRate: rate(baselineBucket.reduce((sum, event) => sum + event.noPositiveDeltaCycleCount, 0), baselineBucket.length),
      candidateNoPositiveDeltaCycleRate: rate(candidateBucket.reduce((sum, event) => sum + event.noPositiveDeltaCycleCount, 0), candidateBucket.length),
      baselineRegistryConflictRate: rate(baselineBucket.reduce((sum, event) => sum + event.registryConflictCount, 0), baselineBucket.length),
      candidateRegistryConflictRate: rate(candidateBucket.reduce((sum, event) => sum + event.registryConflictCount, 0), candidateBucket.length),
      candidateControlPlaneP95Ms: percentile95(candidateBucket.map((event) => event.controlPlaneOverheadMs)),
    });
  });

  const countCandidate = (predicate: (event: SafeRolloutExecutionTelemetryEventV1) => boolean) =>
    candidate.reduce((count, event) => count + (predicate(event) ? 1 : 0), 0);
  const baselineEscapes = baseline.reduce((sum, event) => sum + event.escapedSecurityArchitectureFindingCount, 0);
  const candidateEscapes = candidate.reduce((sum, event) => sum + event.escapedSecurityArchitectureFindingCount, 0);

  return Object.freeze({
    schema: "rollout-observation-v1",
    eligibleExecutions: candidate.length,
    consecutiveDays: trailingConsecutiveDays(candidate),
    observedRunners: Object.freeze((["opencode", "pi"] as const).filter((runner) => candidate.some((event) => event.runner === runner))),
    safety: Object.freeze({
      replayMismatchCount: countCandidate((event) => event.replayOutcome === "mismatched"),
      batchReferenceBreakCount: countCandidate((event) => event.batchReferenceOutcome === "broken"),
      authorizationBypassCount: countCandidate((event) => event.authorizationOutcome === "bypassed"),
      registryHistoryLossCount: countCandidate((event) => event.registryHistoryOutcome === "lost"),
      duplicateRegistryEventCount: countCandidate((event) => event.registryHistoryOutcome === "duplicated"),
      broadCheckMissCount: countCandidate((event) => event.broadCheckOutcome === "missed"),
      freshReviewMissCount: countCandidate((event) => event.freshReviewOutcome === "missed"),
      laneFloorDowngradeCount: countCandidate((event) => event.laneFloorOutcome === "downgraded"),
      adapterDivergenceCount: countCandidate((event) => event.adapterOutcome === "divergent"),
      escapedCriticalFindingCount: candidate.reduce((sum, event) => sum + event.escapedCriticalFindingCount, 0),
      baselineSecurityArchitectureEscapeRate: rate(baselineEscapes, baseline.length),
      candidateSecurityArchitectureEscapeRate: rate(candidateEscapes, candidate.length),
    }),
    metrics: Object.freeze(metrics),
  });
}

export function assignExecutionCohort(changeId: string, cohortPercent: number): boolean {
  if (!Number.isFinite(cohortPercent) || cohortPercent < 0 || cohortPercent > 100) throw new Error("invalid-cohort-percent");
  const bucket = Number.parseInt(createHash("sha256").update(changeId).digest("hex").slice(0, 8), 16) % 100;
  return bucket < cohortPercent;
}

export function probeRunnerExecutionCapabilities(
  runner: TelemetryRunnerV1,
  capabilities: Readonly<{ invocationHook?: boolean; freshAgentHook?: boolean }>,
) {
  const codes: string[] = [];
  if (capabilities.invocationHook !== true) codes.push("INVOCATION_HOOK_UNPROVEN");
  if (capabilities.freshAgentHook !== true) codes.push("FRESH_AGENT_HOOK_UNPROVEN");
  return Object.freeze({
    runner,
    supported: codes.length === 0,
    mode: codes.length === 0 ? "shadow" : "static-compatible",
    codes: Object.freeze(codes),
  });
}
