import { projectReadinessParity, readinessContext } from "./readiness-parity";
import { expect, test } from "bun:test";
import { diffParity, SESSION_PARITY_ALLOWLIST, type ParityLaunchShape } from "./parity";
const readiness = () => {
  const snapshot = { snapshotId: "fixture", scope: { projectRoot: "/fixture", sessionId: "s", epoch: "e", policyDigest: "p", members: [] }, observations: [] };
  return projectReadinessParity(snapshot, "", readinessContext(snapshot));
};
const base = (): ParityLaunchShape => ({ roleSource: { kind: "native-agent", ref: "deck-quality", hash: "h" }, roleTools: { builtins: ["read"], mcpAllowed: [], mcpDefault: "deny" }, skillsRoots: [], skillPreload: [], plugins: [], hooks: [], executionPolicy: [], mcpNative: { context7: "h" }, mcpAdded: [], mcpOverridden: [], webSearch: { route: "native" }, memory: { scope: "project", envSecrets: [] }, settingSources: "user", projectInstructions: "native-hook", permissionMode: "native", delegation: "native", overlaySections: [], sessionStartContext: readiness() });
const opts = { runner: "claude", roleId: "deck-quality", allow: [], now: "2026-10-27", necessityTestExists: () => true };
test("guard detects unlisted, protected and unsafe native differences without normalization", () => {
  expect(diffParity(base(), base(), opts)).toEqual([]);
  for (const field of ["mcpNative", "webSearch", "roleTools", "memory"] as const) {
    const session = base(); (session as any)[field] = { bad: true, scope: "project", builtins: [], mcpDefault: "deny" };
    expect(diffParity(base(), session, opts).some(e => e.startsWith(field))).toBe(true);
  }
  const unsafe = base(); unsafe.roleTools.builtins.push("Bash");
  expect(diffParity(unsafe, unsafe, opts)).toContain("roleTools: unsafe-read-only");
  unsafe.roleTools = { builtins: ["read"], mcpAllowed: [], mcpDefault: "allow" };
  expect(diffParity(unsafe, unsafe, opts)).toContain("roleTools: unsafe-read-only");
  const session = base(); session.plugins.push("unexpected");
  expect(diffParity(base(), session, opts)).toContain("plugins: unlisted-difference");
});
test("exceptions must be used, necessity backed and temporary dates valid", () => {
  const override = SESSION_PARITY_ALLOWLIST.find(e => e.field === "mcpOverridden")!;
  expect(diffParity(base(), base(), { ...opts, allow: [override] })).toContain("mcpOverridden: unused-entry");
  const rebound = base(); rebound.mcpOverridden = ["codebase-memory"];
  expect(diffParity(base(), rebound, { ...opts, allow: [override], necessityTestExists: () => false })).toContain("necessity-test-missing");
  const global = base(); global.memory = { scope: "global", envSecrets: ["TRANSPORT"] };
  const native = base(); native.memory = { scope: "off", envSecrets: [] };
  const memory = SESSION_PARITY_ALLOWLIST.find(e => e.field === "memory" && e.runner === "claude")!;
  expect(diffParity(native, global, opts)).toContain("memory: unlisted-difference");
  expect(diffParity(native, global, { ...opts, allow: [memory] })).toEqual([]);
  expect(diffParity(native, global, { ...opts, allow: [memory], now: "2026-11-24" })).toContain("temporary-entry-invalid-or-expired");
  expect(diffParity(native, global, { ...opts, allow: [{ ...memory, temporary: undefined }] })).toContain("temporary-entry-invalid-or-expired");
});
test("coordination cannot waive native channel, base or equal-scope bytes", () => {
  const allow = SESSION_PARITY_ALLOWLIST.filter(e => e.field === "sessionStartContext.coordination");
  const changed = base(); changed.sessionStartContext.coordinationOutputDigest = "different";
  expect(diffParity(base(), changed, { ...opts, allow })).toContain("sessionStartContext: native-delivery-or-equal-scope-difference");
  changed.sessionStartContext.coordinationScopeDigest = "additional";
  expect(diffParity(base(), changed, { ...opts, allow })).toContain("sessionStartContext: coordination-proof-unavailable");
  changed.sessionStartContext.channel = "overlay";
  expect(diffParity(base(), changed, { ...opts, allow })).toContain("sessionStartContext: native-delivery-or-equal-scope-difference");
});
test("tracked exceptions require review when the real review date passes", () => {
  const today = new Date().toISOString().slice(0, 10);
  for (const entry of SESSION_PARITY_ALLOWLIST.filter(e => e.category === "temporary-tracked")) {
    expect(entry.temporary!.reviewBy >= today).toBe(true);
  }
});

test("equal unsafe MCP grants fail independently of equality and exceptions", () => {
  for (const tool of ["mcp__*", "mcp__user__shell", "mcp__codebase-memory__delete_project", "mcp__codebase-memory__search_graph"]) {
    const shape = base(); shape.roleTools.mcpAllowed = [tool];
    expect(diffParity(shape, structuredClone(shape), opts)).toContain("roleTools: unsafe-mcp-grant");
  }
  const safe = base(); safe.roleTools.mcpAllowed = ["mcp__codebase-memory__search_graph"];
  expect(diffParity(safe, structuredClone(safe), { ...opts, enabledCapabilities: ["codebase-memory"] })).toEqual([]);
  safe.roleTools.mcpAllowed.push("mcp__codebase-memory__delete_project");
  expect(diffParity(safe, structuredClone(safe), { ...opts, enabledCapabilities: ["codebase-memory"] })).toContain("roleTools: unsafe-mcp-grant");
});

test('web MCP translation requires an explicit exact provider tool mapping', () => {
  const shape = base(); shape.roleTools.mcpAllowed = ['mcp__web-search__provider_search'];
  const enabled = { ...opts, enabledCapabilities: ['web-search'] };
  expect(diffParity(shape, shape, enabled)).toContain('roleTools: unsafe-mcp-grant');
  expect(diffParity(shape, shape, { ...enabled, webSearchToolNames: { search: 'provider_search', extract: 'provider_extract' } })).toEqual([]);
  shape.roleTools.mcpAllowed = ['mcp__web-search__*'];
  expect(diffParity(shape, shape, { ...enabled, webSearchToolNames: { search: '*' } })).toContain('roleTools: unsafe-mcp-grant');
});
