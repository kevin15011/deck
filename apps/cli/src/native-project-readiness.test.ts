// Protects native coordinator caching, current input invalidation, authenticated lifecycle delivery, and fail-open role availability.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultDeckConfig } from "@deck/core";
import { loadPreparedSessionStartContext } from "@deck/core/session/start-context";
import { createPiDeveloperTeamExecutionExtensionV1 } from "../../../packages/adapter-pi/assets/pi/extensions/developer-team-execution";
import { createOpenCodeDeveloperTeamExecutionPluginV1 } from "../../../packages/adapter-opencode/assets/opencode/plugins/developer-team-execution";
import { forwardCodexTrustedHook } from "../../../packages/adapter-codex/assets/codex/hooks/developer-team-execution";
import { startNativeProjectReadiness, withNativeProjectReadiness } from "./native-project-readiness";

test("native parent and lifecycle consumers share evidence, refresh only changed files, and grant no caller scope", async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-native-readiness-test-"));
  const reads: string[] = [], config = getDefaultDeckConfig();
  config.capabilities = { "codebase-memory": { enabled: false, runners: {} } };
  mkdirSync(join(root, "openspec")); mkdirSync(join(root, ".atl"));
  writeFileSync(join(root, "openspec/config.yaml"), "schema: spec-driven\ntesting:\n  strict_tdd: true\n");
  writeFileSync(join(root, ".atl/skill-registry.md"), "registry");
  const owner = await startNativeProjectReadiness({ projectRoot: root, runnerId: "pi", generation: "g", config: () => config, onProjectRead: path => reads.push(path) });
  try {
    const environment = owner.environment;
    const [first, simultaneous] = await Promise.all([
      loadPreparedSessionStartContext(root, environment), loadPreparedSessionStartContext(root, environment),
    ]);
    expect(simultaneous).toBe(first);
    expect(first).toContain("retired-policy-present");
    expect(first).not.toContain("codebase-memory");
    const handlers: Record<string, (event: any, context: any) => Promise<any>> = {};
    createPiDeveloperTeamExecutionExtensionV1({ environment })({ on: (name, handler) => { handlers[name] = handler; } });
    await handlers.session_start!({}, { cwd: root });
    const plugin = await createOpenCodeDeveloperTeamExecutionPluginV1({ environment })({ directory: root });
    const codex = await forwardCodexTrustedHook({ cwd: root, session_id: "native", hook_event_name: "SessionStart" }, { environment });
    expect(JSON.stringify(codex)).toContain("retired-policy-present");
    expect(reads).toEqual(["openspec/config.yaml", ".atl/skill-registry.md"]);
    writeFileSync(join(root, "openspec/config.yaml"), "schema: spec-driven\ntesting:\n  policy: proportional\n");
    const output = { system: [] as string[] };
    await plugin["experimental.chat.system.transform"]({}, output);
    expect(output.system.join()).toContain("retired-policy-present");
    expect((await handlers.before_agent_start!({}, {})).systemPrompt).toContain("retired-policy-present");
    await handlers.session_start!({}, { cwd: root });
    expect(JSON.stringify(await handlers.before_agent_start!({}, {})) ?? "").not.toContain("retired-policy-present");
    expect(reads).toEqual(["openspec/config.yaml", ".atl/skill-registry.md", "openspec/config.yaml"]);
    config.capabilities["codebase-memory"].enabled = true;
    expect(await loadPreparedSessionStartContext(root, environment)).toContain("codebase-memory");
    expect(reads).toHaveLength(3);
    const { refresh } = JSON.parse(readFileSync(environment.DECK_SESSION_START_CONTEXT, "utf8"));
    expect((await fetch(refresh.endpoint, { method: "POST" })).status).toBe(403);
    expect((await fetch(refresh.endpoint, { method: "POST", headers: { authorization: `Bearer ${refresh.token}` }, body: JSON.stringify({ role: "deck-setup", root: "/" }) })).status).toBe(403);
    await expect(loadPreparedSessionStartContext(tmpdir(), environment)).rejects.toThrow("binding-mismatch");
  } finally { owner.close(); rmSync(root, { recursive: true, force: true }); }
});

test("native launch clears ambient references, chains verification, and cleans up its producer", async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-native-launch-test-"));
  let verified = false, closed = false;
  const plan = withNativeProjectReadiness({ command: "unused", args: [], cwd: root, stdio: "pipe", stdin: "closed", executionClass: "static-compatible", launchLifecycle: {
    beforeSpawn() { verified = true; }, afterExit() { closed = true; },
  } }, "pi", () => getDefaultDeckConfig());
  const env = { DECK_SESSION_START_CONTEXT: "/untrusted", DECK_SESSION_START_DIGEST: "untrusted" };
  try {
    await plan.launchLifecycle!.beforeSpawn(env);
    expect(verified).toBe(true);
    expect(await loadPreparedSessionStartContext(root, env)).toContain("config-missing");
    plan.launchLifecycle!.afterExit();
    expect(closed).toBe(true);
    await expect(loadPreparedSessionStartContext(root, env)).rejects.toThrow();
  } finally { plan.launchLifecycle!.afterExit(); rmSync(root, { recursive: true, force: true }); }
});

test("unavailable readiness does not block roles, while native verification still does", async () => {
  const base = { command: "fake", args: [], cwd: "/missing-deck-readiness-fixture", stdio: "pipe", stdin: "closed" } as const;
  const environment: Record<string, string> = { DECK_SESSION_START_CONTEXT: "/stale" };
  const unavailable = withNativeProjectReadiness(base, "pi", () => getDefaultDeckConfig());
  await unavailable.launchLifecycle!.beforeSpawn(environment);
  expect(environment.DECK_SESSION_START_CONTEXT).toBeUndefined();
  unavailable.launchLifecycle!.afterExit();
  const rejected = withNativeProjectReadiness({ ...base, launchLifecycle: { beforeSpawn() { throw new Error("native-role-unverified"); }, afterExit() {} } }, "pi", () => getDefaultDeckConfig());
  await expect(rejected.launchLifecycle!.beforeSpawn(environment)).rejects.toThrow("native-role-unverified");
});

// Exercise the actual producer with adapter metadata, not a pre-rendered snapshot.
test("native lifecycle refreshes selected prerequisites after repair and disablement", async () => {
  const { createCodexRunnerAdapter } = await import("../../../packages/adapter-codex/src/runner-adapter");
  const { chmodSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "deck-native-prerequisites-"));
  const config = getDefaultDeckConfig(); config.packageInstructions.codex!.rtk = false;
  config.capabilities!["codebase-memory"].enabled = false; config.webSearch.enabled = false;
  const command = join(root, "context7");
  writeFileSync(join(root, "config.toml"), `# deck-codex-mcp:context7\n[mcp_servers.context7]\ncommand = ${JSON.stringify(command)}\n`);
  const adapter = createCodexRunnerAdapter({ codexHome: root, userHome: root, tools: { homeDir: root, dataRoot: join(root, "data", "deck"), resolveCommand: name => name === "context7-mcp" ? command : undefined } });
  const plan = withNativeProjectReadiness({ command: "unused", args: [], cwd: root, stdio: "pipe", stdin: "closed" }, "codex", () => config,
    () => { throw new Error("disabled Codebase must not be observed"); }, current => adapter.readPreparationCapabilities!(current));
  const environment: Record<string, string> = {};
  try {
    await plan.launchLifecycle!.beforeSpawn(environment);
    expect(await loadPreparedSessionStartContext(root, environment)).toContain("context7; runner-remediation-required");
    writeFileSync(command, "metadata fixture, never executed"); chmodSync(command, 0o700);
    const refreshed = await loadPreparedSessionStartContext(root, environment);
    expect(refreshed).not.toContain("context7; runner-remediation-required");
    expect(refreshed).toContain('"prerequisites":"present"');
    writeFileSync(join(root, "config.toml"), "");
    expect(await loadPreparedSessionStartContext(root, environment)).not.toContain("context7");
  } finally { plan.launchLifecycle!.afterExit(); rmSync(root, { recursive: true, force: true }); }
});

// Protects installed-generation revocation at the actual loopback lifecycle boundary.
test("native generation revocation is permanent for that launch; restart collects fresh evidence", async () => {
  const { createHash } = await import("node:crypto");
  const root = mkdtempSync(join(tmpdir(), "deck-native-generation-"));
  const selectionPath = join(root, "selection.json"); writeFileSync(selectionPath, "generation-one");
  const config = getDefaultDeckConfig(); config.capabilities!["codebase-memory"].enabled = false;
  const build = () => withNativeProjectReadiness({ command: "unused", args: [], cwd: root, stdio: "pipe", stdin: "closed", generationReference: { root, selectionPath, selectionHash: createHash("sha256").update(readFileSync(selectionPath)).digest("hex") } }, "codex", () => config);
  const first = build(), environment: Record<string, string> = {};
  let second: ReturnType<typeof build> | undefined;
  try {
    await first.launchLifecycle!.beforeSpawn(environment);
    const originalEpoch = environment.DECK_SESSION_START_EPOCH;
    expect(await loadPreparedSessionStartContext(root, environment)).toContain("config-missing");
    writeFileSync(selectionPath, "generation-two");
    await expect(loadPreparedSessionStartContext(root, environment)).rejects.toThrow("refresh-unavailable");
    writeFileSync(selectionPath, "generation-one");
    await expect(loadPreparedSessionStartContext(root, environment)).rejects.toThrow("refresh-unavailable");
    first.launchLifecycle!.afterExit();
    mkdirSync(join(root, "openspec")); writeFileSync(join(root, "openspec/config.yaml"), "schema: spec-driven\n");
    second = build(); await second.launchLifecycle!.beforeSpawn(environment);
    expect(environment.DECK_SESSION_START_EPOCH).not.toBe(originalEpoch);
    expect(await loadPreparedSessionStartContext(root, environment)).not.toContain("config-missing");
  } finally { first.launchLifecycle!.afterExit(); second?.launchLifecycle!.afterExit(); rmSync(root, { recursive: true, force: true }); }
});

// Equal scopes are evaluated independently: only inputs are shared, never output or digests.
test.each(["claude", "codex", "opencode", "pi"])("%s native lifecycle bytes equal independently evaluated session bytes", async runnerId => {
  const { ProjectPreparationService } = await import("../../../packages/sdd-runtime/src/execution/project-preparation");
  const { composeSessionStartContextV1 } = await import("../../../packages/sdd-runtime/src/execution/session-start-context");
  const { projectReadinessParity, additionalReadinessParticipants } = await import("@deck/core/session/readiness-parity");
  const root = mkdtempSync(join(tmpdir(), "deck-native-equal-"));
  const config = getDefaultDeckConfig(); config.capabilities!["codebase-memory"].enabled = false; config.webSearch.enabled = false; config.adaptiveMemory.enabled = false;
  writeFileSync(join(root, "AGENTS.md"), "Native project instructions.");
  const native = await startNativeProjectReadiness({ projectRoot: root, runnerId, generation: "fixture", config: () => config });
  try {
    const record = JSON.parse(readFileSync(native.environment.DECK_SESSION_START_CONTEXT, "utf8"));
    const sessionService = new ProjectPreparationService();
    const snapshot = sessionService.status(structuredClone(record.preparation.scope));
    const actual = (await loadPreparedSessionStartContext(root, native.environment))!;
    const expected = composeSessionStartContextV1(snapshot, runnerId);
    expect(actual).toBe(expected);
    const local = runnerId === "claude" ? "Native project instructions." : "";
    const a = projectReadinessParity(record.preparation, local, actual), b = projectReadinessParity(snapshot, local, expected);
    expect(a).toEqual(b);
    const mixedSnapshot = sessionService.status({ ...snapshot.scope, members: [...snapshot.scope.members, { memberId: "extra", runnerId: "codex", bindingId: "extra@codex", capabilities: { "codebase-memory": { enabled: true } } }] });
    const mixed = projectReadinessParity(mixedSnapshot, local, composeSessionStartContextV1(mixedSnapshot, runnerId));
    expect(additionalReadinessParticipants(a, mixed)).toBe(true);
    const tampered = structuredClone(mixed); tampered.proof!.text += "extra local instructions";
    expect(additionalReadinessParticipants(a, tampered)).toBe(false);
  } finally { native.close(); rmSync(root, { recursive: true, force: true }); }
});

test.each(["codex", "opencode", "pi"])("%s native refresh revalidates its real installed generation without a selection reference", async runnerId => {
  const { dirname } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "deck-native-generation-adapter-"));
  let adapter: import("@deck/core").RunnerAdapter, changedPath: string;
  const config = getDefaultDeckConfig(); config.capabilities!["codebase-memory"].enabled = false;
  if (runnerId === "codex") {
    const { buildCodexDeveloperTeamInstallPlan } = await import("../../../packages/adapter-codex/src/developer-team-install");
    const { createCodexRunnerAdapter } = await import("../../../packages/adapter-codex/src/runner-adapter");
    const install = buildCodexDeveloperTeamInstallPlan({ projectRoot: root, existingFiles: new Map() });
    for (const file of install.expectedFiles) { const path = join(root, file.relativePath); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, file.content, { mode: 0o600 }); }
    adapter = createCodexRunnerAdapter({ codexHome: join(root, ".codex"), userHome: root });
    changedPath = join(root, ".codex/deck/manifest.json");
  } else if (runnerId === "opencode") {
    const { createOpenCodeRunnerAdapter } = await import("../../../packages/adapter-opencode/src/runner-adapter");
    adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: root });
    const plan = adapter.buildDeveloperTeamInstallPlan!({ environmentId: "opencode-development", projectRoot: root, deckConfig: config });
    await adapter.applyDeveloperTeamInstall!({ environmentId: "opencode-development", projectRoot: root, plan });
    changedPath = join(root, "deck/manifest.json");
  } else {
    const { createPiRunnerAdapter } = await import("../../../packages/adapter-pi/src/runner-adapter");
    const { buildPiGlobalMaterialization } = await import("../../../packages/adapter-pi/src/global-materialization");
    const { createNodePiFileIO, planPiGlobalInstall, applyPiGlobalPlan } = await import("../../../packages/adapter-pi/src/pi-global-install");
    const desired = buildPiGlobalMaterialization({ agentDir: root, projectRoot: root, legacyDeckEvidence: false }).desired, io = createNodePiFileIO();
    applyPiGlobalPlan(planPiGlobalInstall(desired, io), io);
    adapter = createPiRunnerAdapter({ homeDirectory: root, env: { PI_CODING_AGENT_DIR: root } });
    changedPath = join(root, "deck/package/role-policy.json");
  }
  adapter.readPreparationGeneration!();
  const plan = withNativeProjectReadiness({ command: "unused", args: [], cwd: root, stdio: "pipe", stdin: "closed" }, runnerId, () => config, undefined, undefined, adapter.readPreparationGeneration!.bind(adapter));
  const environment: Record<string, string> = {};
  try {
    await plan.launchLifecycle!.beforeSpawn(environment);
    expect(environment.DECK_SESSION_START_CONTEXT).toBeDefined();
    expect(await loadPreparedSessionStartContext(root, environment)).toBeDefined();
    const original = readFileSync(changedPath, "utf8"); writeFileSync(changedPath, original + "changed");
    await expect(loadPreparedSessionStartContext(root, environment)).rejects.toThrow("refresh-unavailable");
    writeFileSync(changedPath, original);
    await expect(loadPreparedSessionStartContext(root, environment)).rejects.toThrow("refresh-unavailable");
  } finally { plan.launchLifecycle!.afterExit(); rmSync(root, { recursive: true, force: true }); }
});

// Protects persisted enablement refresh while preserving explicit command-line memory overrides.
test("native launch config reader observes saved changes and preserves launch overrides", async () => {
  const { DeckConfigStore } = await import("./deck-config-store");
  const { createNativeReadinessConfigReader } = await import("./runner-launch-command");
  const root = mkdtempSync(join(tmpdir(), "deck-current-config-"));
  try {
    const store = new DeckConfigStore({ homeDir: root, xdgConfigHome: join(root, ".config") });
    const config = getDefaultDeckConfig(); config.webSearch.enabled = false;
    store.write(config);
    const read = createNativeReadinessConfigReader("none", false, store);
    expect(read().webSearch.enabled).toBe(false);
    config.webSearch.enabled = true;
    config.adaptiveMemory = { enabled: true, activeProvider: "supermemory" };
    store.write(config);
    expect(read().webSearch.enabled).toBe(true);
    expect(read().adaptiveMemory.enabled).toBe(false);
    expect(createNativeReadinessConfigReader("supermemory", false, store)().adaptiveMemory.enabled).toBe(true);
    expect(createNativeReadinessConfigReader("supermemory", true, store)().adaptiveMemory.enabled).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
