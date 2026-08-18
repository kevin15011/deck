import { describe, expect, test } from "bun:test";

import { formatSessionRuntimeReadiness, resolveSessionRuntimeReadiness } from "./session-runtime-readiness";

describe("session runtime readiness", () => {
  test("computes stable managed and standalone reason codes", () => {
    expect(resolveSessionRuntimeReadiness({ topology: "deck-managed", staticIntegrationState: "ready", adaptiveMemoryEnabled: true, hasProjectIdentity: true, runtimeCredentialState: "present" })).toMatchObject({ managedRuntime: "ready", capabilities: { "adaptive-memory": "ready" }, reasonCode: "deck-managed-ready" });
    expect(resolveSessionRuntimeReadiness({ topology: "deck-managed", staticIntegrationState: "ready", adaptiveMemoryEnabled: false, hasProjectIdentity: true, runtimeCredentialState: "missing" })).toMatchObject({ managedRuntime: "ready", capabilities: { "adaptive-memory": "disabled" }, reasonCode: "adaptive-memory-disabled" });
    expect(resolveSessionRuntimeReadiness({ topology: "deck-managed", staticIntegrationState: "ready", adaptiveMemoryEnabled: true, hasProjectIdentity: false, runtimeCredentialState: "present" })).toMatchObject({ managedRuntime: "blocked", capabilities: { "adaptive-memory": "blocked" }, reasonCode: "managed-runtime-project-missing" });
    expect(resolveSessionRuntimeReadiness({ topology: "deck-managed", staticIntegrationState: "ready", adaptiveMemoryEnabled: true, hasProjectIdentity: true, runtimeCredentialState: "missing" })).toMatchObject({ managedRuntime: "blocked", capabilities: { "adaptive-memory": "blocked" }, reasonCode: "managed-runtime-auth-missing" });
    expect(resolveSessionRuntimeReadiness({ topology: "deck-managed", staticIntegrationState: "ready", adaptiveMemoryEnabled: true, hasProjectIdentity: true, runtimeCredentialState: "deferred" })).toMatchObject({ managedRuntime: "degraded", capabilities: { "adaptive-memory": "degraded" }, reasonCode: "managed-runtime-auth-deferred" });
    expect(resolveSessionRuntimeReadiness({ topology: "deck-managed", staticIntegrationState: "degraded", adaptiveMemoryEnabled: true, hasProjectIdentity: true, runtimeCredentialState: "present" })).toMatchObject({ staticIntegration: "degraded", managedRuntime: "degraded", reasonCode: "static-integration-pending" });
    expect(resolveSessionRuntimeReadiness({ topology: "runner-standalone", staticIntegrationState: "ready", adaptiveMemoryEnabled: true, hasProjectIdentity: true, runtimeCredentialState: "missing" })).toMatchObject({ managedRuntime: "degraded", capabilities: { "adaptive-memory": "degraded" }, reasonCode: "runner-standalone-static-compatible" });
    expect(resolveSessionRuntimeReadiness({ topology: "deck-managed", staticIntegrationState: "blocked", adaptiveMemoryEnabled: true, hasProjectIdentity: true, runtimeCredentialState: "present" })).toMatchObject({ staticIntegration: "blocked", managedRuntime: "blocked", reasonCode: "static-integration-blocked" });
  });

  test("formats metadata-only readiness without raw identity fields", () => {
    const text = formatSessionRuntimeReadiness(resolveSessionRuntimeReadiness({ topology: "deck-managed", staticIntegrationState: "ready", adaptiveMemoryEnabled: true, hasProjectIdentity: true, runtimeCredentialState: "deferred" }));
    expect(text).toContain("reason=managed-runtime-auth-deferred");
    expect(text).not.toContain("sm_project_v1_");
    expect(text).not.toContain("deck-session-");
  });
});
