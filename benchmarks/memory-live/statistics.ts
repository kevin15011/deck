function moments(values: number[]) { const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; return { n: values.length, mean, sd: values.length > 1 ? Math.sqrt(values.reduce((n, v) => n + (v - mean!) ** 2, 0) / (values.length - 1)) : null }; }
/** Cluster by question so repeats of one question are never independent samples. */
export function baselineStatistics(results: any[]) {
    const suites = results.filter(r => r.track === 'R' || r.track === 'N');
    return [...new Set(suites.map(r => `${r.track}:${r.route ?? 'runtime'}`))].map(route => {
        const selected = suites.filter(r => `${r.track}:${r.route ?? 'runtime'}` === route);
        const rows = selected.flatMap(r => (r.cases ?? []).filter((c: any) => c.status === 'scored'));
        const series = (key: string) => selected.map(r => { const values = (r.cases ?? []).filter((c: any) => c.status === 'scored').map((c: any) => c.final[key]).filter((x: any) => typeof x === 'number'); return values.length ? values.reduce((a: number, b: number) => a + b, 0) / values.length : null; }).filter((x): x is number => x !== null);
        const ids = [...new Set(rows.map(c => c.id))];
        const interval = (key: string) => {
            if (selected.length < 2 || !ids.length)
                return null;
            const samples: number[] = [];
            let state = 71;
            for (let b = 0; b < 500; b++) {
                const values: number[] = [];
                for (let i = 0; i < ids.length; i++) {
                    state ^= state << 13;
                    state ^= state >>> 17;
                    state ^= state << 5;
                    const id = ids[(state >>> 0) % ids.length];
                    values.push(...rows.filter(c => c.id === id).map(c => c.final[key]).filter((x): x is number => typeof x === 'number'));
                }
                if (values.length)
                    samples.push(values.reduce((a, b) => a + b, 0) / values.length);
            }
            samples.sort((a, b) => a - b);
            return samples.length ? { lower: samples[Math.floor(samples.length * .025)], upper: samples[Math.ceil(samples.length * .975) - 1], resamples: 500, cluster: 'question', seed: 71 } : null;
        };
        return { route, repeats: selected.length, precision: moments(series('precisionAtK')), recall: moments(series('recallAtK')), precision95: interval('precisionAtK'), recall95: interval('recallAtK'), comparison: 'Baseline only; paired candidate differences require a second frozen candidate.' };
    });
}
