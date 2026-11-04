import { describe, expect, test } from "bun:test";
import { formatSessionRuntimeReadiness, resolveSessionRuntimeReadiness } from "./session-runtime-readiness";

describe("session runtime readiness", () => {
  test("reflects integration availability for managed and standalone sessions", () => {
    expect(resolveSessionRuntimeReadiness({ topology: "deck-managed" })).toMatchObject({ managedRuntime: "ready", capabilities: {}, reasonCode: "deck-managed-ready" });
    expect(resolveSessionRuntimeReadiness({ topology: "deck-managed", staticIntegrationState: "degraded" })).toMatchObject({ managedRuntime: "degraded", reasonCode: "static-integration-pending" });
    expect(resolveSessionRuntimeReadiness({ topology: "deck-managed", staticIntegrationState: "blocked" })).toMatchObject({ managedRuntime: "blocked", reasonCode: "static-integration-blocked" });
    expect(resolveSessionRuntimeReadiness({ topology: "runner-standalone" })).toMatchObject({ managedRuntime: "degraded", reasonCode: "runner-standalone-static-compatible" });
  });
  test("formats readiness without provider details", () => {
    expect(formatSessionRuntimeReadiness(resolveSessionRuntimeReadiness({ topology: "deck-managed" }))).not.toContain("memory");
  });
});
