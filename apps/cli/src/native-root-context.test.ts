import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, chmodSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { validateDeckConfig, type RunnerLaunchInput } from "@deck/core";
import { createCodexRunnerAdapter } from "../../../packages/adapter-codex/src/runner-adapter";
import { CODEX_0162_FIXTURE as release } from "../../../packages/adapter-codex/src/__fixtures__/codex/release-0.162.1";
import { CODEX_ROOT_LEAD_BOOTSTRAP } from "../../../packages/adapter-codex/src/role-bootstrap";
import { forwardCodexTrustedHook } from "../../../packages/adapter-codex/assets/codex/hooks/developer-team-execution";
import { withNativeProjectReadiness } from "./native-project-readiness";

// Protects root provenance and additive role delivery through the production
// adapter + authenticated refresh + native hook, independently of memory.
// Oracle: only a verified Deck-created root can refresh Lead on resume/compact.
test("verified roots refresh across cold launch while child, unrelated and stale contexts never acquire Lead", async () => {
  const home = realpathSync(mkdtempSync("/tmp/deck-root-context-"));
  const config = validateDeckConfig({});
  const adapter = createCodexRunnerAdapter({ userHome: home, codexHome: join(home, ".codex"),
    preflight: { probe: async () => ({ found: true, version: "0.162.1", help: release.help, execHelp: release.execHelp, resumeHelp: release.resumeHelp }) },
    tools: { homeDir: home, nodeCommand: process.execPath, verifyNodeRuntime: () => true, resolveCommand: () => undefined } });
  const install = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "codex-development", deckConfig: config });
  for (const file of install.files) { const path = join(home, file.path); mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); writeFileSync(path, file.content, { mode: 0o600 }); }
  const configPath = join(home, ".codex/config.toml");
  writeFileSync(configPath, 'developer_instructions="Durable custom instructions"\n' + readFileSync(configPath, "utf8"));
  const base = { projectRoot: home, teamId: "developer-team", deckConfig: config };
  const launch = async (input: RunnerLaunchInput) => {
    const result = await adapter.buildLaunchPlan!(input); expect(result.status).toBe("ready");
    if (result.status !== "ready") throw Error("launch");
    const plan = withNativeProjectReadiness(result.plan, "codex", () => config, undefined, undefined, () => adapter.readPreparationGeneration!());
    const environment: Record<string, string> = {};
    await plan.launchLifecycle!.beforeSpawn(environment);
    return { plan, environment };
  };
  const hook = async (environment: Record<string, string>, sessionId: string, source: string, extra = {}) => JSON.stringify(await forwardCodexTrustedHook({
    hook_event_name: "SessionStart", cwd: home, session_id: sessionId, source, ...extra,
  }, { environment }));
  const active: Awaited<ReturnType<typeof launch>>[] = [];
  try {
    const fresh = await launch({ ...base, mode: "interactive" }); active.push(fresh);
    expect(fresh.plan.args.some(arg => arg.startsWith("developer_instructions="))).toBe(false);
    expect(readFileSync(configPath, "utf8")).toContain('developer_instructions="Durable custom instructions"');
    const snapshot = JSON.parse(readFileSync(fresh.environment.DECK_SESSION_START_CONTEXT!, "utf8"));
    expect(snapshot.text).not.toContain(CODEX_ROOT_LEAD_BOOTSTRAP);
    const unauthorized = await fetch(snapshot.refresh.endpoint.replace("/readiness", "/codex-root"), { method: "POST", headers: { authorization: "Bearer wrong", "x-deck-native-session": "root-one", "x-deck-native-source": "startup" } });
    expect(unauthorized.status).toBe(403);
    // Native Codex writes this on first startup, after Deck captured the generation.
    writeFileSync(configPath, readFileSync(configPath, "utf8") + `\n[projects.${JSON.stringify(home)}]\ntrust_level="trusted"\n`);
    expect(await hook(fresh.environment, "child", "startup", { agent_id: "child", agent_type: "deck-quality" })).not.toContain(CODEX_ROOT_LEAD_BOOTSTRAP);
    expect(await hook(fresh.environment, "root-one", "startup")).toContain(CODEX_ROOT_LEAD_BOOTSTRAP);
    expect(await hook(fresh.environment, "root-one", "compact")).toContain(CODEX_ROOT_LEAD_BOOTSTRAP);
    expect(await hook(fresh.environment, "other", "compact")).not.toContain(CODEX_ROOT_LEAD_BOOTSTRAP);
    expect(await hook(fresh.environment, "root-one", "fork")).not.toContain(CODEX_ROOT_LEAD_BOOTSTRAP);
    fresh.plan.launchLifecycle!.afterExit();
    const resumed = await launch({ ...base, mode: "resume-by-id", sessionId: "root-one" }); active.push(resumed);
    expect(await hook(resumed.environment, "other", "resume")).not.toContain(CODEX_ROOT_LEAD_BOOTSTRAP);
    expect(await hook(resumed.environment, "root-one", "resume")).toContain(CODEX_ROOT_LEAD_BOOTSTRAP);
    expect(await hook(resumed.environment, "root-one", "compact")).toContain(CODEX_ROOT_LEAD_BOOTSTRAP);
    const unrelated = await launch({ ...base, mode: "resume-latest" }); active.push(unrelated);
    expect(await hook(unrelated.environment, "unrelated", "resume")).not.toContain(CODEX_ROOT_LEAD_BOOTSTRAP);
    const receipt = join(home, ".codex/deck/root-sessions/root-one.json");
    chmodSync(receipt, 0o644);
    expect(await hook(unrelated.environment, "root-one", "resume")).not.toContain(CODEX_ROOT_LEAD_BOOTSTRAP);
    chmodSync(receipt, 0o600);
    symlinkSync(receipt, join(home, ".codex/deck/root-sessions/link.json"));
    expect(await hook(unrelated.environment, "link", "resume")).not.toContain(CODEX_ROOT_LEAD_BOOTSTRAP);
    const nonteam = await launch({ ...base, teamId: "custom-team", mode: "interactive" }); active.push(nonteam);
    expect(nonteam.plan.nativeSessionStartContext).toBeUndefined();
    expect(nonteam.plan.args.some(arg => arg.startsWith("developer_instructions="))).toBe(false);
    expect(await hook(nonteam.environment, "root-one", "resume")).not.toContain(CODEX_ROOT_LEAD_BOOTSTRAP);
    // An installation retaining the previous hook protocol cannot claim refresh.
    const manifestPath = join(home, ".codex/deck/manifest.json"), manifest = readFileSync(manifestPath, "utf8");
    writeFileSync(manifestPath, JSON.stringify({ ...JSON.parse(manifest), nativeRoleGeneration: "previous-hook-protocol" }));
    const old = await adapter.buildLaunchPlan!({ ...base, mode: "interactive" });
    expect(old.status === "ready" && old.plan.nativeSessionStartContext).toBeUndefined();
    writeFileSync(manifestPath, manifest);
    writeFileSync(join(home, ".codex/deck/hooks/developer-team-execution.js"), "changed");
    expect(await hook(resumed.environment, "root-one", "compact")).not.toContain(CODEX_ROOT_LEAD_BOOTSTRAP);
  } finally { for (const item of active) item.plan.launchLifecycle!.afterExit(); rmSync(home, { recursive: true, force: true }); }
});
