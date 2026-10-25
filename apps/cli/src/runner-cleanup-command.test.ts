import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync, lstatSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanupRoots, planRunnerCleanup } from './runner-cleanup-command';

test('legacy native Pi package selections require exact review and preserve shared siblings', async () => {
  const { runRunnerCleanupUpdate } = await import('./runner-cleanup-command');
  const home = mkdtempSync(join(tmpdir(), 'deck-cleanup-native-pi-')), roots = cleanupRoots({ HOME: home });
  mkdirSync(roots.pi, { recursive: true });
  const path = join(roots.pi, 'settings.json');
  const text = JSON.stringify({ packages: ['npm:context-mode@1.0.169', 'npm:context-mode-user@1', 'npm:user-extension@2'], theme: 'user-theme' });
  writeFileSync(path, text);
  const plan = planRunnerCleanup(roots, ['pi']).plans[0]!;
  expect(plan.entries).toHaveLength(1);
  expect(plan.entries[0]!.ownership).toBe('ambiguous');
  expect(plan.entries[0]!.selector).toContain('context-mode@1.0.169');
  await runRunnerCleanupUpdate(roots, ['pi'], { admission: async effect => effect() });
  expect(readFileSync(path, 'utf8')).toBe(text);
  const reviewed: string[] = [];
  await runRunnerCleanupUpdate(roots, ['pi'], { admission: async effect => effect(), ask: async question => { reviewed.push(question); return 'remove'; } });
  expect(reviewed).toHaveLength(1);
  expect(reviewed[0]).toContain(`${path}#${plan.entries[0]!.selector}`);
  expect(reviewed[0]).toContain(plan.entries[0]!.fileHash);
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ packages: ['npm:context-mode-user@1', 'npm:user-extension@2'], theme: 'user-theme' });
  expect(planRunnerCleanup(roots, ['pi']).plans[0]!.entries).toHaveLength(0);
});

test('legacy Deck-owned native Codebase executables follow explicit activation and preserve knowledge data', () => {
  const home=mkdtempSync(join(tmpdir(),'deck-cleanup-native-codebase-')),roots=cleanupRoots({HOME:home});
  const native=join(roots.data,'pi/tools/codebase-native-v0.11.0/linux-x64');mkdirSync(native,{recursive:true});
  const binary=join(native,'codebase-memory-mcp'),data=join(native,'knowledge.db');
  writeFileSync(binary,'actual-installation-artifact-shape');writeFileSync(data,'user knowledge');
  const plan=planRunnerCleanup(roots,['pi']).plans[0]!;
  expect(plan.entries.map(entry=>entry.path)).toEqual([binary]);
  expect(plan.entries[0]!.ownership).toBe('dedicated-location');
  mkdirSync(join(home,'.config/deck'),{recursive:true});
  writeFileSync(join(home,'.config/deck/config.json'),JSON.stringify({capabilities:{'codebase-memory':{enabled:true}}}));
  expect(planRunnerCleanup(roots,['pi']).plans[0]!.entries).toHaveLength(0);
  writeFileSync(join(home,'.config/deck/config.json'),JSON.stringify({capabilities:{'codebase-memory':{enabled:true,runners:{pi:false}}}}));
  applyPackageRetirement(planRunnerCleanup(roots,['pi']).plans[0]!,[]);
  expect(()=>readFileSync(binary)).toThrow();
  expect(readFileSync(data,'utf8')).toBe('user knowledge');
});

test('actual npm layout retirement includes dangling executable links and exact lock entries, preserving shared siblings', () => {
  const home = mkdtempSync(join(tmpdir(), 'deck-cleanup-npm-layout-')), roots = cleanupRoots({ HOME: home });
  const tools = join(roots.data, 'codex/tools'); mkdirSync(join(tools, 'node_modules/.bin'), { recursive: true });
  const link = join(tools, 'node_modules/.bin/context-mode'); symlinkSync('../context-mode/cli.bundle.mjs', link);
  const lock = join(tools, 'package-lock.json');
  writeFileSync(lock, JSON.stringify({ lockfileVersion: 3, packages: {
    '': { dependencies: { 'context-mode': '1.0.169', keep: '1' } },
    'node_modules/context-mode': { version: '1.0.169', resolved: 'https://SYNTHETIC-credential@registry.invalid/context.tgz' },
    'node_modules/context-mode/node_modules/nested': { version: '2' },
    'node_modules/keep': { version: '1' }, 'node_modules/context-mode-user': { version: '3' },
  }, dependencies: { 'context-mode': { version: '1.0.169' }, keep: { version: '1' } } }));
  const plan = planRunnerCleanup(roots, ['codex']).plans[0]!;
  expect(plan.entries).toHaveLength(5);
  expect(plan.entries.every(entry => entry.action === 'remove')).toBe(true);
  expect(JSON.stringify(plan)).not.toContain('SYNTHETIC-credential');
  applyPackageRetirement(plan, []);
  expect(() => lstatSync(link)).toThrow();
  expect(JSON.parse(readFileSync(lock, 'utf8'))).toEqual({ lockfileVersion: 3, packages: {
    '': { dependencies: { keep: '1' } }, 'node_modules/keep': { version: '1' }, 'node_modules/context-mode-user': { version: '3' },
  }, dependencies: { keep: { version: '1' } } });
  expect(planRunnerCleanup(roots, ['codex']).plans[0]!.entries).toEqual([]);
});
import { contributionHash, contributionId, applyPackageRetirement, acquireRunnerGenerationReference } from '@deck/core';
test('planning reads raw legacy manifests, leaves every byte intact, and never follows symlinks', () => {
  const home = mkdtempSync(join(tmpdir(), 'deck-cleanup-readonly-')); const roots = { home, data: join(home,'data/deck'), codex: join(home,'codex'), opencode: join(home,'opencode'), pi: join(home,'pi') };
  for(const path of [roots.codex, roots.opencode, join(roots.pi,'deck'), join(roots.data,'claude/developer-team-v2-abcdef')]) mkdirSync(path,{recursive:true});
  const config = join(roots.pi,'mcp.json'); const text = '{"mcpServers":{"serena":{"command":"owned-serena"},"user-tool":{"command":"user"}}}';writeFileSync(config,text);
  const canonical = '{"command":"owned-serena"}'; const hash=contributionHash(canonical);
  const manifest=join(roots.pi,'deck/manifest.json');const manifestText=JSON.stringify({schema:'deck-pi-manifest-v1',files:{},mcp:{servers:{serena:hash}}});writeFileSync(manifest,manifestText);
  writeFileSync(join(roots.codex,'config.toml'),'[mcp_servers.serena]\ncommand="user-serena"\n');
  const external=mkdtempSync(join(tmpdir(),'deck-external-preserve-'));writeFileSync(join(external,'config'),'untouched');symlinkSync(external,join(roots.data,'claude/developer-team-v2-abcdef/.mcp.json'));
  const report=planRunnerCleanup(roots);
  expect(report.plans.find(p=>p.runnerId==='pi')?.entries[0]?.ownership).toBe('manifest-proven');
  expect(report.plans.find(p=>p.runnerId==='codex')?.entries[0]?.ownership).toBe('ambiguous');
  expect(report.plans.find(p=>p.runnerId==='claude')?.diagnostics.join(' ')).toContain('symlink');
  expect(readFileSync(config,'utf8')).toBe(text);expect(readFileSync(manifest,'utf8')).toBe(manifestText);
  expect(readdirSync(join(roots.pi,'deck'))).toEqual(['manifest.json']);expect(readFileSync(join(external,'config'),'utf8')).toBe('untouched');
});
test('unreadable activation intent defers optional Codebase Memory removal', () => {
  const home = mkdtempSync(join(tmpdir(), 'deck-cleanup-intent-'));
  const roots = { home, data: join(home, 'data/deck'), codex: join(home, 'codex'), opencode: join(home, 'config/opencode'), pi: join(home, 'pi'), config: join(home, 'config/deck/config.json') };
  mkdirSync(join(home, 'config/deck'), { recursive: true }); mkdirSync(roots.codex);
  writeFileSync(join(home, 'config/deck/config.json'), '{broken');
  writeFileSync(join(roots.codex, 'config.toml'), '[mcp_servers.codebase-memory]\ncommand="keep"\n[mcp_servers.serena]\ncommand="retired"\n');
  const plan = planRunnerCleanup(roots, ['codex']).plans[0]!;
  expect(plan.entries.map(entry => entry.capability)).toEqual(['serena']);
  expect(plan.diagnostics.join(' ')).toContain('Codebase Memory');
});
test('an unused Claude generation can retire its entries after replacement selection', () => {
  const home = mkdtempSync(join(tmpdir(), 'deck-cleanup-generation-'));
  const roots = { home, data: join(home, 'data/deck'), codex: join(home, 'codex'), opencode: join(home, 'opencode'), pi: join(home, 'pi') };
  const generation = join(roots.data, 'claude/developer-team-v2-abcdef'); mkdirSync(generation, { recursive: true });
  writeFileSync(join(generation, '.mcp.json'), '{"mcpServers":{"serena":{"command":"retired"}}}');
  const plan = planRunnerCleanup(roots, ['claude']).plans[0]!;
  expect(plan.entries[0]?.ownership).toBe('dedicated-location');
  expect(plan.entries[0]?.action).toBe(process.platform === 'linux' ? 'remove' : 'preserve');
  if (process.platform === 'linux') {
    applyPackageRetirement(plan, []);
    expect(JSON.parse(readFileSync(join(generation, '.mcp.json'), 'utf8'))).toEqual({ mcpServers: {} });
  }
});

test('effective roots separate runner overrides from canonical Deck activation', () => {
  const home = mkdtempSync(join(tmpdir(), 'deck-cleanup-roots-'));
  const roots = cleanupRoots({ HOME: home, XDG_CONFIG_HOME: join(home, 'xdg/config'), XDG_DATA_HOME: join(home, 'xdg/data'), OPENCODE_CONFIG_DIR: join(home, 'custom-opencode'), CODEX_HOME: join(home, 'custom-codex'), PI_CODING_AGENT_DIR: join(home, 'custom-pi') });
  expect(roots.opencode).toBe(join(home, 'custom-opencode'));
  expect(roots.config).toBe(join(home, 'xdg/config/deck/config.json'));
  expect(roots.codex).toBe(join(home, 'custom-codex'));
  expect(roots.pi).toBe(join(home, 'custom-pi'));
  expect(roots.data).toBe(join(home, 'xdg/data/deck'));
  mkdirSync(join(home, 'xdg/config/deck'), { recursive: true }); mkdirSync(roots.opencode);
  writeFileSync(roots.config!, JSON.stringify({ capabilities: { 'codebase-memory': { enabled: true } } }));
  writeFileSync(join(roots.opencode, 'opencode.json'), '{"mcp":{"codebase-memory":{"command":["keep"]},"serena":{"command":["retire"]}}}');
  const plan = planRunnerCleanup(roots, ['opencode']).plans[0]!;
  expect(plan.entries.map(entry => entry.capability)).toEqual(['serena']);
});
test('invalid relative XDG roots use the same home fallback as installation', () => {
  const home = mkdtempSync(join(tmpdir(), 'deck-cleanup-xdg-'));
  const roots = cleanupRoots({ HOME: home, XDG_CONFIG_HOME: 'relative', XDG_DATA_HOME: 'relative' });
  expect(roots.config).toBe(join(home, '.config/deck/config.json'));
  expect(roots.data).toBe(join(home, '.local/share/deck'));
});

test('cleanup resolves Claude user MCP and additional OpenCode configuration overrides', () => {
  const home = mkdtempSync(join(tmpdir(), 'deck-cleanup-native-overrides-'));
  const roots = cleanupRoots({ HOME: home, CLAUDE_CONFIG_DIR: join(home, 'claude-config'), OPENCODE_CONFIG: join(home, 'extra-opencode.json'), OPENCODE_CONFIG_CONTENT: '{"mcp":{}}' });
  expect(roots.claudeConfig).toBe(join(home, 'claude-config/.claude.json'));
  mkdirSync(join(home, 'claude-config'));
  writeFileSync(roots.claudeConfig!, '{"mcpServers":{"serena":{"command":"user"}}}');
  writeFileSync(join(home, 'extra-opencode.json'), '{"mcp":{"context-mode":{"command":["user"]}}}');
  const report = planRunnerCleanup(roots, ['claude', 'opencode']);
  expect(report.plans[0]!.entries[0]?.path).toBe(roots.claudeConfig!);
  expect(report.plans[1]!.entries[0]?.path).toBe(join(home, 'extra-opencode.json'));
  expect(report.plans[1]!.diagnostics.join(' ')).toContain('OPENCODE_CONFIG_CONTENT');
  expect(report.plans.flatMap(plan => plan.entries).every(entry => entry.action === 'conditional-remove')).toBe(true);
});

test('invalid runner overrides never redirect cleanup into the working directory', () => {
  const home = mkdtempSync(join(tmpdir(), 'deck-cleanup-invalid-overrides-'));
  expect(cleanupRoots({ HOME: home, CODEX_HOME: 'relative-codex' }).codex).toBe(join(home, '.codex'));
  for (const PI_CODING_AGENT_DIR of ['', 'relative-pi']) expect(() => cleanupRoots({ HOME: home, PI_CODING_AGENT_DIR })).toThrow('PI_CODING_AGENT_DIR');
});

test('plan includes recorded retired files at arbitrary paths and legacy plugin-array entries', () => {
  const home = mkdtempSync(join(tmpdir(), 'deck-cleanup-contributions-'));
  const roots = cleanupRoots({ HOME: home });
  const manifestPath = join(roots.opencode, 'deck/manifest.json');
  const artifact = join(home, 'shared-tools/retired-launcher');
  mkdirSync(join(roots.opencode, 'deck'), { recursive: true }); mkdirSync(join(home, 'shared-tools'));
  writeFileSync(artifact, 'recorded bytes');
  const target = { path: artifact, selector: { kind: 'file' as const } };
  writeFileSync(manifestPath, JSON.stringify({ schema: 'deck-runner-contributions-v1', runnerId: 'opencode', root: roots.opencode, contributions: [{ ...target, id: contributionId(target), hash: contributionHash('recorded bytes'), sourceItemId: 'package:serena', ownership: 'prior-record', scope: 'global', encoding: 'bytes' }] }));
  const configPath = join(roots.opencode, 'opencode.json');
  writeFileSync(configPath, '{"plugin":["user-plugin", "context-mode@1.0.169"], "permission":{"bash":"ask"}}');
  const plan = planRunnerCleanup(roots, ['opencode']).plans[0]!;
  expect(plan.entries.find(entry => entry.path === artifact)?.ownership).toBe('manifest-proven');
  const plugin = plan.entries.find(entry => entry.path === configPath)!;
  expect(plugin.selector).toContain('plugin'); expect(plugin.action).toBe('conditional-remove');
  expect(plugin.context).toContain('user-plugin');
  applyPackageRetirement({ ...plan, entries: [plugin] }, [{ id: plugin.id, fileHash: plugin.fileHash, entryHash: plugin.entryHash }]);
  expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({ plugin: ['user-plugin'], permission: { bash: 'ask' } });
});

test('selected Claude generations require replacement and old plans recheck launch references', () => {
  const home = mkdtempSync(join(tmpdir(), 'deck-cleanup-active-generation-'));
  const roots = cleanupRoots({ HOME: home });
  const parent = join(roots.data, 'claude'), generation = join(parent, 'developer-team-v2-abcdef');
  mkdirSync(generation, { recursive: true });
  writeFileSync(join(generation, '.mcp.json'), '{"mcpServers":{"serena":{"command":"retired"}}}');
  const selectionPath = join(parent, 'model-assignments.json');
  writeFileSync(selectionPath, JSON.stringify({ plugin: 'developer-team-v2-abcdef' }));
  expect(planRunnerCleanup(roots, ['claude']).plans[0]!.entries[0]?.reason).toContain('replacement');
  writeFileSync(selectionPath, JSON.stringify({ plugin: 'developer-team-v2-fedcba' }));
  if (process.platform !== 'linux') return;
  const plan = planRunnerCleanup(roots, ['claude']).plans[0]!;
  const release = acquireRunnerGenerationReference({ root: generation, selectionPath, selectionHash: contributionHash(readFileSync(selectionPath)) });
  try { expect(() => applyPackageRetirement(plan, [])).toThrow('reference'); }
  finally { release(); }
  applyPackageRetirement(plan, []);
});

test('dedicated retirement works with an invalid legacy manifest and preserves its evidence', () => {
  const home = mkdtempSync(join(tmpdir(), 'deck-cleanup-invalid-manifest-'));
  const roots = cleanupRoots({ HOME: home });
  const artifact = join(roots.codex, 'deck/tools/context-mode/launcher'); mkdirSync(join(roots.codex, 'deck/tools/context-mode'), { recursive: true });
  writeFileSync(artifact, 'retired artifact');
  const manifestPath = join(roots.codex, 'deck/manifest.json'); writeFileSync(manifestPath, '{invalid evidence');
  const plan = planRunnerCleanup(roots, ['codex']).plans[0]!;
  expect(plan.diagnostics.join(' ')).toContain('invalid');
  applyPackageRetirement(plan, [], { manifestPath });
  expect(readFileSync(manifestPath, 'utf8')).toBe('{invalid evidence');
  expect(planRunnerCleanup(roots, ['codex']).plans[0]!.entries).toEqual([]);
});

test('unconfirmed shared configuration references defer the shared Serena artifact tree', () => {
  const home = mkdtempSync(join(tmpdir(), 'deck-cleanup-shared-reference-'));
  const roots = cleanupRoots({ HOME: home });
  mkdirSync(roots.opencode, { recursive: true });
  writeFileSync(join(roots.opencode, 'opencode.json'), '{"mcp":{"serena":{"command":["shared-launcher"]}}}');
  const artifact = join(roots.data, 'tools/serena/launcher'); mkdirSync(join(roots.data, 'tools/serena'), { recursive: true }); writeFileSync(artifact, 'shared bytes');
  const report = planRunnerCleanup(roots);
  expect(report.plans.find(plan => plan.runnerId === 'opencode')!.entries[0]!.action).toBe('conditional-remove');
  expect(report.plans.flatMap(plan => plan.entries).find(entry => entry.path === artifact)!.action).toBe('preserve');
});

test('active generation references protect recorded retired leaves beyond the MCP file', () => {
  const home = mkdtempSync(join(tmpdir(), 'deck-cleanup-generation-leaf-'));
  const roots = cleanupRoots({ HOME: home }); const parent = join(roots.data, 'claude');
  const generation = join(parent, 'developer-team-v2-abcdef'); mkdirSync(generation, { recursive: true });
  const artifact = join(generation, 'retired-hook.js'); writeFileSync(artifact, 'retired');
  writeFileSync(join(parent, 'model-assignments.json'), '{"plugin":"developer-team-v2-abcdef"}');
  const target = { path: artifact, selector: { kind: 'file' as const } };
  writeFileSync(join(parent, 'manifest.json'), JSON.stringify({ schema: 'deck-runner-contributions-v1', runnerId: 'claude', root: parent, contributions: [{ ...target, id: contributionId(target), hash: contributionHash('retired'), sourceItemId: 'package:serena' }] }));
  const entry = planRunnerCleanup(roots, ['claude']).plans[0]!.entries[0]!;
  expect(entry.action).toBe('preserve'); expect(entry.reason).toContain('replacement');
});

test('TOML secret values never appear in console planning or serialized output artifacts', async () => {
  const { runRunnerCleanupCommand } = await import('./runner-cleanup-command');
  const home = mkdtempSync(join(tmpdir(), 'deck-cleanup-redaction-'));
  const roots = { home, data: join(home, 'data/deck'), codex: join(home, 'codex'), opencode: join(home, 'opencode'), pi: join(home, 'pi') };
  mkdirSync(roots.codex);
  const secret = 'SYNTHETIC_CONSOLE_SECRET';
  const path = join(roots.codex, 'config.toml');
  const argumentSecret = 'SYNTHETIC_REVIEW_ARGUMENT_CREDENTIAL';
  const before = `[mcp_servers.serena]\ncommand = "serena"\nargs = ["--api-key", "${argumentSecret}", "--header=${argumentSecret}"]\npassword = "${secret}"\napi_key = "${secret}"\n[mcp_servers.serena.env]\nSERVICE_TOKEN = "${secret}"\n[mcp_servers.serena.headers]\nAuthorization = "${secret}"\n`;
  writeFileSync(path, before);
  const lines: string[] = [], original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    const output = join(home, 'plan.json');
    expect(await runRunnerCleanupCommand({ runner: 'codex', review: false, json: false, output }, roots)).toBe(0);
    expect(lines.join('\n')).not.toContain(secret);
    expect(lines.join('\n')).not.toContain(argumentSecret);
    expect(lines.join('\n')).toContain('[redacted]');
    expect(readFileSync(output, 'utf8')).not.toContain(secret);
    expect(readFileSync(output, 'utf8')).not.toContain(argumentSecret);
    lines.length = 0;
    expect(await runRunnerCleanupCommand({ runner: 'codex', review: false, json: true }, roots)).toBe(0);
    expect(lines.join('\n')).not.toContain(argumentSecret);
    expect(lines.join('\n')).not.toContain(secret);
    expect(readFileSync(path, 'utf8')).toBe(before);
  } finally { console.log = original; }
});

test('opaque shell and code arguments stay hidden in console, JSON and output artifacts', async () => {
  const { runRunnerCleanupCommand } = await import('./runner-cleanup-command');
  const home = mkdtempSync(join(tmpdir(), 'deck-cleanup-opaque-'));
  const roots = { home, data: join(home, 'data/deck'), codex: join(home, 'codex'), opencode: join(home, 'opencode'), pi: join(home, 'pi') };
  mkdirSync(roots.codex); mkdirSync(roots.opencode);
  const marker = 'SYNTHETIC_QUOTED_ARGUMENT_CREDENTIAL';
  const fragments = [
    `exec serena "--api-key" "${marker}"`,
    `exec serena '--api-key' '${marker}'`,
    `exec serena --api\\-key ${marker}`,
    `printf ${marker}`,
  ];
  const lines: string[] = [], original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    for (const [index, fragment] of fragments.entries()) {
      const tomlPath = join(roots.codex, 'config.toml'), jsonPath = join(roots.opencode, 'opencode.json');
      const toml = `[mcp_servers.serena]\ncommand = "sh"\nargs = ${JSON.stringify(['-c', fragment])}\n`;
      const json = JSON.stringify({ mcp: { serena: { command: ['sh', ['-c', fragment]] } }, plugin: ['serena', { command: ['sh', '-c', fragment] }] });
      writeFileSync(tomlPath, toml); writeFileSync(jsonPath, json);
      for (const runner of ['codex', 'opencode']) for (const jsonOutput of [false, true]) {
        lines.length = 0;
        const output = join(home, `plan-${index}-${runner}-${jsonOutput}.json`);
        expect(await runRunnerCleanupCommand({ runner, review: false, json: jsonOutput, output }, roots)).toBe(0);
        const displayed = lines.join('\n') + readFileSync(output, 'utf8');
        expect(displayed).not.toContain(marker);
        expect(displayed).not.toContain(fragment);
        expect(displayed).toContain('serena'); expect(displayed).toContain('sh');
      }
      expect(readFileSync(tomlPath, 'utf8')).toBe(toml); expect(readFileSync(jsonPath, 'utf8')).toBe(json);
    }
  } finally { console.log = original; }
});

test('Claude opt-out keeps the native Codebase executable until old plugin bindings are retired', async () => {
  const { runRunnerCleanupUpdate } = await import('./runner-cleanup-command');
  const home=mkdtempSync(join(tmpdir(),'deck-cleanup-claude-codebase-')),roots=cleanupRoots({HOME:home});
  const root=join(roots.data,'claude'),generation=join(root,'developer-team-v2-aabb');
  const binary=join(root,'tools/codebase-native-v0.11.0/linux-x64/codebase-memory-mcp');
  mkdirSync(dirname(binary),{recursive:true});mkdirSync(generation,{recursive:true});
  writeFileSync(binary,'historical native executable');
  const binding=join(generation,'.mcp.json');
  writeFileSync(binding,JSON.stringify({mcpServers:{'codebase-memory':{command:binary}}}));
  writeFileSync(join(root,'model-assignments.json'),JSON.stringify({plugin:'developer-team-v2-aabb'}));
  const initial=planRunnerCleanup(roots,['claude']).plans[0]!;
  expect(initial.entries.find(entry=>entry.path===binary)?.action).toBe('preserve');
  await runRunnerCleanupUpdate(roots,['claude'],{admission:async effect=>effect()});
  expect(readFileSync(binary,'utf8')).toBe('historical native executable');
  // A verified replacement no longer uses Codebase. The old binding is still
  // present until its own generation/reference checks and individual review.
  writeFileSync(join(root,'model-assignments.json'),JSON.stringify({plugin:'developer-team-v2-ccdd'}));
  await runRunnerCleanupUpdate(roots,['claude'],{admission:async effect=>effect(),ask:async()=> 'remove'});
  expect(JSON.parse(readFileSync(binding,'utf8')).mcpServers).toEqual({});
  await runRunnerCleanupUpdate(roots,['claude'],{admission:async effect=>effect()});
  expect(()=>readFileSync(binary)).toThrow();
});
