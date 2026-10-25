import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planPackageRetirement, applyPackageRetirement } from './package-retirement';
const fixture = () => { const root = mkdtempSync(join(tmpdir(), 'deck-retirement-')); const path = join(root, 'mcp.json'); writeFileSync(path, '{\n  "mcpServers": {\n    "serena": {"command":"user-serena"},\n    "rtk": {"command":"rtk"}\n  },\n  "unrelated": true\n}\n'); return { root, path }; };
test('planning is read-only, preserves ambiguous entries and includes exact conditional deletion', () => {
  const f = fixture(); const before = readFileSync(f.path, 'utf8'); const files = readdirSync(f.root);
  const plan = planPackageRetirement({ runnerId: 'pi', targets: [{ path: f.path, format: 'json', container: ['mcpServers'] }], dedicatedRoots: [] });
  expect(plan.entries).toHaveLength(1); expect(plan.entries[0]!.ownership).toBe('ambiguous');
  expect(plan.entries[0]!.action).toBe('conditional-remove');
  applyPackageRetirement(plan, []);
  expect(readFileSync(f.path, 'utf8')).toBe(before); expect(readdirSync(f.root)).toEqual(files);
});
test('individual confirmation binds both entry and whole-file preimages, preserving sibling bytes', () => {
  const f = fixture(); const plan = planPackageRetirement({ runnerId: 'pi', targets: [{ path: f.path, format: 'json', container: ['mcpServers'] }], dedicatedRoots: [] });
  const e = plan.entries[0]!;
  applyPackageRetirement(plan, [{ id: e.id, entryHash: e.entryHash, fileHash: e.fileHash }]);
  expect(readFileSync(f.path, 'utf8')).toContain('"rtk": {"command":"rtk"}');
  expect(JSON.parse(readFileSync(f.path, 'utf8')).mcpServers.serena).toBeUndefined();
  expect(planPackageRetirement({ runnerId: 'pi', targets: [{ path: f.path, format: 'json', container: ['mcpServers'] }], dedicatedRoots: [] }).entries).toHaveLength(0);
  const other = fixture(); const stale = planPackageRetirement({ runnerId: 'pi', targets: [{ path: other.path, format: 'json', container: ['mcpServers'] }], dedicatedRoots: [] });
  writeFileSync(other.path, readFileSync(other.path, 'utf8') + '\n');
  expect(() => applyPackageRetirement(stale, [{ id: stale.entries[0]!.id, entryHash: stale.entries[0]!.entryHash, fileHash: stale.entries[0]!.fileHash }])).toThrow('changed');
});
test('dedicated location permits exact removal without a manifest', () => {
  const f = fixture(); const plan = planPackageRetirement({ runnerId: 'claude', targets: [{ path: f.path, format: 'json', container: ['mcpServers'] }], dedicatedRoots: [f.root] });
  expect(plan.entries[0]!.ownership).toBe('dedicated-location'); applyPackageRetirement(plan, []);
  expect(JSON.parse(readFileSync(f.path, 'utf8')).mcpServers).toEqual({ rtk: { command: 'rtk' } });
});

test('a retired owned symlink is removed as a link without reading or deleting its target', () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-retired-link-'));
  const external = mkdtempSync(join(tmpdir(), 'deck-preserved-link-target-'));
  const target = join(external, 'user-data'); writeFileSync(target, 'private user bytes');
  const path = join(root, 'retired-link'); symlinkSync(target, path);
  const plan = planPackageRetirement({ runnerId: 'codex', dedicatedRoots: [root], targets: [{ path, format: 'symlink', capability: 'serena' }] });
  expect(plan.entries).toHaveLength(1);
  expect(plan.entries[0]?.preview).not.toContain('private user bytes');
  applyPackageRetirement(plan, []);
  expect(existsSync(path)).toBe(false); expect(readFileSync(target, 'utf8')).toBe('private user bytes');
});

import { beginRunnerContributions, readRunnerContributions, canonicalContributionJson, contributionHash } from './runner-contributions';
for (const array of [false, true]) test(`grouped adjacent tail ${array ? 'array' : 'object'} removal publishes strict JSON and retryable receipts`, () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-retirement-tail-'));
  const path = join(root, 'mcp.json'), manifestPath = join(root, 'manifest.json');
  const container = array ? ['keep', 'context-mode', 'serena'] : { keep: { command: 'keep' }, 'context-mode': { command: 'ctx' }, serena: { command: 'serena' } };
  const targets = ['context-mode', 'serena'].map(id => ({ path, selector: array
    ? { kind: 'json-array' as const, keys: ['mcpServers'], identity: JSON.stringify(id) }
    : { kind: 'json' as const, keys: ['mcpServers', id] } }));
  const transaction = beginRunnerContributions({ runnerId: 'pi', root, manifestPath, deckVersion: 'test', targets });
  writeFileSync(path, JSON.stringify({ mcpServers: container })); transaction.commit();
  const makePlan = () => planPackageRetirement({ runnerId: 'pi', targets: [{ path, format: 'json', container: ['mcpServers'], array }], dedicatedRoots: [], contributions: readRunnerContributions(manifestPath)!.contributions });
  const plan = makePlan(); expect(plan.entries.every(entry => entry.action === 'remove')).toBe(true);
  applyPackageRetirement(plan, [], { manifestPath });
  expect(JSON.parse(readFileSync(path, 'utf8')).mcpServers).toEqual(array ? ['keep'] : { keep: { command: 'keep' } });
  expect(readRunnerContributions(manifestPath)!.contributions).toEqual([]);
  expect(applyPackageRetirement(makePlan(), [], { manifestPath }).removed).toEqual([]);
});
test('TOML display redacts parsed nested credential fields without changing exact preimages', () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-retirement-secret-')), path = join(root, 'config.toml');
  const secret = 'SYNTHETIC_ONLY_SECRET';
  const text = `[mcp_servers.serena]\ncommand = "serena"\npassword = "${secret}"\napi_key = "${secret}"\n[mcp_servers.serena.env]\nSERVICE_TOKEN = "${secret}"\n[mcp_servers.serena.headers]\nAuthorization = "${secret}"\n[mcp_servers.keep]\ncommand = "keep"\n`;
  writeFileSync(path, text);
  const plan = planPackageRetirement({ runnerId: 'codex', targets: [{ path, format: 'toml' }], dedicatedRoots: [] });
  expect(plan.entries).toHaveLength(1);
  expect(JSON.stringify(plan)).not.toContain(secret);
  expect(plan.entries[0]!.preview).toContain('serena');
  expect(plan.entries[0]!.preview).toContain('[redacted]');
  expect(readFileSync(path, 'utf8')).toBe(text);
  applyPackageRetirement(plan, plan.entries.map(({ id, entryHash, fileHash }) => ({ id, entryHash, fileHash })));
  expect(Bun.TOML.parse(readFileSync(path, 'utf8'))).toEqual({ mcp_servers: { keep: { command: 'keep' } } });
});

test('JSONC retirement preserves comments and publishes entry receipts with retry', () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-retirement-jsonc-')), path = join(root, 'opencode.jsonc'), manifestPath = join(root, 'manifest.json');
  const targets = ['context-mode', 'serena'].map(id => ({ path, selector: { kind: 'json' as const, keys: ['mcp', id] } }));
  const tx = beginRunnerContributions({ runnerId: 'opencode', root, manifestPath, deckVersion: 'test', targets });
  writeFileSync(path, '{"mcp":{"keep":{},"context-mode":{},"serena":{}}}'); tx.commit();
  writeFileSync(path, '{/* native JSONC comment */"mcp":{"keep":{},"context-mode":{},"serena":{},},}');
  const makePlan = () => planPackageRetirement({ runnerId: 'opencode', targets: [{ path, format: 'json', container: ['mcp'] }], dedicatedRoots: [], contributions: readRunnerContributions(manifestPath)!.contributions });
  applyPackageRetirement(makePlan(), [], { manifestPath });
  expect(readFileSync(path, 'utf8')).toContain('/* native JSONC comment */');
  expect(readRunnerContributions(manifestPath)!.contributions).toEqual([]);
  expect(makePlan().entries).toEqual([]);
});

test('grouped JSONC retirement preserves separators in unrelated containers', () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-retirement-jsonc-siblings-')), path = join(root, 'opencode.jsonc');
  const unrelated = '"personal":{"values":[1,2,],"nested":{"keep":true,},}';
  writeFileSync(path, `{${unrelated},"mcp":{"keep":{},"context-mode":{},"serena":{},},}`);
  const plan = planPackageRetirement({ runnerId: 'opencode', targets: [{ path, format: 'json', container: ['mcp'] }], dedicatedRoots: [root] });
  applyPackageRetirement(plan, []);
  expect(readFileSync(path, 'utf8')).toContain(unrelated);
});

test('TOML display redacts singular header and key fields', () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-retirement-toml-key-')), path = join(root, 'config.toml');
  writeFileSync(path, '[mcp_servers.serena]\ncommand = "serena"\nkey = "SYNTHETIC_KEY_ONLY"\nheader = "SYNTHETIC_HEADER_ONLY"\n');
  const plan = planPackageRetirement({ runnerId: 'codex', targets: [{ path, format: 'toml' }], dedicatedRoots: [] });
  expect(plan.entries).toHaveLength(1);
  expect(JSON.stringify(plan)).not.toContain('SYNTHETIC_KEY_ONLY');
  expect(JSON.stringify(plan)).not.toContain('SYNTHETIC_HEADER_ONLY');
});

for (const format of ['toml', 'json'] as const) for (const field of ['args', 'command']) {
  if (format === 'toml' && field === 'command') continue; // Native TOML command is scalar.
  test(`${format} ${field} display redacts contextual credentials while retaining exact mutation identity`, () => {
    const root = mkdtempSync(join(tmpdir(), 'deck-retirement-arguments-'));
    const path = join(root, format === 'toml' ? 'config.toml' : 'mcp.json');
    const options = ['--api-key', '--access_token', '--clientSecret', '--password', '--credentials', '--key', '--private-key', '--header', '--headers', '-H', '--authorization'];
    const secrets: string[] = [];
    const args = ['serena', '--transport', 'stdio'];
    for (const [index, option] of options.entries()) {
      const split = `SYNTHETIC_SPLIT_${index}`, equal = `SYNTHETIC_EQUALS_${index}`;
      secrets.push(split, equal);
      args.push(option, split, `${option}=${equal}`);
    }
    // A credential operand may itself look like a flag; it still belongs to the preceding flag.
    args.push('--token', '--SYNTHETIC_OPTION_OPERAND', '--port', '3000');
    secrets.push('--SYNTHETIC_OPTION_OPERAND');
    const selected = { ...(field === 'args' ? { command: 'serena' } : {}), [field]: args, env: { AUTH: 'SYNTHETIC_NESTED_ENV' } };
    secrets.push('SYNTHETIC_NESTED_ENV');
    const section = `[mcp_servers.serena]\ncommand = "serena"\nargs = ${JSON.stringify(args)}\n[mcp_servers.serena.env]\nAUTH = "SYNTHETIC_NESTED_ENV"`;
    const text = format === 'toml' ? `${section}\n[mcp_servers.keep]\ncommand = "keep"\n` : JSON.stringify({ mcpServers: { serena: selected, keep: { command: 'keep' } } });
    writeFileSync(path, text);
    const plan = planPackageRetirement({ runnerId: format === 'toml' ? 'codex' : 'pi', targets: [{ path, format, ...(format === 'json' ? { container: ['mcpServers'] } : {}) }], dedicatedRoots: [] });
    expect(plan.entries).toHaveLength(1);
    for (const secret of secrets) expect(JSON.stringify(plan)).not.toContain(secret);
    const entry = plan.entries[0]!;
    const preview = JSON.parse(entry.preview);
    if (field === 'args') expect(preview.command).toBe('serena');
    // Arguments have no reliable display grammar: even a flag-looking operand may be a secret.
    expect(preview[field]).toEqual(args.map((_, index) => field === 'command' && index === 0 ? 'serena' : '[redacted]'));
    expect(entry.context).toContain(format === 'toml' ? 'preserve every sibling' : 'keep');
    expect(entry.fileHash).toBe(contributionHash(text));
    expect(entry.entryHash).toBe(contributionHash(format === 'toml' ? section : canonicalContributionJson(selected)));
    expect(readFileSync(path, 'utf8')).toBe(text);
    applyPackageRetirement(plan, [{ id: entry.id, fileHash: entry.fileHash, entryHash: entry.entryHash }]);
    const result = format === 'toml' ? Bun.TOML.parse(readFileSync(path, 'utf8')) : JSON.parse(readFileSync(path, 'utf8'));
    expect(result[format === 'toml' ? 'mcp_servers' : 'mcpServers']).toEqual({ keep: { command: 'keep' } });
  });
}

test('surrounding array context and embedded argument strings cannot disclose credentials', () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-retirement-context-')), path = join(root, 'mcp.json');
  const secret = 'SYNTHETIC_CONTEXT_CREDENTIAL';
  writeFileSync(path, JSON.stringify({ plugin: ['personal-plugin', 'serena', {
    command: ['personal-tool', '--token', secret],
    args: [`--credentials=${secret}`, `exec tool --password ${secret}`, `exec --password ${secret}`, `exec '--token ${secret}'`, `CLIENT_SECRET=${secret}`, `https://example.invalid/?api_key=${secret}`],
  }] }));
  const plan = planPackageRetirement({ runnerId: 'opencode', targets: [{ path, format: 'json', container: ['plugin'], array: true }], dedicatedRoots: [] });
  expect(plan.entries).toHaveLength(1);
  expect(plan.entries[0]!.context).toContain('personal-plugin');
  expect(plan.entries[0]!.context).toContain('personal-tool');
  expect(plan.entries[0]!.context).toContain('[redacted]');
  expect(JSON.stringify(plan)).not.toContain(secret);
});

const opaqueArguments = [
  ['double quoted shell', ['-c', 'exec serena "--api-key" "SYNTHETIC_OPAQUE_VALUE"']],
  ['single quoted shell', ['-c', "exec serena '--api-key' 'SYNTHETIC_OPAQUE_VALUE'"]],
  ['escaped shell', ['-c', 'exec serena --api\\-key SYNTHETIC_OPAQUE_VALUE']],
  ['no credential name', ['-c', 'printf SYNTHETIC_OPAQUE_VALUE']],
  ['opaque positional', ['SYNTHETIC_OPAQUE_VALUE']],
  ['flag-looking positional', ['--SYNTHETIC_OPAQUE_VALUE']],
  ['nested argv', [['python', '-c', 'print("SYNTHETIC_OPAQUE_VALUE")']]],
] as const;

for (const [label, argumentsValue] of opaqueArguments) for (const format of ['toml', 'json'] as const) {
  test(`${format} hides entire ${label} argument without changing the selected bytes`, () => {
    const root = mkdtempSync(join(tmpdir(), 'deck-retirement-opaque-')), path = join(root, format === 'toml' ? 'config.toml' : 'mcp.json');
    const selected = { command: 'sh', args: argumentsValue };
    const text = format === 'toml' ? `[mcp_servers.serena]\ncommand = "sh"\nargs = ${JSON.stringify(argumentsValue)}\n` : JSON.stringify({ mcpServers: { serena: selected } });
    writeFileSync(path, text);
    const plan = planPackageRetirement({ runnerId: 'codex', targets: [{ path, format, ...(format === 'json' ? { container: ['mcpServers'] } : {}) }], dedicatedRoots: [] });
    if (format === 'toml' && label === 'nested argv' && plan.entries.length === 0) {
      // Bun 1.3.12 rejects this nested-array TOML shape; newer Bun accepts it.
      // Unsupported parser input must remain exact and secret-safe, with an
      // explicit diagnostic, rather than being called successfully migrated.
      expect(() => Bun.TOML.parse(text)).toThrow();
      expect(plan.diagnostics.join(' ')).toContain('safe inspection unavailable');
      expect(JSON.stringify(plan)).not.toContain('SYNTHETIC_OPAQUE_VALUE');
      expect(readFileSync(path, 'utf8')).toBe(text);
      return;
    }
    expect(plan.entries).toHaveLength(1);
    expect(JSON.stringify(plan)).not.toContain('SYNTHETIC_OPAQUE_VALUE');
    const entry = plan.entries[0]!;
    expect(JSON.parse(entry.preview).command).toBe('sh');
    expect(entry.selector).toContain('serena');
    expect(entry.fileHash).toBe(contributionHash(text));
    expect(entry.entryHash).toBe(contributionHash(format === 'toml' ? text.trimEnd() : canonicalContributionJson(selected)));
    expect(readFileSync(path, 'utf8')).toBe(text);
    applyPackageRetirement(plan, [{ id: entry.id, fileHash: entry.fileHash, entryHash: entry.entryHash }]);
    const remaining = format === 'toml' ? Bun.TOML.parse(readFileSync(path, 'utf8')) : JSON.parse(readFileSync(path, 'utf8'));
    expect(remaining[format === 'toml' ? 'mcp_servers' : 'mcpServers']?.serena).toBeUndefined();
  });
}

test('opaque scalar commands and nested command arrays are hidden in previews and surrounding context', () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-retirement-opaque-command-')), path = join(root, 'mcp.json');
  const command = 'exec serena "--api-key" "SYNTHETIC_OPAQUE_COMMAND"';
  writeFileSync(path, JSON.stringify({ mcpServers: { serena: { command, args: 'SYNTHETIC_OPAQUE_ARGS' } }, plugin: ['serena', { command: ['sh', ['-c', command]], args: ['SYNTHETIC_OPAQUE_ARGS'] }] }));
  const plan = planPackageRetirement({ runnerId: 'pi', targets: [{ path, format: 'json', container: ['mcpServers'] }, { path, format: 'json', container: ['plugin'], array: true }], dedicatedRoots: [] });
  expect(plan.entries).toHaveLength(2);
  expect(JSON.stringify(plan)).not.toContain('SYNTHETIC_OPAQUE');
  expect(JSON.parse(plan.entries[0]!.preview)).toEqual({ command: '[redacted]', args: '[redacted]' });
  expect(plan.entries[1]!.context).toContain('sh');
});

test('duplicate historical receipt IDs preserve first-record ownership semantics', async () => {
  const { contributionId } = await import('./runner-contributions');
  const f=fixture(),target={path:f.path,selector:{kind:'json' as const,keys:['mcpServers','serena']}};
  const input={runnerId:'pi',targets:[{path:f.path,format:'json' as const,container:['mcpServers']}],dedicatedRoots:[]};
  const entry=planPackageRetirement(input).entries[0]!;
  const valid={...target,id:contributionId(target),hash:entry.entryHash,encoding:'canonical-json-v1' as const,ownership:'prior-record' as const,scope:'global' as const};
  const invalid={...valid,hash:'0'.repeat(64)};
  expect(planPackageRetirement({...input,contributions:[invalid,valid]}).entries[0]!.ownership).toBe('ambiguous');
  expect(planPackageRetirement({...input,contributions:[valid,invalid]}).entries[0]!.ownership).toBe('manifest-proven');
});

test('malformed legacy receipt rows remain preserved diagnostics rather than planner failures', () => {
  const f=fixture();
  const plan=planPackageRetirement({runnerId:'pi',targets:[{path:f.path,format:'json',container:['mcpServers']}],dedicatedRoots:[],contributions:[null] as any});
  expect(plan.entries).toHaveLength(0);
  expect(plan.diagnostics).toHaveLength(1);
  expect(JSON.parse(readFileSync(f.path,'utf8')).mcpServers.serena.command).toBe('user-serena');
});
