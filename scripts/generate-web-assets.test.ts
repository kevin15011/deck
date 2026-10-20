import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WEB_ASSETS, WEB_ASSETS_DIGEST } from '../apps/cli/src/runtime/web-assets.generated';
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
    expect(Object.keys(a).sort()).toEqual(['/app.css', '/app.js', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/icon.svg', '/index.html', '/manifest.webmanifest', '/service-worker.js']);
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

// Use the production generator subprocess: Bun 1.3.12 in-process builds under bun test
// fail React resolution and contaminate subsequent JSX imports. Digest parity stays exact.
test('packaged browser assets match the canonical production build',async()=>{
 expect(computeWebDigest(WEB_ASSETS)).toBe(WEB_ASSETS_DIGEST);
 expect(computeWebDigest(await temporaryAssets())).toBe(WEB_ASSETS_DIGEST);
});

test('install manifest includes canonical raster launcher and Apple touch icons with actual dimensions',async()=>{
 const assets=await temporaryAssets(),manifest=JSON.parse(String(assets['/manifest.webmanifest']!.body));
 expect(manifest.start_url).toBe('/');expect(manifest.scope).toBe('/');expect(manifest.display).toBe('standalone');
 for(const size of [192,512]){expect(manifest.icons).toContainEqual({src:`/icon-${size}.png`,sizes:`${size}x${size}`,type:'image/png',purpose:'any'});const bytes=assets[`/icon-${size}.png`]?.body;expect(bytes).toBeInstanceOf(Uint8Array);const buffer=Buffer.from(bytes as Uint8Array);expect(buffer.readUInt32BE(16)).toBe(size);expect(buffer.readUInt32BE(20)).toBe(size);}
 expect(String(assets['/index.html']!.body)).toContain('href="/apple-touch-icon.png"');
});
