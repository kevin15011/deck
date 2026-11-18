import {cp, mkdir, rm} from 'node:fs/promises';
// A fresh asset directory prevents an obsolete second UI from being embedded.
await rm('dist/assets', {recursive:true, force:true});
await mkdir('dist/assets', {recursive:true});
const result = await Bun.build({entrypoints:['frontend/src/app.tsx'], outdir:'dist/assets', naming:'app.[ext]', target:'browser', minify:true, external:['/fonts/*'], define:{'process.env.NODE_ENV':JSON.stringify('production')}});
if (!result.success) throw new AggregateError(result.logs, 'Browser build failed');
await cp('frontend/index.html', 'dist/assets/index.html');
await cp('frontend/public', 'dist/assets', {recursive:true});
