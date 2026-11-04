import { additionalReadinessParticipants, validReadinessProjection, type ReadinessProjection } from "./readiness-parity";
import { isCurrentCodebaseAvailability, type CodebaseAvailabilityDisposition } from "./codebase-availability";
import { assertSessionCapabilityOverrides, isReadOnlyRole, ROLE_TOOL_POLICY, readOnlyMcpTools } from "./role-tool-policy";
export type ParityLaunchShape = {
  roleSource: { kind: "native-agent" | "verified-bytes"; ref: string; hash: string };
  roleTools: { builtins: string[]; mcpAllowed: string[]; mcpDefault: "allow" | "deny" };
  skillsRoots: string[]; skillPreload: string[]; plugins: string[]; hooks: string[]; executionPolicy: string[];
  mcpInstalled?: Record<string, string>;
  codebase?: { route: "native" | "managed"; omitted: boolean; evidence?: CodebaseAvailabilityDisposition };
  mcpNative: Record<string, string>; mcpAdded: string[]; mcpOverridden: string[];
  webSearch: { route: "disabled" | "native" | "fallback"; serverId?: string };
  settingSources: string; projectInstructions: "native" | "native-hook" | "none";
  model?: string; effort?: string; permissionMode: "native" | "relay" | "yolo";
  delegation: "native" | "deck"; overlaySections: string[];
  sessionStartContext: ReadinessProjection;
};
export type ParityAllowEntry = {
  runner: string; field: keyof ParityLaunchShape | "sessionStartContext.coordination" | "*"; rule: string;
  category: "ledger" | "delegation" | "approval-relay" | "session-mode" | "evidence" | "headless-transport" | "capability-override" | "unsupported" | "temporary-tracked";
  justification: string; necessityTest?: string; temporary?: { owner: string; expiresWhen: string; reviewBy: string };
};
export const SESSION_PARITY_ALLOWLIST: readonly ParityAllowEntry[] = [
  { runner: "*", field: "delegation", rule: "deck-delegation", category: "delegation", justification: "Cross-runner members are ledger tasks." },
  { runner: "*", field: "overlaySections", rule: "closed-overlay", category: "ledger", justification: "Session coordination only." },
  { runner: "*", field: "mcpAdded", rule: "deck-only", category: "ledger", justification: "Authenticated session transport." },
  { runner: "*", field: "permissionMode", rule: "relay", category: "approval-relay", justification: "Headless approval relay." },
  { runner: "*", field: "permissionMode", rule: "yolo", category: "session-mode", justification: "Explicit session choice." },
  ...(["model", "effort"] as const).map(field => ({ runner: "*", field, rule: "assignment", category: "ledger" as const, justification: "Explicit cross-runner assignment." })),
  { runner: "*", field: "mcpOverridden", rule: "codebase-memory", category: "capability-override", justification: "Shared task binding, digest verification and release.", necessityTest: "apps/cli/src/session-codebase-readiness.test.ts" },
  { runner: "codex", field: "hooks", rule: "exact-trusted-hash", category: "approval-relay", justification: "Stricter native hook admission." },
  { runner: "opencode", field: "*", rule: "headless-transport", category: "headless-transport", justification: "Loopback serve, sharing and updates disabled." },
  { runner: "pi", field: "*", rule: "unsupported", category: "unsupported", justification: "No session driver." },
  { runner: "*", field: "sessionStartContext.coordination", rule: "additional-participants", category: "evidence", justification: "Additional participant coordination only; local delivery is identical." },
];
function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => JSON.parse(canonical(item))));
  if (value && typeof value === "object") return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, JSON.parse(canonical(v))])));
  return JSON.stringify(value ?? null);
}
/** Call with only applicable entries; unused exceptions fail rather than silently accumulating. */
export function diffParity(native: ParityLaunchShape, session: ParityLaunchShape, options: {
  webSearchToolNames?: Readonly<Record<string, string>>;
  runner: string; roleId: string; enabledCapabilities?: readonly string[]; allow: readonly ParityAllowEntry[]; now?: string; necessityTestExists: (path: string) => boolean;
}): string[] {
  const errors: string[] = [], used = new Set<ParityAllowEntry>();
  const capabilities = options.enabledCapabilities ?? [];
  const allowedMcp = new Set(readOnlyMcpTools(capabilities, (server, tool) => {
    if (server === "web-search") {
      const nativeName = options.webSearchToolNames?.[tool];
      return nativeName && /^[A-Za-z][A-Za-z0-9_-]*$/.test(nativeName) ? options.runner === "claude" ? [`mcp__${server}__${nativeName}`] : options.runner === "opencode" ? [`${server}_${nativeName}`] : [] : [];
    }
    if (options.runner === "claude") return server === "codebase-memory"
      ? [`mcp__plugin_deck-developer-team_${server}__${tool}`, `mcp__${server}__${tool}`]
      : [`mcp__plugin_deck-developer-team_${server}__${tool}`];
    if (options.runner === "opencode") return [`${server}_${tool}`];
    return []; // No verified translation: equality cannot establish safety.
  }));
  const codebaseProjectionValid = (shape: ParityLaunchShape) => {
    const binding = shape.codebase, installed = shape.mcpInstalled?.["codebase-memory"];
    if (!binding || !installed) return false;
    if (binding.omitted) return !!binding.evidence && isCurrentCodebaseAvailability(binding.evidence)
      && binding.evidence.route === binding.route && binding.evidence.generation === shape.executionPolicy[0]
      && !shape.mcpNative["codebase-memory"] && !shape.mcpOverridden.includes("codebase-memory") && !shape.mcpAdded.includes("codebase-memory");
    return !binding.evidence && (binding.route === "native" ? shape.mcpNative["codebase-memory"] === installed && !shape.mcpOverridden.includes("codebase-memory") : !shape.mcpNative["codebase-memory"] && shape.mcpOverridden.includes("codebase-memory"));
  };
  const boundedCodebaseDifference = codebaseProjectionValid(native) && codebaseProjectionValid(session)
    && canonical(native.mcpInstalled) === canonical(session.mcpInstalled)
    && (native.codebase!.route !== session.codebase!.route || native.codebase!.omitted === session.codebase!.omitted);
  for (const shape of [native, session]) {
    if (!validReadinessProjection(shape.sessionStartContext)) errors.push("sessionStartContext: invalid-projection");
    if (shape.codebase && !codebaseProjectionValid(shape)) errors.push("codebase: invalid-backend-evidence");
    if (shape.mcpInstalled) {
      for (const id of new Set([...Object.keys(shape.mcpInstalled), ...Object.keys(shape.mcpNative)])) {
        if (id === "codebase-memory" && codebaseProjectionValid(shape)) continue;
        if (shape.mcpInstalled[id] !== shape.mcpNative[id]) errors.push("mcpNative: unjustified-native-loss");
      }
    }
    try { assertSessionCapabilityOverrides(shape.mcpOverridden); } catch { errors.push("session-capability-override-unlisted"); }
    if (isReadOnlyRole(options.roleId) && (shape.roleTools.mcpDefault !== "deny" || shape.roleTools.builtins.some(tool => ![...ROLE_TOOL_POLICY.builtins, "find", "ls", ...(options.runner === "claude" && capabilities.includes("web-search") && shape.webSearch.route !== "disabled" ? ["websearch", "webfetch"] : [])].includes(tool.toLowerCase())))) errors.push("roleTools: unsafe-read-only");
    if (isReadOnlyRole(options.roleId) && (!Array.isArray(shape.roleTools.mcpAllowed) || shape.roleTools.mcpAllowed.some(tool => !allowedMcp.has(tool)))) errors.push("roleTools: unsafe-mcp-grant");
  }
  for (const entry of options.allow) {
    if (entry.category === "capability-override" && (!entry.necessityTest || !options.necessityTestExists(entry.necessityTest))) errors.push("necessity-test-missing");
    if (entry.category === "temporary-tracked" && (!entry.temporary?.owner || !entry.temporary.expiresWhen || !/^\d{4}-\d{2}-\d{2}$/.test(entry.temporary.reviewBy) || entry.temporary.reviewBy < (options.now ?? new Date().toISOString().slice(0, 10)))) errors.push("temporary-entry-invalid-or-expired");
  }
  const fields = new Set([...Object.keys(native), ...Object.keys(session)]);
  for (const key of fields) {
    const field = key as keyof ParityLaunchShape;
    if (canonical(native[field]) === canonical(session[field])) continue;
    if (field === "codebase" && boundedCodebaseDifference) continue;
    if (field === "mcpNative" && boundedCodebaseDifference) {
      const withoutCodebase = (record: Record<string, string>) => Object.fromEntries(Object.entries(record).filter(([id]) => id !== "codebase-memory"));
      if (canonical(withoutCodebase(native.mcpNative)) === canonical(withoutCodebase(session.mcpNative))) continue;
    }
    if (["mcpNative", "webSearch", "roleTools"].includes(field)) { errors.push(`${field}: protected-difference`); continue; }
    let eligible: ParityAllowEntry["field"] = field;
    if (field === "sessionStartContext") {
      const a = native.sessionStartContext, b = session.sessionStartContext;
      if (a.channel !== b.channel || a.localBaseDigest !== b.localBaseDigest || a.coordinationScopeDigest === b.coordinationScopeDigest) { errors.push(`${field}: native-delivery-or-equal-scope-difference`); continue; }
      if (!additionalReadinessParticipants(a, b)) { errors.push(`${field}: coordination-proof-unavailable`); continue; }
      eligible = "sessionStartContext.coordination";
    }
    const entry = options.allow.find(e => (e.runner === "*" || e.runner === options.runner) && e.field === eligible
      && (field !== "permissionMode" || e.rule === session.permissionMode)
      && (field !== "mcpAdded" || session.mcpAdded.every(id => id === "deck")));
    if (entry) used.add(entry); else errors.push(`${field}: unlisted-difference`);
  }
  for (const entry of options.allow) if (!used.has(entry)) errors.push(`${entry.field}: unused-entry`);
  return errors;
}
