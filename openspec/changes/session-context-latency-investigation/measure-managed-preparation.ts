/** Isolated production tool preparation, no native model process or inference.
 * Runs only local Codebase initialize/tools-list checks in an owned temporary runtime;
 * releases bindings and shuts down its own supervised processes in finally.
 * Memory and web search are disabled explicitly for this bounded comparison.
 */
import { resolve } from 'node:path';
import { getDefaultDeckConfig } from '../../../packages/core/src/config/deck-config';
import { Supervisor } from '../../../packages/session-host/src/supervisor';
import { createDefaultAdapterRegistry } from '../../../apps/cli/src/runner-adapters';
import { SessionCodebaseReadiness } from '../../../apps/cli/src/session-codebase-readiness';
import { resolveSessionChildMcp } from '../../../apps/cli/src/session-shared-services';

const registry = createDefaultAdapterRegistry();
const config = getDefaultDeckConfig();
config.adaptiveMemory.enabled = false; config.webSearch.enabled = false;
const results = [];
for (const runnerId of ['claude', 'codex']) {
  const supervisor = new Supervisor({ anchorCommand: [process.execPath, resolve('apps/cli/src/main.tsx'), 'internal', 'child-anchor'] });
  const readiness = new SessionCodebaseReadiness({ supervisor });
  try {
    for (let sample = 0; sample < 3; sample++) {
      const start = performance.now(), steps: Array<{ step: string; durationMs: number }> = [];
      let step: string | undefined, boundary = start;
      const mark = (next?: string) => {
        const now = performance.now();
        if (step) steps.push({ step, durationMs: Math.round((now - boundary) * 1000) / 1000 });
        boundary = now; step = next;
      };
      let status = 'failed', capabilityStatus: string | undefined;
      try {
        const resolver = await resolveSessionChildMcp(registry.get(runnerId), config, process.env, {
          readiness, context: { projectRoot: process.cwd(), sessionId: 'measurement', taskId: 'measurement',
            signal: AbortSignal.timeout(20_000), preparationStep: mark },
        });
        mark();
        capabilityStatus = resolver.capabilityAvailability?.find(c => c.capabilityId === 'codebase-memory')?.status;
        await resolver.release?.(); status = 'completed';
      } catch { mark(); }
      results.push({ runnerId, sample, status, capabilityStatus, durationMs: Math.round((performance.now() - start) * 1000) / 1000, steps });
    }
  } finally { try { await readiness.close(); } finally { await supervisor.shutdown(); } }
}
console.log(JSON.stringify({ kind: 'isolated-managed-tool-preparation', runtime: Bun.version, results,
  limitations: ['Separate readiness service per runner, three sequential samples; local installed selection and OS cache.',
    'Memory and web search disabled; no model, native CLI initialization, browser or concurrent user workload.',
    'Uses source-checkout composition, not the already-running daemon; no deployment or native-context changes.'] }, null, 2));
