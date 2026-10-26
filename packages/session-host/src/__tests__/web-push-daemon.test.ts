import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
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
import { Database } from 'bun:sqlite';
import { WebService } from '../web-service';
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
async function fixture(send?: (signal:AbortSignal)=>Promise<number>) {
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
  const daemonOptions: Parameters<typeof startDaemon>[0] = {
    paths,
    version: 'test',
    anchorCommand: ['unused'],
    recoverOnStart: false,
    idleMs: 600000,
    web: {
      config: config.web,
      push: {
        send: async (details, payload, signal) => {
          sent.push({ details, payload });
          return send ? send(signal) : 201;
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
  };
  const result = await startDaemon(daemonOptions);
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
    restart: async () => {
      client.close();
      await result.daemon.stop('test-restart');
      const next = await startDaemon({...daemonOptions,recoverOnStart:true});
      if(!next.ok)throw Error('restart failed');
      daemons.push(next.daemon);
      const nextClient=await ControlClient.connect(paths.socket.path);clients.push(nextClient);
      await nextClient.request({t:'query',name:'web.enable',args:{}});
      return {manager,client:nextClient};
    },
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
test('notification approval HTTP path enforces authoritative risk/scope and broadcasts resolution',async()=>{
  const f=await fixture();
  await f.call('/api/push','POST',{subscription:sub()});
  await f.run({type:'prompt.send',text:'start'},f.id);
  await waitFor(()=>f.driver.turns.length===1);
  const turn=f.driver.turns[0]!;
  const respond=async(approvalId:string,extra:Record<string,unknown>={})=>(await f.call('/api/commands','POST',{sessionId:f.id,command:{v:1,commandId:randomUUID(),type:'approval.respond',approvalId,decision:'allow',scope:'once',origin:'notification',...extra}})).json();
  for(const risk of ['normal','high',undefined] as const){
    const resolution=turn.io.approval({approvalId:'native',tool:'Bash',risk,summary:'SECRET',input:{command:'SECRET /private/path'}} as any);
    await waitFor(()=>[...f.manager.openLog(f.id)!.readAfter(0)].some(e=>e.kind==='approval.requested' && ![...f.manager.openLog(f.id)!.readAfter(e.seq)].some(r=>r.kind==='approval.resolved'&&r.data.approvalId===e.data.approvalId)));
    const request=[...f.manager.openLog(f.id)!.readAfter(0)].filter(e=>e.kind==='approval.requested').at(-1)!;
    const approvalId=request.data.approvalId as string;
    // Allow the delivery acknowledgement window plus scheduling under the full suite.
    await waitFor(()=>f.sent.some(s=>s.payload.approvalId===approvalId),10_000,"approval push delivery");
    const push=f.sent.find(s=>s.payload.approvalId===approvalId)!.payload;
    expect(push).toMatchObject({kind:'approval',approvalId,tool:'Bash',risk:risk==='normal'?'normal':'high'});
    expect(JSON.stringify(push)).not.toMatch(/SECRET|private|command|input|summary/);
    if(risk==='normal'){
      expect(await respond(approvalId,{scope:'session',grant:'tool'})).toMatchObject({ok:false,code:'approval-notification-scope'});
      expect(await respond(approvalId)).toMatchObject({ok:true});
      expect(await resolution).toMatchObject({decision:'allow',scope:'once'});
      expect(await respond(approvalId)).toMatchObject({ok:false,code:'already-resolved'});
    }else{
      expect(await respond(approvalId)).toMatchObject({ok:false,code:'approval-notification-risk'});
      expect(await respond(approvalId,{decision:'deny'})).toMatchObject({ok:false,code:'approval-notification-risk'});
      expect(await respond(approvalId,{origin:undefined,decision:'deny'})).toMatchObject({ok:true});
      await resolution;
    }
    const snapshot=await f.call(`/api/sessions/${f.id}/events?after=0`);
    // The same event stream used by the approvals card receives the resolution.
    expect(await snapshot.text()).toContain('approval.resolved');
    expect([...f.manager.openLog(f.id)!.readAfter(0)].some(e=>e.kind==='approval.resolved'&&e.data.approvalId===approvalId)).toBe(true);
  }
  expect(await respond('missing')).toMatchObject({ok:false,code:'unknown-approval'});
  const unauth=await fetch(`${f.base}/api/commands`,{method:'POST',headers:{Origin:f.base,'Content-Type':'application/json'},body:JSON.stringify({})});
  expect(unauth.status).toBe(401);
  turn.finish();
},15000);
test('production daemon fanout delivers without any browser/WS, survives reload without replay, revokes subscriptions', async () => {
  const f = await fixture();
  const { call, run, id, driver, sent } = f;
  expect(
    (await call('/api/push', 'POST', { subscription: sub() })).status,
  ).toBe(200);
  await run({ type: 'session.rename', title: 'Delivery work' }, id);
  await run({ type: 'prompt.send', text: 'secret prompt' }, id);
  await waitFor(() => driver.turns.length === 1);
  driver.turns[0]!.say('secret answer');
  driver.turns[0]!.finish();
  await waitFor(() => sent.length === 1);
  expect(sent[0].payload).toMatchObject({ sessionId: id, kind: 'finished', sessionName:'Delivery work' });
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
  f.driver.turns[2]!.say('Completed third request.');
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
  f.driver.turns[0]!.say('Specific result.');
  f.driver.turns[0]!.finish();
  await waitFor(()=>!f.manager.hasRunningWork());
  const reply=(await(await f.call(`/api/sessions/${f.id}/replies`)).json()).replies[0];
  await f.call(`/api/sessions/${f.id}/replies/${reply.replyId}`,'POST',{displayed:true});
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
  f.driver.turns[2]!.say('Reviewed reply.');f.driver.turns[2]!.finish();await waitFor(()=>f.sent.length===1);const event=[...f.manager.openLog(f.id)!.readAfter(0)].find(e=>e.seq===f.sent[0].payload.seq);expect(event?.source.memberId).toBe('lead');
});

test('a user-requested forced interruption does not create a failure alert',async()=>{
 const f=await fixture();await f.call('/api/push','POST',{subscription:sub()});await f.run({type:'prompt.send',text:'start'},f.id);await waitFor(()=>f.driver.turns.length===1);f.driver.turns[0]!.onInterrupt={status:'interrupted-forced'};await f.run({type:'turn.interrupt',taskId:'lead'},f.id);await tick();expect(f.sent).toHaveLength(0);
});

test('exact reply display suppresses that device; a broad foreground cursor cannot swallow another reply',async()=>{
 const f=await fixture();await f.call('/api/push','POST',{subscription:sub()});
 await f.call('/api/push/presence','POST',{tabId:'mobile',sessionId:f.id,revision:1,seenSeq:0});
 await f.run({type:'prompt.send',text:'one'},f.id);await waitFor(()=>f.driver.turns.length===1);f.driver.turns[0]!.say('First exact reply.');f.driver.turns[0]!.finish();await waitFor(()=>!f.manager.hasRunningWork());
 const reply=(await(await f.call(`/api/sessions/${f.id}/replies`)).json()).replies[0];
 await f.call(`/api/sessions/${f.id}/replies/${reply.replyId}`,'POST',{displayed:true});
 await f.call('/api/push/presence','POST',{tabId:'mobile',sessionId:f.id,revision:2,seenSeq:f.manager.openLog(f.id)!.lastSeq});await tick();
 expect((await(await f.call('/api/push')).json()).delivery.suppressed).toBe(1);expect(f.sent).toHaveLength(0);
 await f.run({type:'prompt.send',text:'two'},f.id);await waitFor(()=>f.driver.turns.length===2);f.driver.turns[1]!.say('Second unread reply.');f.driver.turns[1]!.finish();// Includes the 2-second view acknowledgement grace and daemon scheduling under suite load.
 await waitFor(()=>f.sent.length===1,10000);
 const status=(await(await f.call('/api/push')).json()).delivery;expect(status.sent).toBe(1);expect(status.lastOutcome).toBe('accepted');expect(status.lastStatus).toBe(201);
});

test('production composition sends each decision plus reviewed Lead result while another child runs',async()=>{
 const f=await fixture();await f.call('/api/push','POST',{subscription:sub()});
 await f.run({type:'prompt.send',text:'Review one result and keep independent work running'},f.id);await waitFor(()=>f.driver.turns.length===1);
 const token=JSON.parse(readFileSync(sessionPaths(f.paths,f.id).taskCredentialFile('lead'),'utf8')).token;
 const owner=daemons.at(-1)!.services.credentials.lookup(token)!;
 const first:any=await f.manager.callTaskTool(owner,'deck_delegate',{agent:'reviewer',task:'review first'});
 await waitFor(()=>f.driver.turns.length===2);f.driver.turns[1]!.say('Verified implementation.');f.driver.turns[1]!.finish();await tick();
 expect((await f.manager.callTaskTool(owner,'deck_delegate',{agent:'reviewer',task:'independent work'})).ok).toBe(true);await waitFor(()=>f.driver.turns.length===3);
 expect((await f.manager.callTaskTool(owner,'deck_task_result',{taskId:first.data.taskId})).ok).toBe(true);
 const evidence=[...f.manager.openLog(f.id)!.readAfter(0)].find(e=>e.kind==='task.result'&&e.source.taskId===first.data.taskId)!;
 expect((await f.manager.callTaskTool(owner,'deck_task_integrate',{commandId:'integrate-push',taskId:first.data.taskId,attempt:1,state:'integrated',note:'Reviewed implementation',evidenceSeqs:[evidence.seq]})).ok).toBe(true);
 for(const key of ['storage','retry'])expect((await f.manager.callTaskTool(owner,'deck_decision_open',{commandId:`open-${key}`,key,question:`Approve ${key}?`,source:{taskId:first.data.taskId,attempt:1}})).ok).toBe(true);
 await tick();expect(f.sent).toHaveLength(0);
 f.driver.turns[0]!.say('Delivery is repaired and verified.');f.driver.turns[0]!.finish();
 await waitFor(()=>f.sent.length===3);
 expect(f.sent.map(s=>s.payload.attention).sort()).toEqual(['decision','decision','result']);
 expect(f.sent.find(s=>s.payload.attention==='result').payload).toMatchObject({summary:'Delivery is repaired and verified.',othersActive:true});
 // Recreate the actual web service with the same durable receipts, without replay.
 await f.client.request({t:'query',name:'web.disable',args:{}});await f.client.request({t:'query',name:'web.enable',args:{}});await tick();expect(f.sent).toHaveLength(3);
});

test('actual daemon restart recovers missed unresolved decisions without replaying delivered attention',async()=>{
 const f=await fixture();await f.call('/api/push','POST',{subscription:sub()});
 await f.run({type:'prompt.send',text:'Decide storage'},f.id);await waitFor(()=>f.driver.turns.length===1);
 const token=JSON.parse(readFileSync(sessionPaths(f.paths,f.id).taskCredentialFile('lead'),'utf8')).token;
 const grant=daemons.at(-1)!.services.credentials.lookup(token)!;
 expect((await f.manager.callTaskTool(grant,'deck_decision_open',{commandId:'recover-decision',key:'storage',question:'Approve durable storage?',source:{promptId:[...f.manager.openLog(f.id)!.readAfter(0)].find(e=>e.kind==='prompt.dispatched')!.data.promptId}})).ok).toBe(true);
 await f.client.request({t:'query',name:'web.disable',args:{}});
 f.driver.turns[0]!.say('Storage needs your decision.');f.driver.turns[0]!.finish();await tick();expect(f.sent).toHaveLength(0);
 const restarted=await f.restart();await waitFor(()=>f.sent.some(s=>s.payload.attention==='decision'));
 expect(f.sent.find(s=>s.payload.attention==='decision').payload.summary).toBe('Approve durable storage?');
 const count=f.sent.length;await restarted.client.request({t:'query',name:'web.disable',args:{}});await restarted.client.request({t:'query',name:'web.enable',args:{}});await tick();expect(f.sent).toHaveLength(count);
});

test('production Lead ingestion excludes formatted credentials and quoted code from outgoing summaries',async()=>{
 const f=await fixture();await f.call('/api/push','POST',{subscription:sub()});
 await f.run({type:'prompt.send',text:'Report the reviewed change'},f.id);await waitFor(()=>f.driver.turns.length===1);
 f.driver.turns[0]!.say('**token:** DEMO_SECRET_42\n\n> ```text\n> PRIVATE_CODE_42\n> ```\n\nDelivery fixed.');f.driver.turns[0]!.finish();
 await waitFor(()=>f.sent.length===1);expect(f.sent[0].payload.summary).toBe('Delivery fixed.');expect(JSON.stringify(f.sent[0].payload)).not.toMatch(/DEMO_?SECRET_?42|PRIVATE_?CODE_?42/);
});

test('Lead ingestion and actual outgoing summaries exclude complete table/container variants',async()=>{
 const f=await fixture();await f.call('/api/push','POST',{subscription:sub()});
 const tables=[
  'Credential | Value\n--- | ---\npassword | DEMOPASSWORD42',
  '| Credential | Value |\n| :--- | ---: |\n| token | DEMO_SECRET_42 |',
  '> Credential | Value\n> --- | ---\n> password | DEMOPASSWORD42',
  '- Credential | Value\n  --- | ---\n  password | DEMOPASSWORD42',
  '> - Credential | Value\n>   --- | ---\n>   token | DEMO_SECRET_42',
 ];
 for(let n=0;n<tables.length;n++){
  await f.run({type:'prompt.send',text:'Report change '+n},f.id);await waitFor(()=>f.driver.turns.length===n+1);
  f.driver.turns[n]!.say(tables[n]+'\n\nDelivery fixed.');f.driver.turns[n]!.finish();await waitFor(()=>f.sent.length===n+1);
  expect(f.sent[n].payload.summary).toBe('Delivery fixed.');expect(JSON.stringify(f.sent[n].payload)).not.toMatch(/DEMO|Credential|password|token/);
 }
});

test('mixed containers and budget-cut tables cannot leak through redacted Lead ingestion into actual payload',async()=>{
 const f=await fixture();await f.call('/api/push','POST',{subscription:sub()});
 const header='password | DEMOPASSWORD42 ';
 const messages=[
  '- > ```text\n  > PRIVATE_CODE_42\n  > ```\n\nDelivery fixed.',
  '> - > - ```text\n>   >   PRIVATE_CODE_42\n>   >   ```\n\nDelivery fixed.',
  ...[-1,0,1].map(offset=>header+' '.repeat(8192-header.length+offset)+'\n--- | ---\nname | value\n\nDelivery fixed.'),
  '```text\n- ```\nPRIVATE_CODE_42\n```\n\nDelivery fixed.',
  '- > ```text\n  > - ```\n  > PRIVATE_CODE_42\n  > ```\n\nDelivery fixed.',
  'Delivery fixed.',
 ];
 for(let n=0;n<messages.length;n++){
  await f.run({type:'prompt.send',text:'Report safe summary '+n},f.id);await waitFor(()=>f.driver.turns.length===n+1);
  f.driver.turns[n]!.say(messages[n]!);f.driver.turns[n]!.finish();await waitFor(()=>f.sent.length===n+1);
  const payload=f.sent[n].payload;expect(JSON.stringify(payload)).not.toMatch(/PRIVATE_?CODE_?42|DEMOPASSWORD42|password/);
  if(n<2 || n>=5)expect(payload.summary).toBe('Delivery fixed.');else expect(payload.summary).toBeUndefined();
 }
});

 test('dedented list fences stay excluded in actual ingested outgoing payloads',async()=>{
 const f=await fixture();await f.call('/api/push','POST',{subscription:sub()});
 const cases=['-  ','-   ','1.  ','12)   ','-\t'];
 for(let n=0;n<cases.length;n++){
 await f.run({type:'prompt.send',text:'Report '+n},f.id);await waitFor(()=>f.driver.turns.length===n+1);
 f.driver.turns[n]!.say(cases[n]+'```text\n  ```\nPRIVATE_CODE_42\n```\n\nDelivery fixed.');f.driver.turns[n]!.finish();
 await waitFor(()=>f.sent.length===n+1);expect(JSON.stringify(f.sent[n].payload)).not.toMatch(/PRIVATE_?CODE_?42/);
 }
 });

test('direct research reply is durable and pushes while child runs; later work never erases it',async()=>{
 const f=await fixture();await f.call('/api/push','POST',{subscription:sub()});
 await f.run({type:'prompt.send',text:'Research directly and delegate independent work'},f.id);await waitFor(()=>f.driver.turns.length===1);
 const token=JSON.parse(readFileSync(sessionPaths(f.paths,f.id).taskCredentialFile('lead'),'utf8')).token;
 const grant=daemons.at(-1)!.services.credentials.lookup(token)!;
 expect((await f.manager.callTaskTool(grant,'deck_delegate',{agent:'reviewer',task:'Independent work'})).ok).toBe(true);await waitFor(()=>f.driver.turns.length===2);
 f.driver.turns[0]!.say('Direct research found the answer.');f.driver.turns[0]!.finish();
 await waitFor(()=>f.sent.length===1);expect(f.driver.turns[1]!.finished).toBe(false);
 const first=(await(await f.call(`/api/sessions/${f.id}/replies`)).json()).replies[0];expect(f.sent[0].payload.replyId).toBe(first.replyId);
 f.driver.turns[1]!.finish();await waitFor(()=>f.driver.turns.length===3);
 f.driver.turns[2]!.say('Background work is complete too.');f.driver.turns[2]!.finish();await waitFor(()=>f.sent.length===2);
 const replies=await(await f.call('/api/replies')).json();expect(replies.total).toBe(2);expect(replies.replies[0].replyId).toBe(first.replyId);
 const restarted=await f.restart();
 const state=await restarted.client.request({t:'query',name:'web.status',args:{}}) as any;
 const rows=await(await fetch(state.outcome.data.url+'/api/replies',{headers:{Cookie:f.cookie}})).json();
 expect(rows.total).toBe(2);expect(f.driver.turns.length).toBe(3);
});

test('displaying a Lead reply does not resolve decisions or admit another native turn',async()=>{
 const f=await fixture();await f.run({type:'prompt.send',text:'Investigate and ask for a decision'},f.id);await waitFor(()=>f.driver.turns.length===1);
 const token=JSON.parse(readFileSync(sessionPaths(f.paths,f.id).taskCredentialFile('lead'),'utf8')).token,grant=daemons.at(-1)!.services.credentials.lookup(token)!;
 const promptId=String([...f.manager.openLog(f.id)!.readAfter(0)].find(e=>e.kind==='prompt.dispatched')!.data.promptId);
 expect((await f.manager.callTaskTool(grant,'deck_decision_open',{commandId:'read-does-not-answer',key:'question',question:'May this action proceed?',source:{promptId}})).ok).toBe(true);
 f.driver.turns[0]!.say('Investigation result. A decision remains pending.');f.driver.turns[0]!.finish();await waitFor(()=>!f.manager.hasRunningWork());
 const before=await(await f.call(`/api/sessions/${f.id}/decisions`)).json(),reply=(await(await f.call(`/api/sessions/${f.id}/replies`)).json()).replies[0];
 expect((await f.call(`/api/sessions/${f.id}/replies/${reply.replyId}`,'POST',{displayed:true})).status).toBe(200);
 const after=await(await f.call(`/api/sessions/${f.id}/decisions`)).json();expect(after).toEqual(before);expect(f.driver.turns.length).toBe(1);
});

test('revocation closes the real stream and aborts held push despite locked unread cleanup; retries cleanup',async()=>{
 let signal:AbortSignal|undefined,release!:()=>void;
 const held=new Promise<void>(resolve=>release=resolve);
 const f=await fixture(async s=>{signal=s;await held;return 201;});
 const socket=new (WebSocket as any)(`${f.base.replace('http:','ws:')}/api/sessions/${f.id}/events`,{headers:{Origin:f.base,Cookie:f.cookie}}) as WebSocket;
 const frames:string[]=[];socket.onmessage=e=>frames.push(String(e.data));
 await waitFor(()=>socket.readyState===WebSocket.OPEN);
 await f.call('/api/push','POST',{subscription:sub()});await f.run({type:'prompt.send',text:'A held result'},f.id);await waitFor(()=>f.driver.turns.length===1);
 f.driver.turns[0]!.say('Private reply.');f.driver.turns[0]!.finish();await waitFor(()=>!!signal);
 const lock=new Database(join(f.paths.webDir,'lead-replies.sqlite'));
 try{
  lock.exec('BEGIN IMMEDIATE');
  const result:any=await f.client.request({t:'query',name:'web.revoke',args:{deviceId:f.device.id}});
  expect(result.outcome.ok).toBe(false);expect(JSON.parse(readFileSync(f.paths.devicesFile,'utf8'))[0].revokedAt).toBeDefined();
  expect(signal!.aborted).toBe(true);await waitFor(()=>socket.readyState===WebSocket.CLOSED);
  const before=frames.length;f.manager.openLog(f.id)!.append({kind:'message.completed',data:{role:'assistant',text:'Must not fan out after revoke.'}});release();await tick();expect(frames).toHaveLength(before);
  expect((await f.call('/api/replies')).status).toBe(401);
  expect(JSON.parse(readFileSync(join(f.paths.webDir,'push.json'),'utf8')).subscriptions).toHaveLength(0);
  lock.exec('ROLLBACK');
  await waitFor(()=>(lock.query('SELECT COUNT(*) AS n FROM readers WHERE deviceId=?').get(f.device.id) as any).n===0,3000,'revoked reader cleanup retry');
  const status:any=await f.client.request({t:'query',name:'web.status',args:{}});expect(status.outcome.data.error).toBeUndefined();
 }finally{if(lock.inTransaction)lock.exec('ROLLBACK');lock.close();release();socket.close();}
});

test('completed session removal retires unread counts and exact/paged replies across restart without read receipts',async()=>{
 const f=await fixture();await f.run({type:'prompt.send',text:'Create a retained reply'},f.id);await waitFor(()=>f.driver.turns.length===1);f.driver.turns[0]!.say('Unread before explicit removal.');f.driver.turns[0]!.finish();await waitFor(()=>!f.manager.hasRunningWork());
 const initial=await(await f.call('/api/replies')).json(),reply=initial.replies[0];expect(initial.total).toBe(1);
 await f.run({type:'session.release'},f.id);await waitFor(()=>[...f.manager.openLog(f.id)!.readAfter(0)].some(e=>e.kind==='session.released'&&e.data.phase==='released'));
 expect((await(await f.call('/api/replies')).json()).total).toBe(1);expect((await f.call(`/api/sessions/${f.id}/summary`)).status).toBe(200);
 await f.run({type:'session.remove'},f.id);await waitFor(()=>[...f.manager.openLog(f.id)!.readAfter(0)].some(e=>e.kind==='session.removed'&&e.data.phase==='removed'));
 expect((await f.call(`/api/sessions/${f.id}/summary`)).status).toBe(404);
 const after=await(await f.call('/api/replies')).json();expect(after.total).toBe(0);expect(after.replies).toEqual([]);
 expect((await f.call(`/api/sessions/${f.id}/replies/${reply.replyId}`)).status).toBe(404);
 const db=new Database(join(f.paths.webDir,'lead-replies.sqlite'));try{expect((db.query('SELECT COUNT(*) AS n FROM displayed').get() as any).n).toBe(0);}finally{db.close();}
 const restarted=await f.restart();const status:any=await restarted.client.request({t:'query',name:'web.status',args:{}}),base=status.outcome.data.url;
 const again=await(await fetch(base+'/api/replies',{headers:{Cookie:f.cookie}})).json();expect(again.total).toBe(0);expect(again.replies).toEqual([]);
 expect(f.driver.turns).toHaveLength(1);
});

for(const failure of ['push','device'] as const)test(`revocation teardown survives ${failure} persistence failure and reports/retries incomplete cleanup`,async()=>{
 let signal:AbortSignal|undefined,release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
 const f=await fixture(async s=>{signal=s;await held;return 500;});
 const socket=new (WebSocket as any)(`${f.base.replace('http:','ws:')}/api/sessions/${f.id}/events`,{headers:{Origin:f.base,Cookie:f.cookie}}) as WebSocket;await waitFor(()=>socket.readyState===WebSocket.OPEN);
 await f.call('/api/push','POST',{subscription:sub()});await f.run({type:'prompt.send',text:'Private held response'},f.id);await waitFor(()=>f.driver.turns.length===1);f.driver.turns[0]!.say('Private result.');f.driver.turns[0]!.finish();await waitFor(()=>!!signal);
 const file=failure==='push'?join(f.paths.webDir,'push.json'):f.paths.devicesFile,backup=file+'.fixture-backup';renameSync(file,backup);mkdirSync(file);
 try{
  const result:any=await f.client.request({t:'query',name:'web.revoke',args:{deviceId:f.device.id}});expect(result.outcome).toMatchObject({ok:false,code:'web-unavailable',message:'Device access is blocked; revocation cleanup is pending.'});
  expect(signal!.aborted).toBe(true);await waitFor(()=>socket.readyState===WebSocket.CLOSED);expect((await f.call('/api/replies')).status).toBe(401);
  const status:any=await f.client.request({t:'query',name:'web.status',args:{}});expect(status.outcome.data.error).toBe('device-revocation-cleanup-pending');
  const db=new Database(join(f.paths.webDir,'lead-replies.sqlite'));try{expect((db.query('SELECT COUNT(*) AS n FROM readers WHERE deviceId=?').get(f.device.id) as any).n).toBe(0);}finally{db.close();}
 }finally{rmSync(file,{recursive:true});renameSync(backup,file);release();socket.close();}
 await waitFor(()=>JSON.parse(readFileSync(join(f.paths.webDir,'push.json'),'utf8')).subscriptions.length===0&&!!JSON.parse(readFileSync(f.paths.devicesFile,'utf8'))[0].revokedAt,3000,'revocation persistence retry');await tick();expect(f.sent).toHaveLength(1);
 const status:any=await f.client.request({t:'query',name:'web.status',args:{}});expect(status.outcome.data.error).toBeUndefined();
});

test('durable revoked device intent finishes failed unread cleanup after restart and never regains authorization',async()=>{
 const f=await fixture();await f.run({type:'prompt.send',text:'One unread reply'},f.id);await waitFor(()=>f.driver.turns.length===1);f.driver.turns[0]!.say('Retained until revoke.');f.driver.turns[0]!.finish();await waitFor(()=>!f.manager.hasRunningWork());expect((await(await f.call('/api/replies')).json()).total).toBe(1);
 const lock=new Database(join(f.paths.webDir,'lead-replies.sqlite'));
 try{
  lock.exec('BEGIN IMMEDIATE');const result:any=await f.client.request({t:'query',name:'web.revoke',args:{deviceId:f.device.id}});expect(result.outcome.ok).toBe(false);
  await f.client.request({t:'query',name:'web.disable',args:{}});expect((lock.query('SELECT COUNT(*) AS n FROM readers WHERE deviceId=?').get(f.device.id) as any).n).toBe(1);lock.exec('ROLLBACK');
  const restarted=await f.restart();const status:any=await restarted.client.request({t:'query',name:'web.status',args:{}}),base=status.outcome.data.url;
  expect((await fetch(base+'/api/replies',{headers:{Cookie:f.cookie}})).status).toBe(401);expect((lock.query('SELECT COUNT(*) AS n FROM readers WHERE deviceId=?').get(f.device.id) as any).n).toBe(0);expect(status.outcome.data.error).toBeUndefined();expect(f.driver.turns).toHaveLength(1);
 }finally{if(lock.inTransaction)lock.exec('ROLLBACK');lock.close();}
});

test('removal during held push aborts delivery; locked retirement retries/replays without a display receipt',async()=>{
 let signal:AbortSignal|undefined,release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
 const f=await fixture(async s=>{signal=s;await held;return 500;});await f.call('/api/push','POST',{subscription:sub()});await f.run({type:'prompt.send',text:'Reply before removal'},f.id);await waitFor(()=>f.driver.turns.length===1);f.driver.turns[0]!.say('This reply will be removed.');f.driver.turns[0]!.finish();await waitFor(()=>!!signal);
 const lock=new Database(join(f.paths.webDir,'lead-replies.sqlite'));
 try{
  lock.exec('BEGIN IMMEDIATE');await f.run({type:'session.remove'},f.id);await waitFor(()=>[...f.manager.openLog(f.id)!.readAfter(0)].some(e=>e.kind==='session.removed'&&e.data.phase==='removed'));expect(signal!.aborted).toBe(true);
  expect((await f.call('/api/replies')).status).toBe(503);release();await tick();expect(f.sent).toHaveLength(1);await f.client.request({t:'query',name:'web.disable',args:{}});lock.exec('ROLLBACK');
  const restarted=await f.restart();const status:any=await restarted.client.request({t:'query',name:'web.status',args:{}}),base=status.outcome.data.url;
  const page=await(await fetch(base+'/api/replies',{headers:{Cookie:f.cookie}})).json();expect(page).toMatchObject({total:0,replies:[]});await tick();expect(f.sent).toHaveLength(1);expect((lock.query('SELECT COUNT(*) AS n FROM displayed').get() as any).n).toBe(0);expect(f.driver.turns).toHaveLength(1);
 }finally{if(lock.inTransaction)lock.exec('ROLLBACK');lock.close();release();}
});

for(const scenario of ['unlocked','still locked','backlog'] as const)test(`held receipt revalidates durable removal after failed retirement without a pre-refresh (${scenario})`,async()=>{
 const unlockBeforeBody=scenario!=='still locked';
 const f=await fixture();await f.run({type:'prompt.send',text:'A reply before removal'},f.id);await waitFor(()=>f.driver.turns.length===1);f.driver.turns[0]!.say('Reply whose receipt will be held.');f.driver.turns[0]!.finish();await waitFor(()=>!f.manager.hasRunningWork());
 const reply=(await(await f.call('/api/replies')).json()).replies[0];await f.client.request({t:'query',name:'web.disable',args:{}});
 const host=new WebService({paths:f.paths,service:f.manager,config:{port:0,trustedProxy:null,allowedOrigins:[],allowFunnel:false}});host.enable();const base=host.status().url!;
 const request=new Request(`${base}/api/sessions/${f.id}/replies/${reply.replyId}`,{method:'POST',headers:{Origin:base,Host:new URL(base).host,Cookie:f.cookie,'Content-Type':'application/json'},body:'{"displayed":true}'});
 let entered=false,release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),text=request.text.bind(request);request.text=async()=>{entered=true;await gate;return text();};
 const response=(host as any).fetch(request,{port:Number(new URL(base).port),requestIP:()=>({address:'127.0.0.1'})}) as Promise<Response>,db=new Database(join(f.paths.webDir,'lead-replies.sqlite'));
 try{
  await waitFor(()=>entered);db.exec('BEGIN IMMEDIATE');
  const checkpoint=(db.query('SELECT seq FROM sessions WHERE sessionId=?').get(f.id) as any).seq;
  if(scenario==='backlog')for(let n=0;n<4096;n++)f.manager.openLog(f.id)!.append({kind:'diagnostic',data:{code:'receipt-backlog-fixture'}});
  await f.run({type:'session.remove'},f.id);await waitFor(()=>[...f.manager.openLog(f.id)!.readAfter(0)].some(e=>e.kind==='session.removed'&&e.data.phase==='removed'));
  expect((db.query('SELECT COUNT(*) AS n FROM retired_sessions WHERE sessionId=?').get(f.id) as any).n).toBe(0);
  // No GET, refresh or timer yield between unlocking and admitting the body.
  if(unlockBeforeBody)db.exec('ROLLBACK');release();expect((await response).status).toBe(scenario==='unlocked'?404:503);
  if(scenario==='backlog')expect((db.query('SELECT seq FROM sessions WHERE sessionId=?').get(f.id) as any).seq-checkpoint).toBe(4096);
  expect((db.query('SELECT COUNT(*) AS n FROM displayed d JOIN replies r ON r.id=d.reply WHERE r.sessionId=?').get(f.id) as any).n).toBe(0);expect(f.driver.turns).toHaveLength(1);
 }finally{release();if(db.inTransaction)db.exec('ROLLBACK');await host.close();db.close();}
});
