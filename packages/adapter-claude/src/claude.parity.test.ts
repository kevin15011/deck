import { ProjectPreparationService } from "../../sdd-runtime/src/execution/project-preparation";
import { composeSessionStartContextV1, readSessionProjectInstructions } from "../../sdd-runtime/src/execution/session-start-context";
import { projectReadinessParity } from "@deck/core/session/readiness-parity";
function readiness(root: string) {
  const snapshot = new ProjectPreparationService().status({ projectRoot: root, sessionId: "parity", epoch: "fixture", policyDigest: "fixture", members: [{ memberId: "lead", runnerId: "claude", bindingId: "lead@claude", capabilities: {} }] });
  return { snapshot, text: composeSessionStartContextV1(snapshot) };
}
import { issueCodebaseAvailability, type CodebaseAvailabilityDisposition } from "@deck/core/session/codebase-availability";
import { expect, test, setDefaultTimeout } from "bun:test";
setDefaultTimeout(30_000);
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultDeckConfig } from "@deck/core";
import { createClaudeRunnerAdapter } from "./runner-adapter";
import { buildClaudeTurnLaunch } from "./session-driver/launch";
import { skillHash } from "./session-skills";
import { diffParity, SESSION_PARITY_ALLOWLIST, type ParityLaunchShape } from "@deck/core/session/parity";
import { renderSessionOverlay } from "@deck/core/session/overlay";

const value = (args: readonly string[], flag: string) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
// Parse actual plans and installed bytes separately for each lane. No equality rewriting.
function shape(args: readonly string[], role: string, generation: string, session: boolean, files: Map<string, string>, evidence?: CodebaseAvailabilityDisposition): ParityLaunchShape {
  const root = value(args, "--plugin-dir")!;
  const selected = value(args, "--agent");
  if (!selected || !root) throw new Error("role-selection-missing");
  // Native Lead delegates to an installed role using this same native plugin selection.
  const roleRef = selected;
  if (roleRef !== `deck-developer-team:${role}`) throw new Error("role-selection-mismatch");
  const roleFile = readFileSync(join(root, "agents", roleRef.split(":")[1] + ".md"), "utf8");
  const tools = roleFile.match(/^tools: (.*)$/m)?.[1]?.split(", ");
  if (role === "deck-quality" && !tools) throw new Error("role-tools-missing");
  const manifest = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")).mcpServers;
  const hooks = JSON.parse(readFileSync(join(root, "hooks/hooks.json"), "utf8")).hooks;
  if (!hooks.SessionStart) throw new Error("session-start-missing");
  const settings = JSON.parse(value(args, "--settings") ?? "{}");
  const configValue = value(args, "--mcp-config");
  const additions = configValue ? JSON.parse(files.get(configValue) ?? configValue).mcpServers : {};
  const mcpNative: Record<string, string> = {};
  const overrides: string[] = [];
  for (const [id, spec] of Object.entries(manifest)) {
    const denied = settings.deniedMcpServers?.some((row: any) => row.serverName === `plugin:deck-developer-team:${id}`);
    if (denied && id === "codebase-memory" && additions[id]) { overrides.push(id); continue; }
    else if (denied) continue; // A real native loss remains visible to the guard.
    mcpNative[id] = JSON.stringify(spec);
  }
  const skip = args.includes("--dangerously-skip-permissions");
  if (session && skip && args.includes("--permission-prompt-tool")) throw new Error("relay-skips-permissions");
  const project = files.get("parity-project-root")!;
  const prepared = readiness(project);
  const delivered = session ? JSON.parse(files.get(join(project, "..", "session-start-context.json"))!).text : prepared.text;
  return {
    roleSource: { kind: "native-agent", ref: roleRef, hash: skillHash(roleFile) },
    roleTools: { builtins: tools?.filter(t => !t.startsWith("mcp__")) ?? ["Bash", "Edit"], mcpAllowed: tools?.filter(t => t.startsWith("mcp__")) ?? [], mcpDefault: tools ? "deny" : "allow" },
    skillsRoots: [root], skillPreload: roleFile.match(/  - deck-developer-team:[^\n]+/g) ?? [], plugins: [root], hooks: Object.keys(hooks), executionPolicy: [generation],
    mcpInstalled: Object.fromEntries(Object.entries(manifest).map(([id, spec]) => [id, JSON.stringify(spec)])),
    ...(manifest["codebase-memory"] ? { codebase: { route: evidence?.route ?? (overrides.includes("codebase-memory") ? "managed" as const : "native" as const), ...(evidence ? { evidence } : {}), omitted: !mcpNative["codebase-memory"] && !overrides.includes("codebase-memory") } } : {}),
    mcpNative, mcpAdded: Object.keys(additions).filter(id => !overrides.includes(id)), mcpOverridden: overrides,
    webSearch: { route: additions["web-search"] ? "fallback" : "disabled", ...(additions["web-search"] ? { serverId: "web-search" } : {}) },
    memory: { scope: "off", envSecrets: [] }, settingSources: value(args, "--setting-sources")!, projectInstructions: "native-hook",
    model: value(args, "--model"), permissionMode: session ? skip ? "yolo" : "relay" : "native", delegation: args.includes("--disallowedTools") ? "deck" : "native",
    overlaySections: args.includes("--append-system-prompt-file") ? ["session-notice"] : [],
    sessionStartContext: projectReadinessParity(prepared.snapshot, readSessionProjectInstructions(project) ?? "", delivered),
  };
}
test("Claude native/session plans retain role, hooks and native MCP in relay and yolo", async () => {
  const home = mkdtempSync(join(tmpdir(), "deck-claude-parity-")), project = join(home, "project"); mkdirSync(project);
  try {
    const config = getDefaultDeckConfig(); config.capabilities = { "codebase-memory": { enabled: true, runners: {} } }; config.adaptiveMemory.enabled = false; config.adaptiveMemory.activeProvider = "none"; config.webSearch.enabled = false;
    const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "deck"), resolveCommand: () => process.execPath, verifyExistingCodebase: () => true });
    const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: project, environmentId: "claude-development", deckConfig: config, capabilityIds: ["claude-team-files", "context7", "codebase-memory"] });
    await adapter.applyDeveloperTeamInstall({ projectRoot: project, environmentId: "claude-development", plan });
    const descriptor = await adapter.prepareSessionNativeSkills();
    const native = await adapter.buildLaunchPlan!({ projectRoot: project, deckConfig: config, mode: "interactive", environmentId: "claude-development" } as never);
    expect(native.status).toBe("ready"); if (native.status !== "ready") throw new Error("native fixture blocked");
    for (const role of ["deck-lead"]) for (const approvals of ["relay", "runner-default"] as const) {
      const files = new Map<string, string>([["parity-project-root", project]]);
      const prepared = readiness(project);
      const launch = buildClaudeTurnLaunch({ taskId: "t", memberId: role.slice(5), cwd: project, sessionStartContext: { text: prepared.text, snapshotId: prepared.snapshot.snapshotId, epoch: "fixture" }, assignment: { runnerId: "claude", modelId: "haiku" }, rolePrompt: renderSessionOverlay(role, [{ kind: "session-notice" }]), prompt: "task", nativeSessionId: "3f2b8c1e-5d4a-4b7e-9a1c-0e2d3f4a5b6c", mcp: { servers: ["deck", "codebase-memory"], sessionTools: [] }, mcpServerSpecs: { deck: { command: "deck", args: [], env: {} }, "codebase-memory": { command: "bound-codebase", args: [], env: {} } }, nativeSkills: descriptor, nativeRole: { roleId: role, roleRef: `deck-developer-team:${role}`, generation: descriptor.contentHash }, approvals, credentialFile: "/private", disableNativeDelegation: true }, { writePrivateFile(name, content) { files.set(join(home, name), content); return join(home, name); } }, { baseEnv: { HOME: home } });
      const a = shape(native.plan.args, role, descriptor.contentHash, false, files), b = shape(launch.args, role, descriptor.contentHash, true, files);
      const allow = SESSION_PARITY_ALLOWLIST.filter(e => ["delegation", "overlaySections", "mcpAdded", "model", "mcpOverridden"].includes(e.field) || e.field === "permissionMode" && e.rule === b.permissionMode);
      const options = { runner: "claude", roleId: role, enabledCapabilities: ["context7", "codebase-memory"], allow, now: "2026-10-27", necessityTestExists: existsSync };
      expect(diffParity(a, b, options)).toEqual([]);
      const controller = new AbortController();
      const managedEvidence = issueCodebaseAvailability({ skills: descriptor, projectRoot: project, invocationId: "t", route: "managed", reason: "unavailable", signal: controller.signal });
      const omittedArgs = [...launch.args];
      const configPath = value(omittedArgs, "--mcp-config")!;
      const omittedFiles = new Map(files), originalConfig = JSON.parse(files.get(configPath)!);
      delete originalConfig.mcpServers["codebase-memory"]; omittedFiles.set(configPath, JSON.stringify(originalConfig));
      const omitted = shape(omittedArgs, role, descriptor.contentHash, true, omittedFiles, managedEvidence);
      const omissionOptions = { ...options, allow: allow.filter(entry => entry.field !== "mcpOverridden") };
      expect(diffParity(a, omitted, omissionOptions)).toEqual([]);
      const nativeEvidence = issueCodebaseAvailability({ skills: descriptor, projectRoot: project, invocationId: "native", route: "native", reason: "unsupported", signal: controller.signal });
      const omittedNative = await adapter.buildLaunchPlan!({ projectRoot: project, teamId: "developer-team", deckConfig: config, mode: "interactive", codebaseAvailability: nativeEvidence, codebaseInvocationId: "native" });
      if (omittedNative.status !== "ready") throw new Error("native omission blocked");
      expect(diffParity(shape(omittedNative.plan.args, role, descriptor.contentHash, false, files, nativeEvidence), omitted, omissionOptions)).toEqual([]);
      const forged = { ...omitted, codebase: { ...omitted.codebase!, evidence: { ...managedEvidence } } };
      expect(diffParity(a, forged, omissionOptions)).toContain("codebase: invalid-backend-evidence");
      const unrelated = { ...omitted, mcpNative: {} };
      expect(diffParity(a, unrelated, omissionOptions)).toContain("mcpNative: protected-difference");
      const equalLoss = { ...omitted, mcpNative: {} };
      expect(diffParity(equalLoss, equalLoss, { ...omissionOptions, allow: [] })).toContain("mcpNative: unjustified-native-loss");
      controller.abort();
      expect(diffParity(a, omitted, omissionOptions)).toContain("codebase: invalid-backend-evidence");
      const deniedArgs = [...launch.args]; deniedArgs[deniedArgs.indexOf("--settings") + 1] = JSON.stringify({ deniedMcpServers: [{ serverName: "plugin:deck-developer-team:codebase-memory" }, { serverName: "plugin:deck-developer-team:context7" }] });
      expect(diffParity(a, shape(deniedArgs, role, descriptor.contentHash, true, files), options)).toContain("mcpNative: protected-difference");
      const missingAgent = [...launch.args]; missingAgent.splice(missingAgent.indexOf("--agent"), 2);
      expect(() => shape(missingAgent, role, descriptor.contentHash, true, files)).toThrow("role-selection-missing");
      if (approvals === "relay") expect(() => shape([...launch.args, "--dangerously-skip-permissions"], role, descriptor.contentHash, true, files)).toThrow("relay-skips-permissions");
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test.each([false, true])("native and session select the same dynamic web route (fallback=%s)", async fallback => {
  const { TAVILY_PROVIDER_DESCRIPTOR } = await import("../../provider-tavily/src/index");
  const { resolveSessionChildMcp } = await import("../../../apps/cli/src/session-shared-services");
  const home = mkdtempSync(join(tmpdir(), "deck-claude-search-parity-"));
  try {
    const environment = { HOME: home, ...(fallback ? { CLAUDE_CODE_USE_BEDROCK: "1" } : {}), TAVILY_API_KEY: "fixture-key" };
    let credentialReads = 0;
    const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "deck"), resolveCommand: () => process.execPath, sessionDriver: { baseEnv: environment }, webSearchProviderResolver: () => TAVILY_PROVIDER_DESCRIPTOR, webSearchCredential: () => { credentialReads++; return "fixture-key"; } });
    const config = getDefaultDeckConfig(); config.webSearch = { enabled: true, provider: "tavily" }; config.adaptiveMemory.enabled = false; config.adaptiveMemory.activeProvider = "none";
    const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig: config, capabilityIds: ["claude-team-files", "web-search"] });
    await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan });
    expect(plan.files.filter(file => file.path.endsWith("/.mcp.json")).some(file => file.content.includes("web-search"))).toBe(false);
    credentialReads = 0;
    const native = await adapter.buildLaunchPlan!({ projectRoot: home, teamId: "developer-team", deckConfig: config, mode: "interactive" });
    expect(native.status).toBe("ready"); if (native.status !== "ready") throw new Error("native search unavailable");
    const session = await resolveSessionChildMcp(adapter, config, environment);
    const nativeMcp = JSON.parse(value(native.plan.args, "--mcp-config") ?? '{"mcpServers":{}}').mcpServers;
    expect(Boolean(nativeMcp["web-search"])).toBe(fallback);
    expect(Boolean(session.resolveServer("web-search"))).toBe(fallback);
    expect(credentialReads).toBe(fallback ? 1 : 0);
    if (fallback) {
      expect(session.resolveServer("web-search")).toMatchObject(nativeMcp["web-search"]);
      expect(native.plan.envOverlay?.TAVILY_API_KEY?.value).toBe(session.envOverlay?.TAVILY_API_KEY);
    }
    const descriptor = await adapter.prepareSessionNativeSkills();
    for (const role of ["deck-quality", "deck-investigate"]) {
      const allowed = readFileSync(join(descriptor.root, "agents", `${role}.md`), "utf8").match(/^tools: (.*)$/m)![1]!.split(", ");
      for (const tool of fallback ? ["mcp__web-search__tavily_search", "mcp__web-search__tavily_extract"] : ["WebSearch", "WebFetch"]) expect(allowed).toContain(tool);
      const servers = ["deck", ...(fallback ? ["web-search"] : [])];
      const launch = buildClaudeTurnLaunch({ taskId: "t", memberId: role, cwd: home, assignment: { runnerId: "claude", modelId: "haiku" }, rolePrompt: "", prompt: "review", nativeSessionId: "3f2b8c1e-5d4a-4b7e-9a1c-0e2d3f4a5b6c", nativeSkills: descriptor, nativeRole: { roleId: role, roleRef: `deck-developer-team:${role}`, generation: descriptor.contentHash }, mcp: { servers, sessionTools: [] }, mcpServerSpecs: { deck: { command: "unused", args: [], env: {} }, ...(fallback ? { "web-search": session.resolveServer("web-search")! } : {}) }, approvals: "relay", disableNativeDelegation: true, credentialFile: "/unused" }, { writePrivateFile: name => join(home, name) }, { baseEnv: environment });
      expect(value(launch.args, "--agent")).toBe(`deck-developer-team:${role}`);
    }
    config.webSearch.enabled = false;
    credentialReads = 0;
    const disabled = await adapter.buildLaunchPlan!({ projectRoot: home, teamId: "developer-team", deckConfig: config, mode: "interactive" });
    expect(disabled.status).toBe("blocked"); expect(credentialReads).toBe(0);
    if (disabled.status === "ready") { expect(disabled.plan.args).not.toContain("--mcp-config"); expect(disabled.plan.envOverlay).toBeUndefined(); }
  } finally { rmSync(home, { recursive: true, force: true }); }
});
