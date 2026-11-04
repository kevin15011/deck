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

import { beginRunnerContributions, readRunnerContributions, canonicalContributionJson, contributionHash, contributionId } from './runner-contributions';
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

test('an edited receipt overrides dedicated location ownership during decommissioning', () => {
  const f = fixture();
  const target = { path: f.path, selector: { kind: 'json' as const, keys: ['mcpServers', 'serena'] } };
  const manifestPath = join(f.root, 'contributions.json');
  const transaction = beginRunnerContributions({ runnerId: 'pi', root: f.root, manifestPath, deckVersion: 'test', targets: [target], dedicatedRoots: [f.root] });
  transaction.commit();
  const contributions = readRunnerContributions(manifestPath)!.contributions;
  expect(contributions).toHaveLength(1);
  writeFileSync(f.path, readFileSync(f.path, 'utf8').replace('user-serena', 'customized-serena'));
  const before = readFileSync(f.path, 'utf8');
  const plan = planPackageRetirement({ runnerId: 'pi', targets: [{ path: f.path, format: 'json', container: ['mcpServers'] }], dedicatedRoots: [f.root], contributions });
  expect(plan.entries[0]!.action).toBe('preserve');
  expect(plan.entries[0]!.reason).toContain('changed');
  applyPackageRetirement(plan, []);
  expect(readFileSync(f.path, 'utf8')).toBe(before);
});

// Protects shared config entries under dedicated roots: only exact granular receipts authorize unattended removal.
for (const format of ["json", "json-array", "toml"] as const) {
 for (const evidence of ["missing", "matching", "invalid", "edited"] as const) {
  test(`retired shared ${format} entries require receipts: ${evidence}`, () => {
   const root=mkdtempSync(join(tmpdir(),"deck-retired-config-"));
   const path=join(root,format === "toml" ? "config.toml" : "config.json");
   const ids=["supermemory","deck-memory","adaptive-memory"];
   const value={command:"/fixture/owned"};
   const original=format === "toml" ? ids.map(id=>`[mcp_servers.${id}]\ncommand = "/fixture/owned"`).join("\n")+`\n[mcp_servers.keep]\ncommand = "/fixture/keep"\n` : JSON.stringify({mcpServers:format === "json-array" ? [...ids,"keep"] : Object.fromEntries([...ids.map(id=>[id,value]),["keep",{command:"/fixture/keep"}]])});
   writeFileSync(path,original);
   const target={path,format:format === "toml" ? "toml" as const : "json" as const,container:["mcpServers"],array:format === "json-array"};
   const initial=planPackageRetirement({runnerId:"pi",targets:[target],dedicatedRoots:[root]});
   // Receipts are independently hashed from the known fixture contribution values.
   const contributions=initial.entries.map(entry=>({...entry.contribution!,id:contributionId(entry.contribution!),hash:evidence === "invalid" ? "invalid" : contributionHash(format === "toml" ? `[mcp_servers.${entry.capability}]\ncommand = "/fixture/owned"` : canonicalContributionJson(format === "json-array" ? entry.capability : value)),encoding:format === "toml" ? "bytes" as const : "canonical-json-v1" as const,ownership:"prior-record" as const,scope:"global" as const}));
   if(evidence === "edited") writeFileSync(path,ids.reduce((text,id)=>text.replaceAll(JSON.stringify(id),JSON.stringify(`${id}@custom`)),original.replaceAll("/fixture/owned","/fixture/custom")));
   const before=readFileSync(path,"utf8");
   const plan=planPackageRetirement({runnerId:"pi",targets:[target],dedicatedRoots:[root],contributions:evidence === "missing" ? [] : contributions});
   applyPackageRetirement(plan,[]);
   if(evidence === "matching") {
    expect(plan.entries.every(entry=>entry.action === "remove")).toBe(true);
    expect(readFileSync(path,"utf8")).toContain("keep");
    expect(readFileSync(path,"utf8")).not.toContain("supermemory");
   } else expect(readFileSync(path,"utf8")).toBe(before);
  });
 }
}

// Protects exact installed receipt boundaries; oracle: only selected owned bytes may disappear.
test('TOML retirement shares receipt selection and preserves following section comments', () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-retirement-toml-receipt-'));
  const path = join(root, 'config.toml'), manifestPath = join(root, 'manifest.json');
  const owned = '[mcp_servers.supermemory]\ncommand = "/fixture/proxy"\n[mcp_servers.supermemory.env]\nMODE = "fixture"';
  const sibling = '\n\n# deck-codex-hook:keep:start\n[hooks]\nvalue = "keep"\n# deck-codex-hook:keep:end\n';
  const target = { path, selector: { kind: 'toml' as const, header: 'mcp_servers.supermemory' } };
  const tx = beginRunnerContributions({ runnerId: 'codex', root, manifestPath, deckVersion: 'test', targets: [target] });
  writeFileSync(path, owned + sibling); tx.commit();
  const contributions = readRunnerContributions(manifestPath)!.contributions;
  const plan = planPackageRetirement({ runnerId: 'codex', targets: [{ path, format: 'toml' }], dedicatedRoots: [], contributions });
  expect(plan.entries[0]!.action).toBe('remove');
  expect(plan.entries[0]!.entryHash).toBe(contributionHash(owned));
  applyPackageRetirement(plan, [], { manifestPath });
  expect(readFileSync(path, 'utf8')).toBe(sibling);
  expect(readRunnerContributions(manifestPath)!.contributions).toEqual([]);
});

// Protects destructive cleanup: even exact receipts cannot resolve ambiguous block markers.
// Oracle: retirement requires one ordered pair and preservation without backup or receipt release.
for (const hook of ['supermemory', 'memory-bridge']) {
  for (const shape of ['duplicate-end-before', 'duplicate-end-after', 'duplicate-start', 'reversed', 'missing-start', 'missing-end', 'nested-same', 'nested-other', 'inside-other'] as const) {
    test(`text retirement preserves ${hook} ${shape}`, () => {
      const root = mkdtempSync(join(tmpdir(), 'deck-retirement-markers-'));
      const path = join(root, 'config.toml'), manifestPath = join(root, 'manifest.json'), backupRoot = join(root, 'backups');
      const start = `# deck-codex-hook:${hook}:start`, end = `# deck-codex-hook:${hook}:end`;
      const selector = { kind: 'text' as const, start, end };
      const body = '\n[hooks]\ncommand = "/fixture/owned"\n';
      const block = start + body + end;
      const tx = beginRunnerContributions({ runnerId: 'codex', root, manifestPath, deckVersion: 'test', targets: [{ path, selector }] });
      writeFileSync(path, block); tx.commit();
      const nested = '# deck-codex-hook:personal:start\n# deck-codex-hook:personal:end\n';
      const malformed = shape === 'duplicate-end-before' ? end + '\n' + block
        : shape === 'duplicate-end-after' ? block + '\n' + end
        : shape === 'duplicate-start' ? start + '\n' + block
        : shape === 'reversed' ? end + body + start
        : shape === 'missing-start' ? body + end
        : shape === 'missing-end' ? start + body
        : shape === 'nested-same' ? start + '\n' + block + '\n' + end
        : shape === 'inside-other' ? '# deck-codex-hook:personal:start\n' + block + '\n# deck-codex-hook:personal:end'
        : start + body + nested + end;
      const before = malformed + '\n\n[personal]\nkeep = true\n';
      writeFileSync(path, before);
      const receipt = readRunnerContributions(manifestPath)!;
      // For nested foreign markers, prove matching bytes alone are insufficient.
      if (shape === 'nested-other') receipt.contributions[0]!.hash = contributionHash(start + body + nested + end);
      writeFileSync(manifestPath, JSON.stringify(receipt));
      const manifestBefore = readFileSync(manifestPath, 'utf8');
      const plan = planPackageRetirement({ runnerId: 'codex', targets: [{ path, format: 'text', capability: hook === 'supermemory' ? 'supermemory' : 'deck-memory', selector }], dedicatedRoots: [], contributions: receipt.contributions });
      expect(plan.diagnostics.length).toBeGreaterThan(0);
      expect(plan.entries.every(entry => entry.action === 'preserve')).toBe(true);
      expect(applyPackageRetirement(plan, [], { manifestPath, backupRoot }).removed).toEqual([]);
      expect(readFileSync(path, 'utf8')).toBe(before);
      expect(readFileSync(manifestPath, 'utf8')).toBe(manifestBefore);
      expect(existsSync(backupRoot)).toBe(false);
    });
  }
}

for (const shape of ['crossing', 'contained', 'text-toml', 'text-toml-ambiguous'] as const) {
  test(`overlapping retirement selections preserve all receipts: ${shape}`, () => {
    // Protects sibling ownership: overlapping exact receipts do not authorize a union deletion.
    const root = mkdtempSync(join(tmpdir(), 'deck-retirement-overlap-'));
    const path = join(root, 'config.toml'), manifestPath = join(root, 'manifest.json'), backupRoot = join(root, 'backups');
    const outer = { kind: 'text' as const, start: '# outer-start', end: '# outer-end' };
    const inner = shape.startsWith('text-toml') ? { kind: 'toml' as const, header: 'mcp_servers.supermemory' }
      : { kind: 'text' as const, start: '# inner-start', end: '# inner-end' };
    const original = shape.startsWith('text-toml') ? '# outer-start\n[mcp_servers.supermemory]\ncommand = "owned"\n# outer-end\n' + (shape === 'text-toml-ambiguous' ? '# outer-end\n' : '')
      : shape === 'crossing' ? '# outer-start\n# inner-start\n# outer-end\n# inner-end\n'
      : '# outer-start\n# inner-start\n# inner-end\n# outer-end\n';
    const tx = beginRunnerContributions({ runnerId: 'codex', root, manifestPath, deckVersion: 'test', targets: [{ path, selector: outer }, { path, selector: inner }] });
    writeFileSync(path, original); tx.commit();
    const manifestBefore = readFileSync(manifestPath, 'utf8');
    const plan = planPackageRetirement({ runnerId: 'codex', targets: [
      { path, format: 'text', capability: 'deck-memory', selector: outer },
      inner.kind === 'text' ? { path, format: 'text', capability: 'supermemory', selector: inner } : { path, format: 'toml' },
    ], dedicatedRoots: [], contributions: readRunnerContributions(manifestPath)!.contributions });
    expect(plan.entries).toHaveLength(shape === 'text-toml-ambiguous' ? 1 : 2);
    expect(plan.entries.every(entry => entry.action === 'preserve')).toBe(true);
    expect(plan.diagnostics.length).toBeGreaterThan(0);
    // Even confirmations cannot turn structurally ambiguous selections into deletions.
    expect(applyPackageRetirement(plan, plan.entries, { manifestPath, backupRoot }).removed).toEqual([]);
    expect(readFileSync(path, 'utf8')).toBe(original);
    expect(readFileSync(manifestPath, 'utf8')).toBe(manifestBefore);
    expect(existsSync(backupRoot)).toBe(false);
  });
}

test('adjacent receipted retired hook blocks remove independently and preserve personal bytes', () => {
  // Protects valid cleanup: strict ambiguity rejection must still admit disjoint exact pairs.
  const root = mkdtempSync(join(tmpdir(), 'deck-retirement-adjacent-'));
  const path = join(root, 'config.toml'), manifestPath = join(root, 'manifest.json');
  const selectors = ['supermemory', 'memory-bridge'].map(id => ({ kind: 'text' as const, start: `# deck-codex-hook:${id}:start`, end: `# deck-codex-hook:${id}:end` }));
  const tx = beginRunnerContributions({ runnerId: 'codex', root, manifestPath, deckVersion: 'test', targets: selectors.map(selector => ({ path, selector })) });
  const personal = '\n[personal]\nkeep = true\n';
  writeFileSync(path, selectors.map(selector => selector.start + '\n# owned\n' + selector.end).join('') + personal); tx.commit();
  const plan = planPackageRetirement({ runnerId: 'codex', targets: selectors.map(selector => ({ path, format: 'text', capability: 'supermemory', selector })), dedicatedRoots: [], contributions: readRunnerContributions(manifestPath)!.contributions });
  expect(plan.entries).toHaveLength(2);
  expect(plan.entries.every(entry => entry.action === 'remove')).toBe(true);
  expect(applyPackageRetirement(plan, [], { manifestPath }).removed).toHaveLength(2);
  expect(readFileSync(path, 'utf8')).toBe(personal);
  expect(readRunnerContributions(manifestPath)!.contributions).toEqual([]);
});

for (const format of ['toml', 'text', 'file', 'json'] as const) {
  for (const evidence of ['matching', 'missing', 'edited', 'invalid', 'wrong-path', 'wrong-selector', 'wrong-encoding'] as const) {
    test(`exact ${format} retirement receipt boundary: ${evidence}`, () => {
      // Protects path/selector/hash ownership; oracle: journaled exact bytes, never familiar names.
      const root = mkdtempSync(join(tmpdir(), 'deck-retirement-selector-'));
      const path = join(root, format === 'toml' || format === 'text' ? 'config.toml' : 'config.json');
      const manifestPath = join(root, 'manifest.json');
      const block = '# deck-codex-hook:supermemory:start\n[hooks]\ncommand = "/fixture/owned"\n# deck-codex-hook:supermemory:end';
      const selector = format === 'text' ? { kind: 'text' as const, start: '# deck-codex-hook:supermemory:start', end: '# deck-codex-hook:supermemory:end' }
        : format === 'toml' ? { kind: 'toml' as const, header: 'mcp_servers.supermemory' }
        : format === 'json' ? { kind: 'json' as const, keys: ['mcpServers', 'supermemory'] } : { kind: 'file' as const };
      const original = format === 'text' ? block + '\n\n# personal section\n[personal]\nkeep = true\n'
        : format === 'toml' ? '[mcp_servers.supermemory]\ncommand = "/fixture/owned"\n\n# personal section\n[mcp_servers.personal]\ncommand = "keep"\n'
        : JSON.stringify({ mcpServers: { supermemory: { command: '/fixture/owned' }, personal: { command: 'keep' } } });
      const tx = beginRunnerContributions({ runnerId: 'codex', root, manifestPath, deckVersion: 'test', targets: [{ path, selector }] });
      writeFileSync(path, original); tx.commit();
      const contributions = readRunnerContributions(manifestPath)!.contributions;
      const record = contributions[0]!;
      if (evidence === 'edited') writeFileSync(path, original.replace('/fixture/owned', '/fixture/custom'));
      if (evidence === 'invalid') record.hash = 'invalid';
      if (evidence === 'wrong-encoding') record.encoding = format === 'json' ? 'bytes' : 'canonical-json-v1';
      if (evidence === 'wrong-path') record.path = join(root, 'other');
      if (evidence === 'wrong-selector') record.selector = { kind: 'file' };
      // Retain the claimed ID to ensure it cannot substitute for the actual path/selector.
      if (evidence === 'wrong-selector' && format === 'file') record.selector = { kind: 'json', keys: ['mcpServers'] };
      const before = readFileSync(path, 'utf8');
      const target = { path, format, capability: 'supermemory', container: ['mcpServers'], ...(format === 'text' ? { selector: selector as Extract<typeof selector, { kind: 'text' }> } : {}) };
      const plan = planPackageRetirement({ runnerId: 'codex', targets: [target], dedicatedRoots: [root], contributions: evidence === 'missing' ? [] : contributions });
      expect(plan.entries).toHaveLength(1);
      if (evidence === 'matching') {
        expect(plan.entries[0]!.action).toBe('remove');
        applyPackageRetirement(plan, [], { manifestPath });
        if (format === 'file') expect(existsSync(path)).toBe(false);
        else {
          expect(readFileSync(path, 'utf8')).toContain('personal');
          expect(readFileSync(path, 'utf8')).not.toContain('/fixture/owned');
        }
        expect(readRunnerContributions(manifestPath)!.contributions).toEqual([]);
      } else {
        expect(plan.entries[0]!.action).not.toBe('remove');
        applyPackageRetirement(plan, []);
        expect(readFileSync(path, 'utf8')).toBe(before);
      }
    });
  }
}
