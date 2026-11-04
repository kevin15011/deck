import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDefaultDeckConfig } from "@deck/core";
import { createCodexRunnerAdapter } from "./runner-adapter";
import { createNodeCodexFileEffects } from "./node-effects";
import { prepareCodexNativeRole, verifyCodexNativeRole } from "./native-role";

// Protects upgrade recovery, idempotence, customization preservation and read-only admission.
// Oracle: resilient-verification slice 3; all mutable roots and tool effects are isolated.
test("preparation heals old owned content once, warns on custom roles and rejects sandbox escalation", async () => {
  const home = realpathSync(mkdtempSync('/tmp/deck-codex-refresh-'));
  const codexHome = join(home, '.codex');
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  try {
    const config = getDefaultDeckConfig();
    const writes: string[] = [];
    const effects = createNodeCodexFileEffects({ journalRoot: join(home, 'journal') });
    // Durability/CAS is covered by node-effects and transaction tests; this checks adapter composition.
    const adapter = createCodexRunnerAdapter({ userHome: home, codexHome, journalRoot: join(home, 'journal'), fileEffects: { ...effects, persistJournalAtomic: async () => {}, writeAtomic: async (path, content, mode) => { writes.push(path); writeFileSync(path, content, { mode }); } },
      preflight: { probe: async () => ({ found: true, version: '0.200.0', help: 'Usage: codex --dangerously-bypass-hook-trust' }) },
      tools: { homeDir: home, dataRoot: join(home, 'deck'), resolveCommand: () => undefined, nodeCommand: process.execPath, verifyNodeRuntime: () => true } });
    const initial = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: 'codex-development', deckConfig: config });
    for (const file of initial.files) { const path = join(home, file.path); mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); writeFileSync(path, file.content); }
    const manifestPath = join(codexHome, 'deck/manifest.json');
    const rolePath = join(codexHome, 'agents/deck-quality.toml');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const stale = readFileSync(rolePath, 'utf8').replace('developer_instructions = "', 'developer_instructions = "Previous bundled text. ');
    writeFileSync(rolePath, stale);
    manifest.files['.codex/agents/deck-quality.toml'] = createHash('sha256').update(stale).digest('hex');
    manifest.nativeRoleGeneration = 'previous-build';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const role = await adapter.prepareSessionNativeRole!('deck-quality', config);
    expect(role.preparation?.some(item => item.kind === 'H')).toBe(true);
    verifyCodexNativeRole(role);
    expect(readFileSync(rolePath, 'utf8')).not.toBe(stale);
    const firstLaunch = await adapter.buildLaunchPlan!({ projectRoot: home, teamId: 'developer-team', mode: 'interactive', deckConfig: config });
    expect(firstLaunch.status).toBe('ready');
    // Native Codex places a preference table before the final trailing marker.
    const configPath = join(codexHome, 'config.toml');
    const nativeConfig = readFileSync(configPath, 'utf8').replace('# deck-codex-hook:memory-bridge:end', '[tui]\nscreen_reader_detection_done = true\n# deck-codex-hook:memory-bridge:end');
    writeFileSync(configPath, nativeConfig);
    const before = statSync(manifestPath).mtimeMs;
    writes.length = 0;
    const second = await adapter.prepareSessionNativeRole!('deck-quality', config);
    expect(second.preparation?.some(item => item.kind === 'H')).toBe(false);
    expect(statSync(manifestPath).mtimeMs).toBe(before);
    expect(writes).toEqual([]);
    expect(readFileSync(configPath, 'utf8')).toBe(nativeConfig);
    expect(second.preparation?.some(item => item.code === 'trusted-hook-config-collision')).toBe(false);
    const secondLaunch = await adapter.buildLaunchPlan!({ projectRoot: home, teamId: 'developer-team', mode: 'interactive', deckConfig: config });
    expect(secondLaunch.status).toBe('ready');
    if (secondLaunch.status === 'ready') {
      expect(secondLaunch.plan.args).not.toContain('features.hooks=false');
      expect(secondLaunch.diagnostics.some(item => item.code === 'codex-hooks-preserved')).toBe(false);
    }
    // A changed executable hook remains unauthenticated even with the native preference present.
    writeFileSync(configPath, nativeConfig.replace('deck internal codex-memory-hook', 'user-custom-command'));
    expect(() => prepareCodexNativeRole(codexHome, 'deck-quality')).toThrow('codex-session-generation-unverified');
    writeFileSync(configPath, nativeConfig);
    const custom = readFileSync(rolePath, 'utf8') + '\nuser_setting = true\n';
    writeFileSync(rolePath, custom);
    const edited = prepareCodexNativeRole(codexHome, 'deck-quality');
    expect(edited.preparation?.some(item => item.code === 'codex-role-preserved')).toBe(true);
    expect(readFileSync(rolePath, 'utf8')).toBe(custom);
    verifyCodexNativeRole(edited);
    writeFileSync(rolePath, custom.replace('sandbox_mode = "read-only"', 'sandbox_mode = "danger-full-access"'));
    expect(() => prepareCodexNativeRole(codexHome, 'deck-quality')).toThrow('codex-session-generation-unverified');
    const hookPath = join(codexHome, 'deck/hooks/developer-team-execution.js');
    const editedHook = readFileSync(hookPath, 'utf8') + '\n// user edit\n';
    writeFileSync(hookPath, editedHook);
    // S3-Q1: preserved, unreceipted scripts must never inherit command-block trust.
    const unreceipted = JSON.parse(readFileSync(manifestPath, 'utf8'));
    delete unreceipted.files['.codex/deck/hooks/developer-team-execution.js'];
    writeFileSync(manifestPath, JSON.stringify(unreceipted));
    writeFileSync(rolePath, custom);
    const launch = await adapter.buildLaunchPlan!({ projectRoot: home, teamId: 'developer-team', mode: 'interactive', deckConfig: config });
    expect(launch.status).toBe('ready');
    if (launch.status === 'ready') expect(launch.plan.args).toContain('features.hooks=false');
    expect(readFileSync(hookPath, 'utf8')).toBe(editedHook);
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  }
});
