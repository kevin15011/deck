import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { evalRoot, secureDir, privateWrite, fail } from './security';
const args = process.argv.slice(2);
const i = args.indexOf('--manifest');
if (i < 0)
    fail('explicit_manifest_required');
const m = JSON.parse(readFileSync(args[i + 1]!, 'utf8'));
const root = evalRoot(m.evalRoot, m.run);
const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'run.ts'), join(import.meta.dir, 'cleanup.ts')], target: 'bun', packages: 'external' });
if (!built.success)
    fail('harness_build_failed');
const dir = secureDir(join(root, 'build'));
for (const output of built.outputs)
    privateWrite(join(dir, output.path.split('/').at(-1)!), await output.text());
console.log(JSON.stringify({ status: 'built', entrypoints: 2, networkRequests: 0 }));
