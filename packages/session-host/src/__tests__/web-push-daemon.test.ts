import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import type { CrossRunnerConfig } from '@deck/core/config/deck-config';
import { startDaemon, type RunningDaemon } from '../daemon';
import { ControlClient } from '../control-client';
import { resolveStatePaths, sessionPaths } from '../paths';
import { SessionManager } from '../session-manager';
import { FakeDriver } from '../testing/fake-driver';
import { waitFor } from './test-helpers';
const roots: string[] = [],
  daemons: RunningDaemon[] = [],
  clients: ControlClient[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  await Promise.all(daemons.splice(0).map((d) => d.stop('test')));
  roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true }));
});
const sub = (id = 'one') => {
  const key = createECDH('prime256v1');
  key.generateKeys();
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
    keys: {
      p256dh: key.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
};
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dpd-'));
  roots.push(root);
  const project = join(root, 'project');
  mkdirSync(project);
  const paths = resolveStatePaths({
    env: { XDG_STATE_HOME: join(root, 'state') },
    tmpdir: root,
  });
  const driver = new FakeDriver();
  driver.onStart = (t) => t.init();
  let manager!: SessionManager;
  const sent: any[] = [];
  const config: CrossRunnerConfig = {
    enabled: true,
    members: {
      lead: { runnerId: 'claude', modelId: 'opus' },
      reviewer: { runnerId: 'claude', modelId: 'fast' },
    },
    approvals: { claude: 'relay', opencode: 'relay', codex: 'runner-default' },
    maxConcurrentTasks: 4,
    claudeTosAcknowledgedAt: null,
    web: {
      port: 0,
      trustedProxy: null,
      allowedOrigins: [],
      allowFunnel: false,
    },
  };
  const result = await startDaemon({
    paths,
    version: 'test',
    anchorCommand: ['unused'],
    recoverOnStart: false,
    idleMs: 600000,
    web: {
      config: config.web,
      push: {
        send: async (details, payload) => {
          sent.push({ details, payload });
          return 201;
        },
      },
    },
    createService: (services) =>
      (manager = new SessionManager({
        ...services,
        drivers: { get: () => driver, list: () => [driver] },
        config: () => config,
        homeDir: root,
        sessionMcpCommand: ['unused'],
      })),
  });
  if (!result.ok) throw new Error('start failed');
  daemons.push(result.daemon);
  const client = await ControlClient.connect(paths.socket.path);
  clients.push(client);
  const status: any = await client.request({
    t: 'query',
    name: 'web.status',
    args: {},
  });
  const base = status.outcome.data.url as string;
  const bootstrap = await fetch(`${base}/api/local-access`, {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const cookie = bootstrap.headers.get('set-cookie')!.split(';')[0]!;
  const device = (await bootstrap.json()).device;
  const call = (
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        Cookie: cookie,
        Origin: base,
        'Content-Type': 'application/json',
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const run = async (body: any, sessionId?: string) => {
    const out = await manager.execute({
      sessionId,
      clientId: 'test',
      command: { v: 1, commandId: randomUUID(), ...body },
    });
    if (!out.ok) throw new Error(JSON.stringify(out));
    return out.data as any;
  };
  const id = (await run({ type: 'session.create', projectRoot: project }))
    .sessionId as string;
  return {
    paths,
    driver,
    manager,
    sent,
    base,
    cookie,
    device,
    client,
    call,
    run,
    id,
  };
}
async function tick() {
  await Bun.sleep(80);
}
test('production daemon fanout delivers without any browser/WS, survives reload without replay, revokes subscriptions', async () => {
  const f = await fixture();
  const { call, run, id, driver, sent } = f;
  expect(
    (await call('/api/push', 'POST', { subscription: sub() })).status,
  ).toBe(200);
  await run({ type: 'prompt.send', text: 'secret prompt' }, id);
  await waitFor(() => driver.turns.length === 1);
  driver.turns[0]!.say('secret answer');
  driver.turns[0]!.finish();
  await waitFor(() => sent.length === 1);
  expect(sent[0].payload).toMatchObject({ sessionId: id, kind: 'finished' });
  expect(sent[0].details.headers['Content-Encoding']).toBe('aes128gcm');
  expect(sent[0].details.headers.Authorization).toStartWith('vapid ');
  expect(Buffer.from(sent[0].details.body).toString()).not.toContain('secret');
  expect((await call(`/api/sessions/${id}/summary`)).status).toBe(200);
  await f.client.request({ t: 'query', name: 'web.disable', args: {} });
  await tick();
  await f.client.request({ t: 'query', name: 'web.enable', args: {} });
  await tick();
  expect(sent).toHaveLength(1);
  await f.client.request({
    t: 'query',
    name: 'web.revoke',
    args: { deviceId: f.device.id },
  });
  expect(
    JSON.parse(readFileSync(join(f.paths.webDir, 'push.json'), 'utf8'))
      .subscriptions,
  ).toHaveLength(0);
});
test('push management requires device and exact Origin, rejects bad providers and supports opt-out', async () => {
  const f = await fixture();
  expect(
    (
      await fetch(`${f.base}/api/push`, {
        method: 'POST',
        headers: { Origin: f.base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub() }),
      })
    ).status,
  ).toBe(401);
  for (const headers of [{ Origin: 'https://evil.example' }, { Origin: '' }])
    expect(
      (await f.call('/api/push', 'POST', { subscription: sub() }, headers))
        .status,
    ).toBe(403);
  expect(
    (
      await f.call('/api/push', 'POST', {
        subscription: { ...sub(), endpoint: 'https://127.0.0.1/secret' },
      })
    ).status,
  ).toBe(400);
  expect(
    (await f.call('/api/push', 'POST', { subscription: sub() })).status,
  ).toBe(200);
  expect(await (await f.call('/api/push')).json()).toMatchObject({
    enabled: true,
  });
  expect((await f.call('/api/push', 'DELETE')).status).toBe(200);
  expect(await (await f.call('/api/push')).json()).toMatchObject({
    enabled: false,
  });
  expect(
    (
      await f.call('/api/push', 'POST', {
        subscription: sub(),
        padding: 'x'.repeat(8192),
      })
    ).status,
  ).toBe(400);
});
test('any-agent questions/approvals notify; resolved requests and ordinary delegated completions do not', async () => {
  const f = await fixture();
  await f.call('/api/push', 'POST', { subscription: sub() });
  await f.run({ type: 'prompt.send', text: 'start' }, f.id);
  await waitFor(() => f.driver.turns.length === 1);
  const credential = JSON.parse(
    readFileSync(
      sessionPaths(f.paths, f.id).taskCredentialFile('lead'),
      'utf8',
    ),
  ).token;
  const daemon = daemons.at(-1)!;
  const owner = daemon.services.credentials.lookup(credential)!;
  const task = (await f.manager.callTaskTool(owner, 'deck_delegate', {
    agent: 'reviewer',
    task: 'review',
  })) as any;
  expect(task.ok).toBe(true);
  await waitFor(() => f.driver.turns.length === 2);
  const child = f.driver.turns[1]!;
  const answering = child.ask(
    [
      {
        id: 'choice',
        header: 'Choice',
        prompt: 'secret?',
        multiple: false,
        allowOther: true,
        secret: false,
        options: [
          { label: 'Yes', description: 'ok' },
          { label: 'No', description: 'no' },
        ],
      },
    ],
    'q',
  );
  await waitFor(() => f.sent.length === 1);
  expect(f.sent[0].payload.kind).toBe('question');
  await f.run({ type: 'question.dismiss', questionId: 'q' }, f.id);
  await answering;
  const log = f.manager.openLog(f.id)!;
  log.appendMany([
    {
      kind: 'question.requested',
      source: { taskId: task.data.taskId },
      data: { questionId: 'stale', questions: [] },
    },
    {
      kind: 'question.resolved',
      data: { questionId: 'stale', outcome: 'dismissed', by: 'test' },
    },
  ]);
  log.append({
    kind: 'approval.requested',
    source: { taskId: task.data.taskId },
    data: { approvalId: 'a' },
  });
  await waitFor(() => f.sent.length === 2);
  expect(f.sent[1].payload.kind).toBe('approval');
  log.append({ kind: 'approval.resolved', data: { approvalId: 'a' } });
  child.say('secret child result');
  child.finish();
  await tick();
  expect(f.sent).toHaveLength(2);
  f.driver.turns[0]!.finish({ status: 'failed', error: 'secret error' });
  await waitFor(() => f.sent.some((s) => s.payload.kind === 'failure'));
  expect(JSON.stringify(f.sent.map((s) => s.payload))).not.toContain('secret');
});
test('device viewing target suppresses only that device, multiple tab leases and queued follow-up are respected', async () => {
  const f = await fixture();
  await f.call('/api/push', 'POST', { subscription: sub() });
  await f.call('/api/push/presence', 'POST', {
    tabId: 'tab-one',
    sessionId: f.id,
  });
  await f.call('/api/push/presence', 'POST', {
    tabId: 'tab-two',
    sessionId: null,
  });
  await f.run({ type: 'prompt.send', text: 'one' }, f.id);
  await waitFor(() => f.driver.turns.length === 1);
  f.driver.turns[0]!.finish();
  await tick();
  expect(f.sent).toHaveLength(0);
  await f.call('/api/push/presence', 'POST', {
    tabId: 'tab-one',
    sessionId: null,
  });
  await f.run({ type: 'prompt.send', text: 'two' }, f.id);
  await waitFor(() => f.driver.turns.length === 2);
  await f.run({ type: 'prompt.send', text: 'three' }, f.id);
  f.driver.turns[1]!.finish();
  await waitFor(() => f.driver.turns.length === 3);
  await tick();
  expect(f.sent).toHaveLength(0);
  f.driver.turns[2]!.finish();
  await waitFor(() => f.sent.length === 1);
});

test('another subscribed device still receives alerts while target conversation is being viewed', async () => {
  const f = await fixture();
  await f.call('/api/push', 'POST', { subscription: sub('first') });
  const response = await fetch(`${f.base}/api/local-access`, {
    method: 'POST',
    headers: { Origin: f.base, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  expect(
    (
      await f.call(
        '/api/push',
        'POST',
        { subscription: sub('second') },
        { Cookie: cookie },
      )
    ).status,
  ).toBe(200);
  await f.call('/api/push/presence', 'POST', {
    tabId: 'viewing',
    sessionId: f.id,
  });
  await f.run({ type: 'prompt.send', text: 'work' }, f.id);
  await waitFor(() => f.driver.turns.length === 1);
  f.driver.turns[0]!.finish();
  await waitFor(() => f.sent.length === 1);
  expect(f.sent[0].details.endpoint).toEndWith('/second');
  await f.client.request({ t: 'query', name: 'web.disable', args: {} });
  await f.client.request({
    t: 'query',
    name: 'web.revoke',
    args: { deviceId: f.device.id },
  });
  const records = JSON.parse(
    readFileSync(join(f.paths.webDir, 'push.json'), 'utf8'),
  ).subscriptions;
  expect(records).toHaveLength(1);
  expect(records[0].subscription.endpoint).toEndWith('/second');
});

test('Lead waiting on delegated work is quiet until the resumed Lead actually finishes', async () => {
  const f=await fixture();await f.call('/api/push','POST',{subscription:sub()});await f.run({type:'prompt.send',text:'start'},f.id);await waitFor(()=>f.driver.turns.length===1);
  const token=JSON.parse(readFileSync(sessionPaths(f.paths,f.id).taskCredentialFile('lead'),'utf8')).token;
  const grant=daemons.at(-1)!.services.credentials.lookup(token)!;
  expect((await f.manager.callTaskTool(grant,'deck_delegate',{agent:'reviewer',task:'review'})).ok).toBe(true);await waitFor(()=>f.driver.turns.length===2);
  f.driver.turns[0]!.finish();await tick();expect(f.sent).toHaveLength(0);
  f.driver.turns[1]!.finish();await waitFor(()=>f.driver.turns.length===3);await tick();expect(f.sent).toHaveLength(0);
  f.driver.turns[2]!.finish();await waitFor(()=>f.sent.length===1);const event=[...f.manager.openLog(f.id)!.readAfter(0)].find(e=>e.seq===f.sent[0].payload.seq);expect(event?.source.memberId).toBe('lead');
});

test('a user-requested forced interruption does not create a failure alert',async()=>{
 const f=await fixture();await f.call('/api/push','POST',{subscription:sub()});await f.run({type:'prompt.send',text:'start'},f.id);await waitFor(()=>f.driver.turns.length===1);f.driver.turns[0]!.onInterrupt={status:'interrupted-forced'};await f.run({type:'turn.interrupt',taskId:'lead'},f.id);await tick();expect(f.sent).toHaveLength(0);
});
