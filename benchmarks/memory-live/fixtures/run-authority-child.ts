// Executed only by isolated tests with a synthetic HOME, never a live entrypoint.
import { readFileSync } from 'node:fs';
import { cleanup } from '../cleanup';
import { execute } from '../run';
import { simulatedWire } from '../namespace-transport';
const m = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const evaluation = process.argv[3] === 'evaluation', fake = simulatedWire();
let held = false;
const wire = async (u: URL, i: RequestInit) => {
    if (!held && (!evaluation || u.pathname === '/v3/documents')) {
        held = true; console.log('effect_reserved'); await Bun.stdin.stream().getReader().read();
    }
    return evaluation ? fake(u, i) : Response.json({}, { status: i.method === 'DELETE' ? 503 : 200 });
};
if (evaluation) await execute(m, { wire });
else await cleanup(m, { estimatedCleanupCeilingUsd: .0004, wire });
