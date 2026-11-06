import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createOpenCodeRtkTools } from './rtk-tools';
import { installOpenCodeTools } from './install-tools';
import { OPENCODE_INSTALLABLE_TOOLS } from './installation-plan';
import { acquireInstallationUse } from '../../core/src/installation-use';
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
function fixture(archiveTransform: (archive: Buffer) => Uint8Array = archive => archive) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'opencode-rtk-managed-')));
  const binary = Buffer.from('pinned fixture; never execute');
  const header = Buffer.alloc(512); header.write('rtk'); header.write(binary.length.toString(8).padStart(11, '0'), 124); header[156] = 48;
  const archive = gzipSync(Buffer.concat([header, binary, Buffer.alloc(512 - binary.length), Buffer.alloc(1024)]));
  let fetches = 0;
  const tools = createOpenCodeRtkTools({ homeDirectory: home, environment: { HOME: home }, dataRoot: join(home, 'deck'),
    release: { asset: 'fixture', binaryBytes: binary.length, binarySha256: hash(binary), archiveBytes: archive.length, archiveSha256: hash(archive) },
    artifactEffects: { fetchArchive: async () => { fetches++; return archiveTransform(archive); } } });
  const invoke = () => installOpenCodeTools('opencode', [OPENCODE_INSTALLABLE_TOOLS.find(t => t.id === 'rtk')!], () => {},
    async () => { throw new Error('Unpinned installer must not run'); }, { homeDirectory: home, rtkTools: tools });
  return { home, tools, invoke, binary, fetches: () => fetches };
}
// Oracle: accepted managed authority requires verified acquisition before receipts, without executing old bytes.
test('public RTK install repairs pinned native and recorded plugin drift; second install is stable', async () => {
  const f = fixture();
  try {
    expect((await f.invoke())[0]?.success).toBe(true);
    const plugin = join(f.tools.configRoot, 'plugins/rtk.ts'), canonical = readFileSync(plugin, 'utf8');
    writeFileSync(plugin, 'edited plugin'); writeFileSync(join(f.tools.root, 'rtk'), 'edited binary');
    expect((await f.invoke())[0]?.success).toBe(true);
    expect(readFileSync(join(f.tools.root, 'rtk'))).toEqual(f.binary);
    expect(readFileSync(plugin, 'utf8')).toBe(canonical);
    expect(readdirSync(join(dirname(f.tools.root), '.replaced'))).toHaveLength(1);
    const receipt = readFileSync(join(f.tools.configRoot, 'deck/manifest.json'), 'utf8');
    expect((await f.invoke())[0]?.outcome).toBe('already-present');
    expect(f.fetches()).toBe(2);
    expect(readFileSync(join(f.tools.configRoot, 'deck/manifest.json'), 'utf8')).toBe(receipt);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});
// Oracle: generic names alone cannot authorize replacement; active invocations retain their generation.
test('public RTK install preserves ambiguous plugin collisions and active installations', async () => {
  const f = fixture();
  try {
    const plugin = join(f.tools.configRoot, 'plugins/rtk.ts'); mkdirSync(dirname(plugin), {recursive: true}); writeFileSync(plugin, 'foreign plugin');
    expect((await f.invoke())[0]?.success).toBe(false);
    expect(readFileSync(plugin, 'utf8')).toBe('foreign plugin'); expect(f.fetches()).toBe(0);
    rmSync(plugin);
    const held = acquireInstallationUse(f.tools.configRoot);
    try { expect((await f.invoke())[0]?.success).toBe(false); expect(f.fetches()).toBe(0); }
    finally { held.release(); }
    expect((await f.invoke())[0]?.success).toBe(true);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

// Protects migration from the official upstream PATH-based plugin, with no old code
// execution. Exact source identity permits replacement only after verified acquisition.
test('public RTK install migrates official legacy plugin and preserves edited variants', async () => {
  const f = fixture();
  const legacy = (await import('./fixtures/legacy-opencode-content.json')).default['plugins/rtk.ts'];
  try {
    const path = join(f.tools.configRoot, 'plugins/rtk.ts'); mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, legacy + '\n// custom change');
    expect((await f.invoke())[0]?.success).toBe(false);
    expect(f.fetches()).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe(legacy + '\n// custom change');
    writeFileSync(path, legacy);
    expect((await f.invoke())[0]?.success).toBe(true);
    expect(f.fetches()).toBe(1);
    expect(readFileSync(path, 'utf8')).not.toBe(legacy);
    expect(f.tools.ready()).toBe(true);
    expect((await f.invoke())[0]?.outcome).toBe('already-present');
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

// Protects acquisition-before-mutation: known legacy content is not an integrity bypass.
test('public legacy RTK migration preserves preimage and receipts on corrupt acquisition', async () => {
  const f = fixture(() => Buffer.from('corrupt archive'));
  const legacy = (await import('./fixtures/legacy-opencode-content.json')).default['plugins/rtk.ts'];
  try {
    const path = join(f.tools.configRoot, 'plugins/rtk.ts'); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, legacy);
    expect((await f.invoke())[0]?.success).toBe(false);
    expect(f.fetches()).toBe(1);
    expect(readFileSync(path, 'utf8')).toBe(legacy);
    expect(f.tools.state()).toBe('absent');
    expect(require('node:fs').existsSync(join(f.tools.configRoot, 'deck/manifest.json'))).toBe(false);
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});
