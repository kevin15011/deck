/** Isolated P-008 probes: real Deck driver/parser, synthetic child, no inference or user-state writes.
 * Run: bun run openspec/changes/session-context-latency-investigation/reproduce.ts
 * These characterize current behavior; a verified fix must update the expectations.
 */
import assert from 'node:assert/strict';
import type { DriverTaskInput } from '../../../packages/core/src/session/driver';
import { createCodexSessionDriver } from '../../../packages/adapter-codex/src/session-driver/driver';
import { harness } from '../../../packages/adapter-codex/src/session-driver/test-support';
import { ISOLATION_FEATURES } from '../../../packages/adapter-codex/src/session-driver/launch';

const input: DriverTaskInput = {
  taskId: 'task', memberId: 'lead', cwd: '/work',
  assignment: { runnerId: 'codex', modelId: 'openai-codex/gpt-5', thinking: 'high' },
  rolePrompt: 'Synthetic role', prompt: 'Synthetic instruction',
  mcp: { servers: ['deck'], sessionTools: [] },
  mcpServerSpecs: { deck: { command: '/deck', args: ['internal', 'session-mcp'], env: { DECK_SESSION_CREDENTIAL_FILE: '/private/credential' } } },
  approvals: 'relay', credentialFile: '/private/credential', disableNativeDelegation: true,
  resume: { nativeSessionId: 'saved' }, steeringVersion: '0.162.1',
};
const results: unknown[] = [];
for (const scenario of ['bounded-resume', 'oversized-steering-history', 'oversized-tool-output', 'startup-timeout'] as const) {
  let historyBytes = 0;
  const h = harness((child, _index, message) => {
    const params = message.params as Record<string, unknown>;
    const reply = (result: unknown) => child.stdout({ id: message.id, result });
    switch (message.method) {
      case 'initialize': reply({}); break;
      case 'config/read':
        if (scenario !== 'startup-timeout') reply({ config: {
          features: Object.fromEntries(ISOLATION_FEATURES.map(feature => [feature, false])), mcp_servers: {},
        } });
        break;
      case 'thread/resume':
        reply({ thread: { id: 'saved', historyMode: 'legacy', turns: params.excludeTurns ? [] : [{ text: 'x'.repeat(1_050_693) }] } });
        break;
      case 'mcpServerStatus/list':
        reply({ data: [{ name: 'deck-session-task-deck', runtimeStatus: 'connected' }], nextCursor: null });
        break;
      case 'turn/start': reply({ turn: { id: 'turn' } }); break;
      case 'thread/read': {
        assert.equal(params.includeTurns, true);
        const frame = { id: message.id, result: { thread: { id: 'saved', turns: [{ id: 'old-turn', items: [{ type: 'agentMessage', text: 'x'.repeat(1_050_693) }] }] } } };
        historyBytes = Buffer.byteLength(JSON.stringify(frame), 'utf8');
        child.stdout(frame);
        break;
      }
    }
  });
  const handle = await createCodexSessionDriver({ rpcTimeoutMs: 100 }).startTask(input, h.io);
  try {
    if (scenario === 'startup-timeout') {
      const outcome = await handle.done;
      assert.equal(outcome.error, 'codex-startup-failed');
      results.push({ scenario, outcome, unansweredMethod: 'config/read', diagnosticCodes: h.events.filter(e => e.kind === 'diagnostic').map(e => e.data.code) });
      continue;
    }
    await handle.nativeSessionId;
    // Await the already-resolved fake turn/start acknowledgement.
    await Promise.resolve();
    const child = h.children.at(-1)!;
    assert.equal((child.writes.find(m => m.method === 'thread/resume')!.params as Record<string, unknown>).excludeTurns, true);
    if (scenario === 'oversized-steering-history') {
      const target = handle.steeringTarget!();
      assert.ok(target);
      const reconciliation = await handle.reconcileSteering!({ ...target, clientUserMessageId: 'synthetic-input', text: 'Synthetic message' });
      const outcome = await handle.done;
      assert.equal(reconciliation.state, 'unknown');
      assert.equal(outcome.error, 'codex-rpc-frame-too-large');
      assert.equal(child.terminations, 1);
      results.push({ scenario, historyBytes, maxFrameBytes: 1_048_576, reconciliation: reconciliation.state, outcome, childTerminations: child.terminations });
    } else if (scenario === 'oversized-tool-output') {
      const frame = { method: 'item/completed', params: { threadId: 'saved', turnId: 'turn', item: {
        type: 'commandExecution', id: 'synthetic-command', status: 'completed', exitCode: 0,
        aggregatedOutput: 'x'.repeat(1_050_693),
      } } };
      child.stdout(frame);
      const outcome = await handle.done;
      assert.equal(outcome.error, 'codex-rpc-frame-too-large');
      assert.equal(h.events.filter(e => e.kind === 'tool.completed').length, 0);
      results.push({ scenario, frameBytes: Buffer.byteLength(JSON.stringify(frame), 'utf8'), outcome, mappedToolCompletions: 0 });
    } else {
      child.stdout({ method: 'turn/completed', params: { threadId: 'saved', turn: { id: 'turn', status: 'completed' } } });
      const outcome = await handle.done;
      assert.equal(outcome.status, 'completed');
      results.push({ scenario, outcome, excludedResumeTurns: true });
    }
  } finally { await handle.close(); }
}
console.log(JSON.stringify({ kind: 'synthetic-driver-characterization', results }, null, 2));
