import type { ManagedCapabilityState, SessionRuntimeReadiness, SessionTopology } from "@deck/core";

export type SessionRuntimeReadinessReasonCode =
  | "deck-managed-ready"
  | "adaptive-memory-disabled"
  | "static-integration-pending"
  | "managed-runtime-auth-missing"
  | "managed-runtime-auth-deferred"
  | "managed-runtime-project-missing"
  | "runner-standalone-static-compatible"
  | "static-integration-blocked"
  | "supermemory-provider-api-failed"
  | "supermemory-observability-degraded"
  | "supermemory-loopback-degraded"
  | "supermemory-capture-degraded"
  | "supermemory-cleanup-degraded";

export type ResolveSessionRuntimeReadinessInput = Readonly<{
  topology: SessionTopology;
  staticIntegrationReady?: boolean;
  staticIntegrationState?: ManagedCapabilityState;
  adaptiveMemoryEnabled: boolean;
  hasProjectIdentity: boolean;
  runtimeCredentialState: "present" | "missing" | "deferred";
  providerConnectivityState?: ManagedCapabilityState;
  observabilityState?: ManagedCapabilityState;
  loopbackState?: ManagedCapabilityState;
  captureState?: ManagedCapabilityState;
  cleanupState?: ManagedCapabilityState;
}>;

export function resolveSessionRuntimeReadiness(input: ResolveSessionRuntimeReadinessInput): SessionRuntimeReadiness & { reasonCode: SessionRuntimeReadinessReasonCode } {
  const staticIntegration = input.staticIntegrationState ?? (input.staticIntegrationReady === false ? "blocked" : "ready");
  const providerConnectivity = input.providerConnectivityState ?? "ready";
  const observability = input.observabilityState ?? "ready";
  const loopback = input.loopbackState ?? "ready";
  const capture = input.captureState ?? "ready";
  const cleanup = input.cleanupState ?? "ready";
  if (input.topology === "runner-standalone") {
    return readiness("runner-standalone", "ready", "degraded", { "adaptive-memory": "degraded" }, "runner-standalone-static-compatible");
  }
  if (!input.adaptiveMemoryEnabled) {
    return readiness("deck-managed", staticIntegration, "ready", { "adaptive-memory": "disabled" }, "adaptive-memory-disabled");
  }
  if (staticIntegration === "blocked") {
    return readiness(input.topology, "blocked", "blocked", { "adaptive-memory": "blocked" }, "static-integration-blocked");
  }
  if (staticIntegration === "degraded") {
    return readiness(input.topology, "degraded", "degraded", { "adaptive-memory": "degraded" }, "static-integration-pending");
  }
  if (!input.hasProjectIdentity) {
    return readiness("deck-managed", "ready", "blocked", { "adaptive-memory": "blocked" }, "managed-runtime-project-missing");
  }
  if (input.runtimeCredentialState === "missing") {
    return readiness("deck-managed", "ready", "blocked", { "adaptive-memory": "blocked" }, "managed-runtime-auth-missing");
  }
  if (input.runtimeCredentialState === "deferred") {
    return readiness("deck-managed", "ready", "degraded", { "adaptive-memory": "degraded" }, "managed-runtime-auth-deferred");
  }
  if (providerConnectivity === "blocked" || providerConnectivity === "degraded") {
    return readiness("deck-managed", "ready", providerConnectivity, { "adaptive-memory": providerConnectivity }, "supermemory-provider-api-failed");
  }
  if (observability === "blocked" || observability === "degraded") {
    return readiness("deck-managed", "ready", "degraded", { "adaptive-memory": "degraded" }, "supermemory-observability-degraded");
  }
  if (loopback === "blocked" || loopback === "degraded") {
    return readiness("deck-managed", "ready", "degraded", { "adaptive-memory": "degraded" }, "supermemory-loopback-degraded");
  }
  if (capture === "blocked" || capture === "degraded") {
    return readiness("deck-managed", "ready", "degraded", { "adaptive-memory": "degraded" }, "supermemory-capture-degraded");
  }
  if (cleanup === "blocked" || cleanup === "degraded") {
    return readiness("deck-managed", "ready", "degraded", { "adaptive-memory": "degraded" }, "supermemory-cleanup-degraded");
  }
  return readiness("deck-managed", "ready", "ready", { "adaptive-memory": "ready" }, "deck-managed-ready");
}

function readiness(
  topology: SessionTopology,
  staticIntegration: ManagedCapabilityState,
  managedRuntime: ManagedCapabilityState,
  capabilities: Readonly<Record<string, ManagedCapabilityState>>,
  reasonCode: SessionRuntimeReadinessReasonCode,
): SessionRuntimeReadiness & { reasonCode: SessionRuntimeReadinessReasonCode } {
  return Object.freeze({ topology, staticIntegration, managedRuntime, capabilities: Object.freeze({ ...capabilities }), reasonCode });
}

export function formatSessionRuntimeReadiness(readiness: SessionRuntimeReadiness & { reasonCode: string }): string {
  return `Session topology: ${readiness.topology}; static=${readiness.staticIntegration}; managed=${readiness.managedRuntime}; adaptive-memory=${readiness.capabilities["adaptive-memory"] ?? "disabled"}; reason=${readiness.reasonCode}.`;
}
