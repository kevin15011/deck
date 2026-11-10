import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { getDefaultDeckConfig } from '@deck/core/config/deck-config';
import type { SessionCommand } from '@deck/core/session/commands';
import { EventLog, type EventDraft } from '../event-log';
import { Ledger, loadLedger, saveLedgerSnapshot } from '../ledger';
import { recoverSession } from '../recovery';
import type { ProcessProbe } from '../process-probe';
import { SessionManager } from '../session-manager';
import { ApprovalBroker } from '../approval-broker';
import { CredentialRegistry } from '../credentials';
import { ensureStateLayout, resolveStatePaths } from '../paths';
import type { Supervisor } from '../supervisor';
import { FakeDriver } from '../testing/fake-driver';
import { cleanupTempDirs, tempDir, waitFor } from './test-helpers';
afterEach(cleanupTempDirs);

function history(acknowledged = true): EventDraft[] {
  return [
    { kind: 'task.created', data: { taskId: 'old-lead', memberId: 'lead', runnerId: 'codex', modelId: 'fixture' } },
    { kind: 'task.state', data: { taskId: 'old-lead', state: 'running' } },
    { kind: 'prompt.queued', data: { promptId: 'old', text: 'old', textHash: 'old', by: 'user' } },
    { kind: 'prompt.dispatched', data: { promptId: 'old', taskId: 'old-lead', attempt: 1 } },
    { kind: 'task.state', data: { taskId: 'old-lead', state: 'interrupted' } },
    { kind: 'prompt.state', data: { promptId: 'old', state: 'interrupted' } },
    { kind: 'prompt.queue', data: { paused: true, reason: 'interrupted' } },
    ...(acknowledged ? [{ kind: 'prompt.queue' as const, data: { paused: false, commandId: 'acknowledge' } }] : []),
    { kind: 'prompt.queue', data: { paused: true, reason: 'daemon-restart' } },
  ];
}

// Protects recovery authority: only acknowledged terminal history can be repaired;
// queued input, uncertain delivery, ownership and later failures still need action.
test('repair respects acknowledgement order and all unresolved prompt boundaries', () => {
  for (const blocked of ['none', 'unacknowledged', 'queued', 'unknown', 'steering', 'dispatched', 'accepted', 'ownership-unsettled', 'late-failure', 'unknown-handoff']) {
    const log = EventLog.open({ dir: join(tempDir(), 'events'), sessionId: 'repair' });
    try {
      const ledger = Ledger.empty('repair');
      const drafts = history(blocked !== 'unacknowledged');
      if (blocked === 'late-failure') drafts.push({ kind: 'prompt.state', data: { promptId: 'old', state: 'failed' } });
      for (const e of log.appendMany(drafts)) ledger.apply(e);
      if (!['none', 'unacknowledged', 'late-failure'].includes(blocked)) {
        // Snapshot input partitions include states produced by steering and gated delivery.
        const state = ledger.toState();
        state.prompts!.old!.state = blocked === 'unknown-handoff' ? 'interrupted' : blocked as NonNullable<typeof state.prompts>[string]['state'];
        if (blocked === 'unknown-handoff') state.prompts!.old!.handoff = { state: 'unknown', seq: 1 };
        expect(Ledger.fromState(state).restartQueueRepair('repair')).toBeUndefined();
        continue;
      }
      const repair = ledger.restartQueueRepair('repair');
      expect(!!repair).toBe(blocked === 'none');
      if (repair) for (const e of log.appendMany([repair])) ledger.apply(e);
      expect(ledger.restartQueueRepair('repair')).toBeUndefined();
      const replay = Ledger.empty('repair');
      for (const e of log.readAfter(0)) replay.apply(e);
      expect(replay.toState()).toEqual(ledger.toState());
    } finally { log.close(); }
  }
});

async function fixture() {
  const home = tempDir(), project = join(home, 'project'); mkdirSync(project);
  const paths = resolveStatePaths({ env: { HOME: home, XDG_STATE_HOME: join(home, 'state') }, tmpdir: home }); ensureStateLayout(paths);
  const driver = new FakeDriver('codex'); driver.autoComplete = true;
  const manager = new SessionManager({ paths, homeDir: home,
    broker: new ApprovalBroker({ sink: { emit() {} } }), credentials: new CredentialRegistry({ socketPath: paths.socket.path }),
    supervisor: {} as Supervisor, drivers: { get: () => driver, list: () => [driver] }, sessionMcpCommand: ['fixture'],
    config: () => ({ ...getDefaultDeckConfig().crossRunner!, enabled: true, members: { lead: { runnerId: 'codex', modelId: 'fixture' } } }),
    childMcp: async () => ({ runnerPackages: () => [], resolveServer: () => undefined }),
  });
  const created = await manager.execute({ clientId: 'test', command: { v: 1, commandId: 'create', type: 'session.create', projectRoot: project } });
  expect(created.ok).toBe(true);
  const sessionId = (created as any).data.sessionId as string;
  const execute = (command: SessionCommand) => manager.execute({ sessionId, clientId: 'test', command });
  const queue = () => manager.query('prompts.list', { sessionId });
  return { manager, driver, execute, queue, sessionId };
}

// Oracle: the first new user input executes exactly once without an extra Resume;
// concurrent retries of its command must not duplicate native delivery.
test('first send repairs acknowledged empty restart pause before admission, exactly once', async () => {
  const f = await fixture();
  try {
    f.manager.openLog(f.sessionId)!.appendMany(history());
    const command = { v: 1 as const, commandId: 'first', type: 'prompt.send' as const, text: 'new input' };
    const results = await Promise.all([f.execute(command), f.execute(command)]);
    expect(results.every(r => r.ok)).toBe(true);
    await waitFor(() => f.driver.turns.length === 1, 1000, 'first new prompt dispatch');
    await waitFor(() => !f.manager.hasRunningWork());
    expect(f.driver.turns).toHaveLength(1);
    expect(await f.queue()).toMatchObject({ ok: true, data: { paused: false, queued: [] } });
    const events = [...f.manager.openLog(f.sessionId)!.readAfter(0)];
    expect(events.filter(e => e.kind === 'prompt.dispatched' && e.data.promptId === 'first')).toHaveLength(1);
  } finally { await f.manager.close(); }
});

// Oracle: release/reopen may clear its own empty lifecycle pause, but cannot erase
// an explicit pause or a failure that the user has not acknowledged.
test.each(['empty', 'acknowledged', 'interrupted', 'user-paused', 'unacknowledged', 'queued'])(
  'release/reopen preserves pause intent: %s', async mode => {
    const f = await fixture();
    try {
      const safe = mode === 'empty' || mode === 'acknowledged';
      const log = f.manager.openLog(f.sessionId)!;
      if (['acknowledged', 'unacknowledged', 'queued'].includes(mode)) log.appendMany(history(mode !== 'unacknowledged'));
      else if (!safe) log.append({ kind: 'prompt.queue', data: { paused: true, reason: mode } });
      if (mode === 'queued') log.append({ kind: 'prompt.queued', data: { promptId: 'waiting', text: 'waiting', textHash: 'h', by: 'user' } });
      expect((await f.execute({ v: 1, commandId: 'release', type: 'session.release' })).ok).toBe(true);
      await waitFor(() => !f.manager.hasRunningWork());
      expect((await f.execute({ v: 1, commandId: 'prepare', type: 'session.prepare' })).ok).toBe(true);
      await waitFor(async () => (await f.manager.query('session.readiness', { sessionId: f.sessionId }) as any).data.status === 'ready');
      await f.execute({ v: 1, commandId: 'first', type: 'prompt.send', text: 'new input' });
      if (safe) await waitFor(() => f.driver.turns.length === 1);
      expect(await f.queue()).toMatchObject({ ok: true, data: { paused: !safe } });
      expect(f.driver.turns).toHaveLength(safe ? 1 : 0);
      if (!safe) {
        expect((await f.execute({ v: 1, commandId: 'resume', type: 'prompt.resume' })).ok).toBe(true);
        await waitFor(() => f.driver.turns.length === (mode === 'queued' ? 2 : 1));
      }
    } finally { await f.manager.close(); }
  },
);

// Protects existing JSONL histories and old snapshots: terminal ordering must be
// rebuilt from events, and repair must be durable and idempotent after recovery.
test('historical interruption rebuilds from v17 snapshot and recovery repair replays', () => {
  const dir = tempDir(), log = EventLog.open({ dir: join(dir, 'events'), sessionId: 'repair' });
  try {
    const ledger = Ledger.empty('repair');
    for (const e of log.appendMany(history())) ledger.apply(e);
    const snapshot = join(dir, 'ledger.json');
    saveLedgerSnapshot(ledger, log, snapshot);
    const legacy = JSON.parse(readFileSync(snapshot, 'utf8')); legacy.v = 17;
    delete legacy.state.prompts.old.endedSeq;
    legacy.digest = createHash('sha256').update(JSON.stringify({ seq: legacy.seq, eventHash: legacy.eventDigest, state: legacy.state })).digest('hex');
    writeFileSync(snapshot, JSON.stringify(legacy));
    const loaded = loadLedger(log, snapshot);
    expect(loaded.source).toBe('rebuilt');
    const options = { log, ledger: loaded.ledger, probe: {} as ProcessProbe, leaseFileFor: () => { throw Error('terminal history owns no process'); } };
    expect(recoverSession(options).eventsAppended).toBeGreaterThan(0);
    expect(loaded.ledger.promptQueue.paused).toBe(false);
    expect(recoverSession(options).eventsAppended).toBe(0);
    const replay = Ledger.empty('repair');
    for (const e of log.readAfter(0)) replay.apply(e);
    expect(replay.toState()).toEqual(loaded.ledger.toState());
    saveLedgerSnapshot(replay, log, snapshot);
    expect(loadLedger(log, snapshot).source).toBe('snapshot');
    expect(loadLedger(log, snapshot).ledger.toState()).toEqual(replay.toState());
  } finally { log.close(); }
});

// A resume before admission cannot acknowledge a failure occurring later, even
// when that failure was attached to a prompt admitted before the resume.
test.each(['failed', 'interrupted', 'cancelled'] as const)('later terminal transition still blocks repair: %s', state => {
  const log = EventLog.open({ dir: join(tempDir(), 'events'), sessionId: 'repair' });
  try {
    const ledger = Ledger.empty('repair');
    for (const e of log.appendMany([
      ...history(),
      { kind: 'task.continued', data: { taskId: 'old-lead', attempt: 2 } },
      { kind: 'prompt.dispatched', data: { promptId: 'old', taskId: 'old-lead', attempt: 2, reseeded: true } },
      { kind: 'task.state', data: { taskId: 'old-lead', state: 'running' } },
      { kind: 'task.state', data: { taskId: 'old-lead', state } },
      { kind: 'prompt.state', data: { promptId: 'old', state, reason: 'daemon-stopped' } },
    ])) ledger.apply(e);
    expect(ledger.prompt('old')!.endedSeq).toBeGreaterThan(ledger.promptQueue.lastResumeSeq!);
    expect(ledger.restartQueueRepair('repair')).toBeUndefined();
  } finally { log.close(); }
});

// Query/reconnect-style reads cannot grant resume authority. Admission must keep
// queued work and uncertain ownership/delivery behind the explicit Resume boundary.
test.each(['queued', 'uncertain-delivery', 'ownership-unsettled', 'unacknowledged', 'explicit'])(
  'first send retains protected pause: %s', async mode => {
    const f = await fixture();
    try {
      const log = f.manager.openLog(f.sessionId)!;
      log.appendMany(history(mode !== 'unacknowledged'));
      if (mode === 'queued') log.append({ kind: 'prompt.queued', data: { promptId: 'waiting', text: 'waiting', textHash: 'h', by: 'user' } });
      if (mode === 'explicit') log.append({ kind: 'prompt.queue', data: { paused: true, reason: 'user-paused' } });
      if (mode === 'uncertain-delivery') log.appendMany([
        { kind: 'prompt.queued', data: { promptId: 'uncertain', text: 'uncertain', textHash: 'h', by: 'user' } },
        { kind: 'prompt.dispatched', data: { promptId: 'uncertain', taskId: 'old-lead', attempt: 1, handoff: 'gated' } },
        { kind: 'prompt.handoff', data: { promptId: 'uncertain', taskId: 'old-lead', attempt: 1, state: 'sending' } },
        { kind: 'prompt.handoff', data: { promptId: 'uncertain', taskId: 'old-lead', attempt: 1, state: 'unknown' } },
      ]);
      if (mode === 'ownership-unsettled') log.appendMany([
        { kind: 'task.created', data: { taskId: 'unsettled', memberId: 'worker', runnerId: 'codex', modelId: 'fixture' } },
        { kind: 'task.state', data: { taskId: 'unsettled', state: 'running' } },
        { kind: 'task.state', data: { taskId: 'unsettled', state: 'ownership-unsettled' } },
      ]);
      expect(await f.queue()).toMatchObject({ ok: true, data: { paused: true } });
      expect((await f.execute({ v: 1, commandId: 'first', type: 'prompt.send', text: 'new input' })).ok).toBe(true);
      expect(await f.queue()).toMatchObject({ ok: true, data: { paused: true, queued: expect.arrayContaining([expect.objectContaining({ promptId: 'first' })]) } });
      expect(f.driver.turns).toHaveLength(0);
      expect([...log.readAfter(0)].filter(e => e.kind === 'prompt.dispatched' && e.data.promptId === 'first')).toHaveLength(0);
    } finally { await f.manager.close(); }
  },
);

test('simultaneous distinct first sends and a retry dispatch each prompt once', async () => {
  const f = await fixture();
  try {
    const log = f.manager.openLog(f.sessionId)!; log.appendMany(history());
    const first = { v: 1 as const, commandId: 'first', type: 'prompt.send' as const, text: 'first input' };
    const second = { ...first, commandId: 'second', text: 'second input' };
    expect((await Promise.all([f.execute(first), f.execute(second), f.execute(first)])).every(r => r.ok)).toBe(true);
    await waitFor(() => f.driver.turns.length === 2 && !f.manager.hasRunningWork());
    for (const promptId of ['first', 'second']) expect([...log.readAfter(0)].filter(e => e.kind === 'prompt.dispatched' && e.data.promptId === promptId)).toHaveLength(1);
  } finally { await f.manager.close(); }
});

// Explicit pause intent survives historical automatic pause/requeue events,
// repeated release records, reopen, snapshot restoration and log replay.
test('automatic lifecycle events preserve an explicit pause through replay', () => {
  const dir = tempDir(), log = EventLog.open({ dir: join(dir, 'events'), sessionId: 'repair' });
  try {
    const ledger = Ledger.empty('repair');
    const drafts: EventDraft[] = [
      ...history(),
      { kind: 'prompt.queue', data: { paused: true, reason: 'user-paused' } },
      { kind: 'prompt.queued', data: { promptId: 'waiting', text: 'waiting', textHash: 'h', by: 'user' } },
      { kind: 'prompt.requeued', data: { promptId: 'waiting', reason: 'daemon-restart' } },
      { kind: 'prompt.state', data: { promptId: 'waiting', state: 'cancelled' } },
      { kind: 'session.released', data: { epoch: 1, phase: 'releasing' } },
      { kind: 'session.released', data: { epoch: 1, phase: 'released' } },
      { kind: 'session.reopened', data: { epoch: 1, prepared: true } },
      { kind: 'prompt.queue', data: { paused: true, reason: 'daemon-restart' } },
    ];
    for (const e of log.appendMany(drafts)) ledger.apply(e);
    expect(ledger.promptQueue).toMatchObject({ paused: true, reason: 'user-paused' });
    expect(ledger.restartQueueRepair('repair')).toBeUndefined();
    const replay = Ledger.empty('repair');
    for (const e of log.readAfter(0)) replay.apply(e);
    expect(replay.toState()).toEqual(ledger.toState());
    const snapshot = join(dir, 'ledger.json'); saveLedgerSnapshot(ledger, log, snapshot);
    expect(loadLedger(log, snapshot).ledger.promptQueue).toEqual(ledger.promptQueue);
  } finally { log.close(); }
});

test('release repair waits for successful reopen', () => {
  const log = EventLog.open({ dir: join(tempDir(), 'events'), sessionId: 'repair' });
  try {
    const ledger = Ledger.empty('repair');
    for (const e of log.appendMany([{ kind: 'session.released', data: { epoch: 1, phase: 'released' } }])) ledger.apply(e);
    expect(ledger.restartQueueRepair('repair')).toBeUndefined();
    for (const e of log.appendMany([{ kind: 'session.reopened', data: { epoch: 1, prepared: true } }])) ledger.apply(e);
    expect(ledger.restartQueueRepair('repair')).toMatchObject({ kind: 'prompt.queue', data: { paused: false } });
  } finally { log.close(); }
});

// Protects acknowledgement across real startup recovery for delivered gated input,
// including duplicate terminal events already persisted by older hosts.
test('delivered gated terminal ordering survives repeated startup and historical duplicates', () => {
  const dir = tempDir(), log = EventLog.open({ dir: join(dir, 'events'), sessionId: 'repair' });
  try {
    const ledger = Ledger.empty('repair');
    const drafts = history();
    drafts[2]!.data!.gated = true;
    drafts[3]!.data!.handoff = 'gated';
    drafts.splice(4, 0,
      { kind: 'prompt.handoff', data: { promptId: 'old', taskId: 'old-lead', attempt: 1, state: 'sending' } },
      { kind: 'prompt.handoff', data: { promptId: 'old', taskId: 'old-lead', attempt: 1, state: 'delivered' } });
    for (const e of log.appendMany(drafts)) ledger.apply(e);
    const endedSeq = ledger.prompt('old')!.endedSeq;
    const options = { log, ledger, probe: {} as ProcessProbe, leaseFileFor: () => { throw Error('terminal history owns no process'); } };
    for (let startup = 0; startup < 3; startup++) {
      recoverSession(options);
      expect(ledger.prompt('old')!.endedSeq).toBe(endedSeq);
      expect(ledger.promptQueue.paused).toBe(false);
    }
    // Historical hosts wrote these duplicate records even after Resume.
    for (const e of log.appendMany([
      { kind: 'prompt.state', data: { promptId: 'old', taskId: 'old-lead', attempt: 1, state: 'interrupted', reason: 'daemon-restart' } },
      { kind: 'prompt.queue', data: { paused: true, reason: 'daemon-restart' } },
    ])) ledger.apply(e);
    const snapshot = join(dir, 'ledger.json'); saveLedgerSnapshot(ledger, log, snapshot);
    const legacy = JSON.parse(readFileSync(snapshot, 'utf8')); legacy.v = 18;
    legacy.state.prompts.old.endedSeq = legacy.seq - 1;
    legacy.digest = createHash('sha256').update(JSON.stringify({ seq: legacy.seq, eventHash: legacy.eventDigest, state: legacy.state })).digest('hex');
    writeFileSync(snapshot, JSON.stringify(legacy));
    const loaded = loadLedger(log, snapshot);
    expect(loaded.source).toBe('rebuilt');
    expect(loaded.ledger.prompt('old')!.endedSeq).toBe(endedSeq);
    recoverSession({ ...options, ledger: loaded.ledger });
    expect(loaded.ledger.promptQueue.paused).toBe(false);
  } finally { log.close(); }
});

// A timed-out steering barrier followed by definitive refusal is terminal. Resume
// acknowledges that refusal, including when replaying old JSONL without endedSeq.
test('late steering refusal can be acknowledged and repaired after replay', () => {
  const dir = tempDir(), log = EventLog.open({ dir: join(dir, 'events'), sessionId: 'repair' });
  try {
    const ledger = Ledger.empty('repair');
    const apply = (drafts: EventDraft[]) => { for (const e of log.appendMany(drafts)) ledger.apply(e); };
    apply([
      { kind: 'task.created', data: { taskId: 'lead', memberId: 'lead', runnerId: 'codex', modelId: 'fixture' } },
      { kind: 'task.state', data: { taskId: 'lead', state: 'running' } },
      { kind: 'prompt.queued', data: { promptId: 'steered', text: 'input', textHash: 'h', by: 'user' } },
      { kind: 'prompt.steering', data: { promptId: 'steered', taskId: 'lead', attempt: 1, nativeThreadId: 'thread', nativeTurnId: 'turn', clientUserMessageId: 'steered', text: 'input' } },
    ]);
    const steeringSeq = ledger.prompt('steered')!.steering!.seq;
    apply([
      { kind: 'prompt.steered', data: { promptId: 'steered', steeringSeq, state: 'unknown', eligible: false, stale: false, reason: 'timeout' } },
      { kind: 'task.state', data: { taskId: 'lead', state: 'completed' } },
      { kind: 'prompt.steered', data: { promptId: 'steered', steeringSeq, state: 'not-accepted', eligible: false, stale: false, reason: 'no-active-turn', queueFallback: false } },
      { kind: 'prompt.queue', data: { paused: true, reason: 'daemon-restart' } },
    ]);
    expect(ledger.prompt('steered')!.endedSeq).toBeDefined();
    expect(ledger.restartQueueRepair('repair')).toBeUndefined();
    apply([
      { kind: 'prompt.queue', data: { paused: false, commandId: 'resume' } },
      { kind: 'prompt.queue', data: { paused: true, reason: 'daemon-restart' } },
    ]);
    const replay = Ledger.empty('repair');
    for (const e of log.readAfter(0)) replay.apply(e);
    expect(replay.toState()).toEqual(ledger.toState());
    expect(replay.restartQueueRepair('repair')).toBeDefined();
    recoverSession({ log, ledger: replay, probe: {} as ProcessProbe, leaseFileFor: () => { throw Error('terminal history owns no process'); } });
    expect(replay.promptQueue.paused).toBe(false);
  } finally { log.close(); }
});
