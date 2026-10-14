import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeWebDigest } from './generate-web-assets';
async function generate(path: string) {
    const child = Bun.spawn([process.execPath, 'run', join(import.meta.dir, 'generate-web-assets.ts'), path], { stdout: 'pipe', stderr: 'pipe' });
    const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    if (exit !== 0)
        throw new Error(stderr);
}
async function temporaryAssets() { const dir = await mkdtemp(join(tmpdir(), 'deck-web-build-')); const path = join(dir, 'assets.ts'); await generate(path); const module = await import(path); await rm(dir, { recursive: true, force: true }); return module.WEB_ASSETS; }
test('browser production assets are local and have no inline scripts', async () => {
    const a = await temporaryAssets();
    expect(Object.keys(a).sort()).toEqual(['/app.css', '/app.js', '/index.html']);
    expect(a['/index.html']!.body).not.toMatch(/https?:|<script[^>]*>[^<]+/);
    expect(a['/app.js']!.body).not.toContain('Proyects/deck');
    expect(computeWebDigest({ ...a, '/app.js': { ...a['/app.js']!, body: 'tampered' } })).not.toBe(computeWebDigest(a));
});
test('generation is deterministic and preserves file when unchanged', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deck-web-assets-'));
    try {
        const path = join(dir, 'assets.ts');
        await generate(path);
        const text = await readFile(path, 'utf8'), before = (await stat(path)).mtimeMs;
        await generate(path);
        expect(await readFile(path, 'utf8')).toBe(text);
        expect((await stat(path)).mtimeMs).toBe(before);
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
