import { tmpdir } from 'node:os';
import { realpathSync } from 'node:fs';
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDefaultDeckConfig } from "@deck/core";
import { createCodexRunnerAdapter } from "./runner-adapter";
import { createNodeCodexFileEffects } from "./node-effects";
import { verifyCodexNativeRole } from "./native-role";

// Protects upgrade recovery, idempotence, customization preservation and read-only admission.
// Oracle: resilient-verification slice 3; all mutable roots and tool effects are isolated.
test("native process lease defers adapter refresh and a crashed owner does not prevent recovery", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'deck-codex-refresh-')));
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
    // S3-Q2: a different native process holds the installation; refresh resumes after a crash.
    const child = Bun.spawn([process.execPath, '--eval', `
      import { withCodexInstallationUse } from ${JSON.stringify(join(import.meta.dir, 'installation-use.ts'))};
      await withCodexInstallationUse(process.env.CODEX_HOME, async () => {
        console.log('reserved');
        await Bun.stdin.text();
      });
    `], { env: { ...process.env, CODEX_HOME: codexHome }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    try {
      const reader = child.stdout.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('reserved');
      reader.releaseLock();
      const deferred = await adapter.prepareSessionNativeRole!('deck-quality', config);
      expect(deferred.preparation?.some(item => item.code === 'codex-refresh-deferred')).toBe(true);
      expect(readFileSync(rolePath, 'utf8')).toBe(stale);
    } finally { child.kill('SIGKILL'); await child.exited; }
    const role = await adapter.prepareSessionNativeRole!('deck-quality', config);
    expect(role.preparation?.some(item => item.kind === 'H')).toBe(true);
    verifyCodexNativeRole(role);
    expect(readFileSync(rolePath, 'utf8')).not.toBe(stale);
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  }
});
