/** Offline provenance builder. Only immutable repository snapshots are inputs;
 * installed files never establish ownership. Run explicitly when supporting another
 * pre-receipt renderer. The runtime uses hashes, never historical executable code. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertCanonicalBunRuntime } from './generate-runner-execution-assets';
import type { CapabilityInstructionBundle } from '../packages/core/src/teams/developer/instruction-bundles';

assertCanonicalBunRuntime(new URL('..', import.meta.url).pathname);

// Web Search has no standalone external-skill fragments in these snapshots.
const snapshots = [
  { commit: '239e95e805c2bf1e24d71aa883b9e1b78bf3281a', packages: ['codebase-memory', 'context-mode', 'rtk', 'adaptive-memory', 'serena'] },
  { commit: '47ec17b3383d5d209131ee5e573a3282b6c834da', packages: ['codebase-memory', 'code-economy', 'rtk'] },
  { commit: '333cdeb09763f9f0d6027c0593de043687bb0330', packages: ['codebase-memory', 'context-mode', 'rtk'] },
];
const marker = '\n\n## Package Instructions (configured)\n';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const read = (commit: string, path: string) => execFileSync('git', ['show', `${commit}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const internalBodies: Record<string, string> = {};
const records: { commit: string; bodies: Record<string, { raw: string; composed: string }>; suffixes: string[] }[] = [];
const temporary = mkdtempSync(join(tmpdir(), 'deck-legacy-renderer-'));
try {
  for (const [index, snapshot] of snapshots.entries()) {
    const prefix = 'packages/core/src/teams/developer/instruction-bundles/';
    const indexSource = read(snapshot.commit, `${prefix}index.ts`);
    const start = indexSource.indexOf('export function composeCapabilityInstructions(');
    if (start < 0) throw new Error('Historical renderer is unavailable');
    const end = indexSource.indexOf('/**', start);
    const rendererPath = join(temporary, `${index}-renderer.ts`);
    writeFileSync(rendererPath, indexSource.slice(start, end < 0 ? undefined : end));
    const { composeCapabilityInstructions } = await import(rendererPath);
    const fragments = [];
    for (const name of snapshot.packages) {
      const path = join(temporary, `${index}-${name}.ts`);
      writeFileSync(path, read(snapshot.commit, `${prefix}${name}.ts`));
      const module = await import(path);
      const build = Object.values(module).find(value => typeof value === 'function') as () => CapabilityInstructionBundle;
      fragments.push(build().instructions);
    }
    let translate: (bundle: CapabilityInstructionBundle) => CapabilityInstructionBundle = bundle => bundle;
    let adapterSource: string | undefined;
    try { adapterSource = read(snapshot.commit, 'packages/adapter-opencode/src/instruction-translation.ts'); }
    catch { /* This snapshot predates runner translation. */ }
    if (adapterSource !== undefined) {
      const engine = join(temporary, `${index}-translation.ts`);
      writeFileSync(engine, read(snapshot.commit, `${prefix}runner-translation.ts`));
      const adapter = adapterSource.replace('@deck/core/teams/developer/instruction-bundles/runner-translation', engine);
      const path = join(temporary, `${index}-adapter.ts`); writeFileSync(path, adapter);
      translate = (await import(path)).translateOpenCodeCapabilityInstructions;
    }
    const bodies: Record<string, { raw: string; composed: string }> = {};
    const suffixes = new Set<string>();
    const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', snapshot.commit, 'packages/core/src/skills/external'], { encoding: 'utf8' }).split('\n').filter(path => /^packages\/core\/src\/skills\/external\/[^/]+\/SKILL\.md$/.test(path));
    const sources = paths.map(path => ({ body: read(snapshot.commit, path), id: path.split('/').at(-2)! }));
    const bootstrapPaths = execFileSync('git', ['ls-tree', '-r', '--name-only', snapshot.commit, 'packages/core/src/skills/bootstrap'], { encoding: 'utf8' }).split('\n').filter(path => /-content\.ts$/.test(path));
    for (const [bit, path] of bootstrapPaths.entries()) {
      const modulePath = join(temporary, `${index}-bootstrap-${bit}.ts`);
      let source = read(snapshot.commit, path);
      if (source.includes('../../teams/developer/readiness-authority')) {
        const authority = join(temporary, `${index}-authority.ts`);
        writeFileSync(authority, read(snapshot.commit, 'packages/core/src/teams/developer/readiness-authority.ts'));
        source = source.replace('../../teams/developer/readiness-authority', authority);
      }
      writeFileSync(modulePath, source);
      for (const body of Object.values(await import(modulePath))) {
        if (typeof body !== 'string') continue;
        const id = /^name: (.+)$/m.exec(body)?.[1];
        if (!id) continue; // Other exported prompt constants are not installable skills.
        sources.push({ body, id }); internalBodies[`skills/${id}/SKILL.md`] = body;
      }
    }
    for (const {body, id} of sources) {
      bodies[`skills/${id}/SKILL.md`] = { raw: sha(body), composed: sha(body.trimEnd()) };
      for (let mask = 1; mask < 1 << fragments.length; mask++) {
        const bundle = { instructions: fragments.flatMap((items, bit) => mask & 1 << bit ? items : []) };
        for (const variant of [bundle, translate(bundle)]) {
          const rendered = composeCapabilityInstructions(body, variant, { surface: 'skill', teamId: 'developer-team', skillId: id });
          const start = rendered.indexOf(marker);
          if (start >= 0) suffixes.add(sha(rendered.slice(start)));
        }
      }
    }
    records.push({ commit: snapshot.commit, bodies, suffixes: [...suffixes].sort() });
  }
  writeFileSync(new URL('../packages/adapter-opencode/src/fixtures/legacy-internal-bodies.json', import.meta.url), JSON.stringify(internalBodies, null, 2) + '\n');
  writeFileSync(new URL('../packages/adapter-opencode/src/fixtures/legacy-recognition.json', import.meta.url), JSON.stringify({ marker, records }, null, 2) + '\n');
} finally { rmSync(temporary, { recursive: true, force: true }); }
