import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { installOwnedRtk, inspectOwnedRtk } from './rtk-artifact';
import { installOwnedCodebase, inspectOwnedCodebase } from './codebase-native-artifact';
import { acquireInstallationUse } from '../installation-use';
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function archive(name: string, binary: Buffer) {
  const members = name === 'rtk' ? [name] : [name, 'LICENSE', 'install.sh', 'THIRD_PARTY_NOTICES.md'];
  return gzipSync(Buffer.concat([...members.flatMap(member => {
    const data = member === name ? binary : Buffer.from('fixture');
    const header = Buffer.alloc(512); header.write(member); header.write(data.length.toString(8).padStart(11, '0'), 124); header[156] = 48;
    return [header, data, Buffer.alloc((512 - data.length % 512) % 512)];
  }), Buffer.alloc(1024)]));
}
for (const name of ['rtk', 'codebase-memory-mcp']) {
  const install = name === 'rtk' ? installOwnedRtk : installOwnedCodebase;
  const inspect = name === 'rtk' ? inspectOwnedRtk : inspectOwnedCodebase;
  // Protects canonical reacquisition and inert, bounded preimages; never authenticate modified bytes.
  test(`${name}: repairs edited native leaf only after verifying pinned acquisition`, async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'deck-native-repair-'))), root = join(home, 'release', 'platform');
    const binary = Buffer.from('canonical native fixture'), tar = archive(name, binary);
    const release = { asset: 'fixture', binaryBytes: binary.length, binarySha256: sha(binary), archiveBytes: tar.length, archiveSha256: sha(tar) };
    const original = '#!/bin/sh\ntouch NEVER_EXECUTE\n';
    mkdirSync(root, { recursive: true, mode: 0o700 }); writeFileSync(join(root, name), original, { mode: 0o700 });
    try {
      await expect(install(root, release, { fetchArchive: async () => Buffer.from('bad') })).rejects.toThrow();
      expect(readFileSync(join(root, name), 'utf8')).toBe(original);
      expect(await install(root, release, { fetchArchive: async () => tar })).toBe('installed');
      expect(inspect(root, release)).toBe('ready');
      expect(await install(root, release, { fetchArchive: async () => { throw Error('no second fetch'); } })).toBe('unchanged');
      const backups = readdirSync(join(dirname(root), '.replaced'));
      expect(backups.length).toBe(1);
      expect(readFileSync(join(dirname(root), '.replaced', backups[0]!), 'utf8')).toBe(original);
      expect(existsSync(join(home, 'NEVER_EXECUTE'))).toBe(false);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
  // Protects symlink/foreign-content refusal, and serialization with active readers.
  test(`${name}: preserves unsafe destination and active use`, async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'deck-native-guards-'))), root = join(home, 'release', 'platform');
    const binary = Buffer.from('canonical native fixture'), tar = archive(name, binary);
    const release = { asset: 'fixture', binaryBytes: binary.length, binarySha256: sha(binary), archiveBytes: tar.length, archiveSha256: sha(tar) };
    mkdirSync(root, { recursive: true, mode: 0o700 }); writeFileSync(join(root, name), 'edited', { mode: 0o700 });
    try {
      const held = acquireInstallationUse(dirname(root));
      try { await expect(install(root, release, { fetchArchive: async () => tar })).rejects.toThrow('deferred'); }
      finally { held.release(); }
      expect(readFileSync(join(root, name), 'utf8')).toBe('edited');
      writeFileSync(join(root, 'foreign'), 'preserve');
      await expect(install(root, release, { fetchArchive: async () => tar })).rejects.toThrow();
      expect(readFileSync(join(root, 'foreign'), 'utf8')).toBe('preserve');
      rmSync(join(root, 'foreign')); rmSync(join(root, name));
      writeFileSync(join(home, 'outside'), 'outside'); symlinkSync(join(home, 'outside'), join(root, name));
      await expect(install(root, release, { fetchArchive: async () => tar })).rejects.toThrow();
      expect(readFileSync(join(home, 'outside'), 'utf8')).toBe('outside');
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
}
