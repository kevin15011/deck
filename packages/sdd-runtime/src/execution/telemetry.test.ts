import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assignExecutionCohort,
  aggregateRolloutTelemetryV1,
  createBoundedLocalTelemetrySink,
  createConfiguredTelemetrySinkV1,
  createNoopTelemetrySink,
  probeRunnerExecutionCapabilities,
  recordBoundedBaseline,
  serializeSafeTelemetryEvent,
} from "./telemetry";
import { EXECUTION_V1_FIXTURES } from "../fixtures/execution-v1";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function rolloutEvent(
  mode: "baseline" | "candidate",
  index: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    schema: "safe-execution-telemetry-v1" as const,
    event: "rollout-execution-observed" as const,
    runner: index % 2 === 0 ? "opencode" as const : "pi" as const,
    phase: "review" as const,
    riskTier: "high" as const,
    wouldBeLane: "full_sdd" as const,
    outcomeCode: "accepted",
    count: 1,
    durationMs: mode === "baseline" ? 100 : 90,
    mode,
    observedDay: 20_000 + (index % 14),
    phaseLaunchCount: mode === "baseline" ? 10 : 8,
    noPositiveDeltaCycleCount: mode === "baseline" ? 1 : 0,
    registryConflictCount: mode === "baseline" ? 1 : 0,
    controlPlaneOverheadMs: mode === "baseline" ? 0 : 50,
    replayOutcome: "matched" as const,
    batchReferenceOutcome: "continuous" as const,
    authorizationOutcome: "enforced" as const,
    registryHistoryOutcome: "preserved" as const,
    broadCheckOutcome: "compliant" as const,
    freshReviewOutcome: "compliant" as const,
    laneFloorOutcome: "preserved" as const,
    adapterOutcome: "parity" as const,
    escapedCriticalFindingCount: 0,
    escapedSecurityArchitectureFindingCount: 0,
    ...overrides,
  };
}

describe("safe execution telemetry baseline", () => {
  test("serializes only the closed allowlist and leaks none of the seeded secrets", () => {
    const serialized = serializeSafeTelemetryEvent(EXECUTION_V1_FIXTURES.secretSeededTelemetry);
    for (const secret of EXECUTION_V1_FIXTURES.secretSeeds) expect(serialized).not.toContain(secret);
    expect(JSON.parse(serialized)).toEqual(EXECUTION_V1_FIXTURES.safeTelemetryProjection);
  });

  test("rejects telemetry values outside the runtime vocabulary", () => {
    for (const event of EXECUTION_V1_FIXTURES.invalidTelemetryValues) {
      expect(() => serializeSafeTelemetryEvent(event)).toThrow("invalid-safe-telemetry-event");
    }
    expect(() => serializeSafeTelemetryEvent({
      ...EXECUTION_V1_FIXTURES.safeTelemetryProjection,
      outcomeCode: "a".repeat(129),
    })).toThrow("invalid-safe-telemetry-event");
  });

  test("noop and bounded local sinks cannot control effects", async () => {
    const noop = createNoopTelemetrySink();
    await expect(noop.emit(EXECUTION_V1_FIXTURES.safeTelemetryProjection)).resolves.toBeUndefined();
    const sink = createBoundedLocalTelemetrySink(2);
    await sink.emit(EXECUTION_V1_FIXTURES.safeTelemetryProjection);
    await sink.emit({ ...EXECUTION_V1_FIXTURES.safeTelemetryProjection, outcomeCode: "second" });
    await sink.emit({ ...EXECUTION_V1_FIXTURES.safeTelemetryProjection, outcomeCode: "third" });
    expect(sink.snapshot().map((event) => event.outcomeCode)).toEqual(["second", "third"]);
  });

  test("records a bounded baseline from real fixture executions", async () => {
    const sink = createBoundedLocalTelemetrySink(2);
    const recorded = await recordBoundedBaseline(EXECUTION_V1_FIXTURES.baselineExecutions, sink, 2);
    expect(recorded).toEqual(EXECUTION_V1_FIXTURES.baselines);
    expect(sink.snapshot()).toEqual(EXECUTION_V1_FIXTURES.baselines);
  });

  test("cohort assignment and recorded baselines are deterministic", () => {
    expect(assignExecutionCohort("change-a", 25)).toBe(assignExecutionCohort("change-a", 25));
    expect(EXECUTION_V1_FIXTURES.baselines.map((x) => [x.riskTier, x.wouldBeLane])).toEqual([
      ["medium", "guarded"], ["high", "full_sdd"],
    ]);
  });

  test("unsupported runner hooks fail closed with safe static-compatible codes", () => {
    expect(probeRunnerExecutionCapabilities("opencode", {})).toEqual(EXECUTION_V1_FIXTURES.capabilityProbes.opencode);
    expect(probeRunnerExecutionCapabilities("pi", {})).toEqual(EXECUTION_V1_FIXTURES.capabilityProbes.pi);
  });

  test("serializes and aggregates only redacted rollout metrics by lane and risk tier", () => {
    const baseline = Array.from({ length: 100 }, (_, index) => rolloutEvent("baseline", index));
    const candidate = Array.from({ length: 100 }, (_, index) => rolloutEvent("candidate", index));
    const secretSeeded = {
      ...candidate[0],
      rawPrompt: "PROMPT_SECRET_SHOULD_NOT_LEAK",
      authorizationProof: "AUTH_PROOF_SHOULD_NOT_LEAK",
      diagnostic: "/home/private/project",
    };

    const serialized = serializeSafeTelemetryEvent(secretSeeded);
    expect(serialized).not.toContain("PROMPT_SECRET_SHOULD_NOT_LEAK");
    expect(serialized).not.toContain("AUTH_PROOF_SHOULD_NOT_LEAK");
    expect(serialized).not.toContain("/home/private/project");

    const observation = aggregateRolloutTelemetryV1([...baseline, secretSeeded, ...candidate.slice(1)]);
    expect(observation).toEqual(expect.objectContaining({
      schema: "rollout-observation-v1",
      eligibleExecutions: 100,
      consecutiveDays: 14,
      observedRunners: ["opencode", "pi"],
      safety: expect.objectContaining({
        replayMismatchCount: 0,
        authorizationBypassCount: 0,
        adapterDivergenceCount: 0,
      }),
    }));
    expect(observation.metrics).toEqual([
      expect.objectContaining({
        riskTier: "high",
        lane: "full_sdd",
        baselineMedianAcceptedCompletionMs: 100,
        candidateMedianAcceptedCompletionMs: 90,
        candidateControlPlaneP95Ms: 50,
      }),
    ]);
  });

  test("writes configured local-safe JSONL, rotates at the byte bound, and prunes expired rotations", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-telemetry-"));
    temporaryDirectories.push(projectRoot);
    const telemetryDir = join(projectRoot, ".deck", "runtime", "execution-telemetry");
    await mkdir(telemetryDir, { recursive: true });
    const stalePath = join(telemetryDir, "v1.1.jsonl");
    await writeFile(stalePath, "stale\n", "utf8");
    const nowMs = 2_000_000_000_000;
    const staleMs = nowMs - 31 * 24 * 60 * 60 * 1_000;
    await utimes(stalePath, staleMs / 1_000, staleMs / 1_000);
    const serialized = `${serializeSafeTelemetryEvent(EXECUTION_V1_FIXTURES.safeTelemetryProjection)}\n`;
    const sink = createConfiguredTelemetrySinkV1({
      mode: "local-safe",
      projectRoot,
      maxBytes: Buffer.byteLength(serialized) + 1,
      now: () => nowMs,
    });

    await sink.emit(EXECUTION_V1_FIXTURES.safeTelemetryProjection);
    await sink.emit({ ...EXECUTION_V1_FIXTURES.safeTelemetryProjection, outcomeCode: "rotated" });

    const files = (await readdir(telemetryDir)).sort();
    expect(files).toEqual(["v1.2000000000000.jsonl", "v1.jsonl"]);
    expect((await readFile(join(telemetryDir, "v1.jsonl"), "utf8")).trim()).toContain("rotated");
    expect((await stat(join(telemetryDir, "v1.2000000000000.jsonl"))).size).toBeGreaterThan(0);
  });

  test("rejects an unknown configured sink mode instead of enabling local writes", () => {
    expect(() => createConfiguredTelemetrySinkV1({
      mode: "remote" as never,
      projectRoot: "/tmp/deck-telemetry-invalid-mode",
    })).toThrow("invalid-telemetry-mode");
  });

  test("expires a low-volume active log at the configured retention bound", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-telemetry-retention-"));
    temporaryDirectories.push(projectRoot);
    let nowMs = Date.now();
    let sink = createConfiguredTelemetrySinkV1({
      mode: "local-safe",
      projectRoot,
      retentionDays: 30,
      now: () => nowMs,
    });

    await sink.emit({ ...EXECUTION_V1_FIXTURES.safeTelemetryProjection, outcomeCode: "expired" });
    const activePath = join(projectRoot, ".deck", "runtime", "execution-telemetry", "v1.jsonl");
    const activeMetadata = await stat(activePath);
    nowMs = (activeMetadata.birthtimeMs > 0 ? activeMetadata.birthtimeMs : activeMetadata.mtimeMs)
      + 30 * 24 * 60 * 60 * 1_000 + 1;
    sink = createConfiguredTelemetrySinkV1({
      mode: "local-safe",
      projectRoot,
      retentionDays: 30,
      now: () => nowMs,
    });
    await sink.emit({ ...EXECUTION_V1_FIXTURES.safeTelemetryProjection, outcomeCode: "retained" });

    const current = await readFile(activePath, "utf8");
    expect(current).not.toContain("expired");
    expect(current).toContain("retained");
  });

  test("drops local telemetry failures unless evidence is explicitly required for rollout", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-telemetry-failure-"));
    temporaryDirectories.push(projectRoot);
    await writeFile(join(projectRoot, ".deck"), "not-a-directory", "utf8");
    const optional = createConfiguredTelemetrySinkV1({ mode: "local-safe", projectRoot });
    const required = createConfiguredTelemetrySinkV1({
      mode: "local-safe",
      projectRoot,
      requiredForRollout: true,
    });

    await expect(optional.emit(EXECUTION_V1_FIXTURES.safeTelemetryProjection)).resolves.toBeUndefined();
    expect(optional.lastDiagnostic()).toBe("telemetry-write-failed");
    await expect(required.emit(EXECUTION_V1_FIXTURES.safeTelemetryProjection)).rejects.toThrow(
      "telemetry-evidence-unavailable",
    );
  });
});
