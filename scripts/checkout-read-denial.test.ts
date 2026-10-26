import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.skipIf(process.platform !== 'linux')('qualification denies checkout file reads in descendants while allowing fixture reads', () => {
  const output=mkdtempSync(join(tmpdir(),'deck-denial-control-'));
  try {
    const checkout=join(output,'checkout');mkdirSync(checkout);
    const secret=join(checkout,'source.ts'), fixture=join(output,'fixture');
    writeFileSync(secret,'checkout marker');writeFileSync(fixture,'fixture marker');
    const prefix=['python3',join(import.meta.dir,'checkout-read-denial.py'),checkout];
    expect(Bun.spawnSync(['/bin/cat',secret]).stdout.toString()).toBe('checkout marker');
    const denied=Bun.spawnSync([...prefix,'/bin/sh','-c','exec /bin/cat "$1"','control',secret],{cwd:output});
    expect(denied.exitCode).not.toBe(0);
    expect(denied.stderr.toString()).toMatch(/Permission denied|Operation not permitted/);
    const allowed=Bun.spawnSync([...prefix,'/bin/cat',fixture],{cwd:output});
    expect(allowed.exitCode).toBe(0);expect(allowed.stdout.toString()).toBe('fixture marker');
  } finally {rmSync(output,{recursive:true,force:true});}
});

test('native qualification rejects foreign architecture before source or artifact effects', () => {
  const result=Bun.spawnSync([process.execPath,join(import.meta.dir,'verify-git-diff-runtime.ts'),'--target',process.arch==='x64'?'linux-arm64':'linux-x64','--artifact','/does-not-exist']);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain('Native target mismatch');
});
