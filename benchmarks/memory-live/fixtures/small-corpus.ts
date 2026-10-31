// Synthetic boundary-test corpus; never imported by evaluator entrypoints.
import { spyOn } from 'bun:test';
import * as data from '../dataset';
import { sha256 } from '../security';
export function smallCorpus(questionsPerProject = 1) {
    const full = data.dataset();
    // Keep old/current revisions, all project namespaces and real role/scoring paths.
    const questions = ['A', 'B'].flatMap(project => full.questions.filter(q => q.project_under_query === project && !data.isFuture(q)).slice(0, questionsPerProject));
    const ids = new Set(questions.flatMap(q => (q.seed_documents ?? []).map((s: { seed_id: string }) => s.seed_id)));
    const privateSeed = full.seeds.find(s => s.project === 'B-private')!;
    ids.add(privateSeed.id);
    const seeds = full.seeds.filter(s => ids.has(s.id));
    const poolSeeds = full.poolSeeds;
    const fixture = { seeds, questions, poolSeeds, hash: sha256(JSON.stringify({ seeds, questions, poolSeeds })) };
    return spyOn(data, 'dataset').mockImplementation(() => structuredClone(fixture));
}
