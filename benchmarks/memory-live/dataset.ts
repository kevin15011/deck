import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256, fail } from './security';
import type { Seed } from './capture-replay/runtime';
import type { Question } from './score';
export const dataRoot = resolve(import.meta.dir, 'dataset');
export function dataset() {
    const read = (name: string) => readFileSync(resolve(dataRoot, name), 'utf8').trim().split('\n').map(s => JSON.parse(s));
    const seeds = read('seeds.jsonl') as Seed[];
    const questions = read('questions.jsonl') as Question[];
    if (seeds.length !== 61 || questions.length !== 50 || new Set(seeds.map(s => s.id)).size !== 61 || new Set(questions.map(q => q.id)).size !== 50)
        fail('dataset_cardinality_invalid');
    for (const q of questions) {
        for (const s of q.seed_documents ?? [])
            if (!seeds.some(x => x.id === s.seed_id))
                fail('dataset_seed_reference_missing');
        for (const f of [...q.expected_facts, ...q.forbidden_facts])
            for (const p of f.match.all_of_regex)
                new RegExp(p, f.match.flags ?? 'i');
    }
    const poolFile = readFileSync(resolve(import.meta.dir, 'fixtures/pool-controls.json'), 'utf8');
    const poolSeeds = JSON.parse(poolFile).seeds as Seed[];
    if (poolSeeds.length !== 3 || poolSeeds.some(s => s.project !== 'B'))
        fail('pool_controls_invalid');
    const hash = sha256(poolFile + "\n" + ['questions.jsonl', 'seeds.jsonl', 'manifest.json', 'validation.json', 'import.json'].map(n => readFileSync(resolve(dataRoot, n), 'utf8')).join('\n'));
    return { seeds, questions, hash, poolSeeds };
}
export function isFuture(q: Question) { return q.feature_status?.startsWith('future_') ?? false; }
export function shuffle<T>(items: T[], seed: number): T[] {
    let state = seed | 0;
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        const j = (state >>> 0) % (i + 1);
        [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
}
export function orderedSeeds(seeds: Seed[], prng = 11) { return [...shuffle(seeds.filter(s => s.temporal_phase === 'old'), prng), ...shuffle(seeds.filter(s => s.temporal_phase !== 'old'), prng + 1)]; }
