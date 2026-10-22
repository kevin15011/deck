/** Read-only production adapter inventory timing. No startTask, inference, install, or config writes.
 * Run from the repository root: bun run openspec/changes/session-context-latency-investigation/measure-native-config.ts
 * Reports no paths, server specs, credentials or raw errors. Local selected tooling may differ by runner.
 */
import { createDefaultAdapterRegistry } from '../../../apps/cli/src/runner-adapters';

const started = performance.now();
const registry = createDefaultAdapterRegistry();
const registryMs = performance.now() - started;
const results = [];
for (const runnerId of ['claude', 'codex']) {
  const adapter = registry.get(runnerId);
  const samples = [];
  for (let sample = 0; sample < 3; sample++) {
    const start = performance.now();
    try {
      const specs = await adapter.readSessionMcpServers?.();
      samples.push({ durationMs: Math.round((performance.now() - start) * 1000) / 1000, status: 'ok', serverCount: Object.keys(specs ?? {}).length });
    } catch {
      samples.push({ durationMs: Math.round((performance.now() - start) * 1000) / 1000, status: 'failed' });
    }
  }
  results.push({ runnerId, samples });
}
console.log(JSON.stringify({ kind: 'local-read-only-native-config', runtime: Bun.version, registryMs, results,
  limitations: ['Three sequential observations per runner; not matched native model workloads.',
    'Only adapter inventory is measured, excluding managed readiness, native process initialization and model work.',
    'Source checkout and currently installed selection; not the already-running daemon build.'] }, null, 2));
