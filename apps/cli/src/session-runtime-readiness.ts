import type { ManagedCapabilityState, SessionRuntimeReadiness, SessionTopology } from "@deck/core";

export type SessionRuntimeReadinessReasonCode =
  | "deck-managed-ready"
  | "static-integration-pending"
  | "runner-standalone-static-compatible"
  | "static-integration-blocked";

export type ResolveSessionRuntimeReadinessInput = Readonly<{
  topology: SessionTopology;
  staticIntegrationReady?: boolean;
  staticIntegrationState?: ManagedCapabilityState;
}>;

export function resolveSessionRuntimeReadiness(input: ResolveSessionRuntimeReadinessInput): SessionRuntimeReadiness & { reasonCode: SessionRuntimeReadinessReasonCode } {
  const staticIntegration = input.staticIntegrationState ?? (input.staticIntegrationReady === false ? "blocked" : "ready");
  const standalone = input.topology === "runner-standalone";
  const reasonCode = standalone ? "runner-standalone-static-compatible"
    : staticIntegration === "blocked" ? "static-integration-blocked"
    : staticIntegration === "degraded" ? "static-integration-pending" : "deck-managed-ready";
  return Object.freeze({ topology: input.topology, staticIntegration, managedRuntime: standalone ? "degraded" : staticIntegration, capabilities: Object.freeze({}), reasonCode });
}

export function formatSessionRuntimeReadiness(readiness: SessionRuntimeReadiness & { reasonCode: string }): string {
  return `Session topology: ${readiness.topology}; static=${readiness.staticIntegration}; managed=${readiness.managedRuntime}; reason=${readiness.reasonCode}.`;
}
