import {cp, mkdir, rm} from 'node:fs/promises';
// A fresh asset directory prevents an obsolete second UI from being embedded.
await rm('dist/assets', {recursive:true, force:true});
await mkdir('dist/assets', {recursive:true});
const result = await Bun.build({entrypoints:['frontend/src/app.tsx'], outdir:'dist/assets', naming:'app.[ext]', target:'browser', minify:true, external:['/fonts/*'], define:{'process.env.NODE_ENV':JSON.stringify('production')}});
if (!result.success) throw new AggregateError(result.logs, 'Browser build failed');
await cp('frontend/index.html', 'dist/assets/index.html');
await cp('frontend/public', 'dist/assets', {recursive:true});

// Keep the SDK bridge out of the public browser asset directory. Rust embeds
// the bundle, and the bridge explicitly uses the host's installed Claude CLI.
const bridge = await Bun.build({
    entrypoints: ['crates/host/bridge/claude.ts'],
    outdir: 'dist',
    naming: 'claude-sdk.mjs',
    target: 'node',
    minify: true,
});
if (!bridge.success) throw new AggregateError(bridge.logs, 'Claude SDK bridge build failed');
