/** Scratch lifecycle acceptance: real browser/HTTP/WS; only provider transport is fake. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createECDH, randomBytes } from 'node:crypto';
import { buildWebAssets } from '../../scripts/generate-web-assets';
import { WebService } from '../../packages/session-host/src/web-service';
import { EventLog } from '../../packages/session-host/src/event-log';
import {
  ensureStateLayout,
  resolveStatePaths,
} from '../../packages/session-host/src/paths';
const root = mkdtempSync(join(tmpdir(), 'deck-resume-')),
  paths = resolveStatePaths({ env: { XDG_STATE_HOME: root } });
ensureStateLayout(paths);
const log = EventLog.open({
  dir: join(paths.sessionsDir, 's/events'),
  sessionId: 's',
});
log.appendMany([
  { kind: 'session.created' },
  { kind: 'session.state', data: { state: 'idle' } },
  {
    kind: 'task.created',
    source: { taskId: 'lead', memberId: 'lead' },
    data: { taskId: 'lead', runnerId: 'fixture', state: 'completed' },
  },
]);
for (let i = 0; i < 130; i++)
  log.append({
    kind: 'message.completed',
    source: { memberId: 'lead', taskId: 'lead' },
    data: {
      role: 'assistant',
      text: `Fixture message ${i}. ` + 'History content. '.repeat(12),
    },
  });
const originalBuild = Bun.build;
if (process.env.DECK_TEST_BASELINE_CHAT) {
  const old = Bun.spawnSync(
    ['git', 'show', 'HEAD:apps/web/src/chat-history.ts'],
    { cwd: join(import.meta.dir, '../..') },
  );
  assert.equal(old.exitCode, 0);
  (Bun as any).build = (options: any) =>
    originalBuild({
      ...options,
      plugins: [
        ...(options.plugins ?? []),
        {
          name: 'baseline-chat',
          setup(build: any) {
            build.onLoad(
              { filter: /\/apps\/web\/src\/chat-history\.ts$/ },
              () => ({ contents: old.stdout.toString(), loader: 'ts' }),
            );
          },
        },
      ],
    });
}
const assets = await buildWebAssets();
(Bun as any).build = originalBuild;
const session = {
  sessionId: 's',
  projectId: 'p',
  title: 'Resume fixture',
  state: 'idle',
  generation: 0,
  members: { lead: { runnerId: 'fixture', modelId: 'fixture' } },
  preparationStatus: 'ready',
};
const sent: any[] = [];
const host = new WebService({
  paths,
  assets,
  config: {
    port: 0,
    trustedProxy: null,
    allowedOrigins: [],
    allowFunnel: false,
  },
  push: {
    send: async (_request, payload) => {
      sent.push(payload);
      return 201;
    },
  },
  service: {
    openLog: (id) => (id === 's' ? log : undefined),
    hasRunningWork: () => false,
    execute: async () => ({ ok: true }),
    subscribeEvents: (listener) => log.subscribe(listener),
    isPushAttentionCurrent: () => true,
    query: (name) => ({
      ok: true,
      data:
        name === 'projects.list'
          ? {
              projects: [
                {
                  projectId: 'p',
                  name: 'Fixture',
                  path: '/tmp/fixture',
                  available: true,
                },
              ],
            }
          : name === 'sessions.list' || name === 'sessions.status'
            ? { sessions: [{ ...session, lastSeq: log.lastSeq }] }
            : name === 'session.summary'
              ? { session }
              : name === 'session.readiness'
                ? { status: 'ready', generation: 0 }
                : name === 'prompts.list'
                  ? { seq: log.lastSeq, queued: [], paused: false }
                  : {},
    }),
  },
});
host.enable();
const browser = await chromium.launch({
  executablePath: process.env.DECK_TEST_CHROME ?? '/snap/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
});
const checks: string[] = [];
try {
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      permissions: ['notifications'],
    }),
    page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const Native = window.WebSocket;
    const w = window as any;
    w.__chatSockets = [];
    w.__freezeChat = false;
    w.__testHidden = false;
    const visible = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'visibilityState',
    )!.get!;
    Object.defineProperty(document, 'visibilityState', {
      get: () => (w.__testHidden ? 'hidden' : visible.call(document)),
    });
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        w.__chatSockets.push(this);
        for (const kind of ['message', 'close', 'error'])
          this.addEventListener(
            kind,
            (e) => {
              if (w.__freezeChat) e.stopImmediatePropagation();
            },
            { capture: true },
          );
      }
    };
  });
  await page.goto(host.status().url! + '/?session=s');
  await page.getByLabel('Message the lead').waitFor();
  await page.bringToFront();
  const key = createECDH('prime256v1');
  key.generateKeys();
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/fixture',
    keys: {
      p256dh: key.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
  assert.equal(
    await page.evaluate(
      async (subscription) =>
        (
          await fetch('/api/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription }),
          })
        ).status,
      subscription,
    ),
    200,
  );
  const until = async (fn: () => boolean, label: string) => {
    const until = Date.now() + 6000;
    while (!fn()) {
      if (Date.now() > until) throw new Error(label);
      await Bun.sleep(25);
    }
  };
  const delivery = () =>
    page.evaluate(
      async () => (await (await fetch('/api/push')).json()).delivery,
    );
  log.append({
    kind: 'turn.completed',
    source: { taskId: 'lead', memberId: 'lead' },
    data: { status: 'completed' },
  });
  // The acknowledgement is observable through authenticated diagnostics.
  async function waitSuppressed() {
    const limit = Date.now() + 4000;
    while (Date.now() < limit) {
      if ((await delivery()).suppressed > 0) return;
      await Bun.sleep(40);
    }
    throw new Error('foreground event was not acknowledged');
  }
  await waitSuppressed();
  assert.equal(sent.length, 0);
  checks.push('visible-new-event-acknowledged-without-push');
  await page.getByLabel('Message the lead').fill('Unsent lifecycle draft');
  const viewport = page.locator('#conversation');
  await viewport.evaluate((el) => {
    el.scrollTop = 500;
    el.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(60);
  const anchor = () =>
    viewport.evaluate((el) => {
      const top = el.getBoundingClientRect().top;
      const row = [
        ...el.querySelectorAll<HTMLElement>('[data-history-id]'),
      ].find((r) => r.getBoundingClientRect().bottom > top);
      return row
        ? {
            id: row.dataset.historyId,
            offset: row.getBoundingClientRect().top - top,
          }
        : undefined;
    });
  const before = await anchor();
  assert.ok(before);
  // Lose both hidden presence and WS callbacks, as when a mobile process is suspended.
  await page.route('**/api/push/presence', (route) => route.abort());
  await page.evaluate(() => {
    (window as any).__testHidden = true;
    (window as any).__freezeChat = true;
  });
  for (let i = 1; i <= 2; i++) {
    log.appendMany([
      {
        kind: 'message.completed',
        source: { taskId: 'lead', memberId: 'lead' },
        data: { text: `Offline arrival ${i}` },
      },
      {
        kind: 'turn.completed',
        source: { taskId: 'lead', memberId: 'lead' },
        data: { status: 'completed' },
      },
    ]);
    await until(
      () => sent.length === i,
      'stale foreground lease discarded a new completion',
    );
  }
  checks.push('repeated-push-with-lost-hidden-release');
  const oldCount = await page.evaluate(
    () => (window as any).__chatSockets.length,
  );
  await page.unroute('**/api/push/presence');
  await page.evaluate(() => {
    (window as any).__testHidden = false;
    (window as any).__freezeChat = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(
    (old) => (window as any).__chatSockets.length > old,
    oldCount,
  );
  await page.getByLabel('Message the lead').waitFor();
  assert.equal(
    await page.getByLabel('Message the lead').inputValue(),
    'Unsent lifecycle draft',
  );
  const after = await anchor();
  assert.equal(after?.id, before.id);
  assert.ok(Math.abs(after!.offset - before.offset) < 2);
  checks.push('resume-replaces-half-open-socket-preserves-draft-and-anchor');
  // A history fetch can remain pending across network return. Resume must cancel/fence it.
  let stalled: any;
  await page.route('**/history*', (route) => {
    if (!stalled) {
      stalled = route;
      return;
    }
    return route.continue();
  });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await until(() => !!stalled, 'no pending reconnect request');
  const attempts = await page.evaluate(
    () => (window as any).__chatSockets.length,
  );
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(
    (count) => (window as any).__chatSockets.length > count,
    attempts,
  );
  await stalled.abort().catch(() => {});
  await page.unroute('**/history*');
  await page.getByLabel('Message the lead').waitFor();
  checks.push('network-return-fences-hung-request');
  let backfill:any;
  await page.route('**/history?before=*',route=>{if(!backfill){backfill=route;return;}return route.continue();});
  await page.locator('.history-navigation button').first().evaluate((button:HTMLButtonElement)=>button.click());
  await until(()=>!!backfill,'no pending backfill');
  const oldBackfillSockets=await page.evaluate(()=>(window as any).__chatSockets.length);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.waitForFunction(n=>(window as any).__chatSockets.length>n,oldBackfillSockets);
  await page.waitForFunction(()=>!document.querySelector('.history-navigation button:disabled'));
  await backfill.abort().catch(()=>{});await page.unroute('**/history?before=*');
  checks.push('resume-releases-hung-backfill-with-history-intact');

  // No lifecycle event: the deadline alone must replace an indefinitely pending fetch.
  stalled = undefined;
  await page.route('**/history*', (route) => {
    if (!stalled) {
      stalled = route;
      return;
    }
    return route.continue();
  });
  const count = await page.evaluate(() => (window as any).__chatSockets.length);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(
    (n) => (window as any).__chatSockets.length > n,
    count,
    { timeout: 13000 },
  );
  await stalled.abort().catch(() => {});
  await page.unroute('**/history*');
  await page.getByLabel('Message the lead').waitFor();
  assert.equal(
    await page.getByLabel('Message the lead').inputValue(),
    'Unsent lifecycle draft',
  );
  checks.push('deadline-recovers-hung-reconnect');
  await page
    .getByRole('button', { name: 'Jump to latest ↓', exact: true })
    .click();
  await viewport.getByText('Offline arrival 2', { exact: true }).waitFor();
  checks.push('history-catches-up-without-losing-offline-arrivals');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    (window as any).__testHidden = true;
    (window as any).__freezeChat = true;
  });
  await page.route('**/api/push/presence', (r) => r.abort());
  log.append({
    kind: 'turn.completed',
    source: { taskId: 'lead', memberId: 'lead' },
    data: { status: 'completed' },
  });
  await until(() => sent.length === 3, 'desktop background completion missing');
  checks.push('desktop-background-delivery');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      checks,
      providerTransport: 'fake',
      liveUserEffects: false,
    }),
  );
  await context.close();
} catch (error) {
  console.error(JSON.stringify({ failedAfter: checks }));
  throw error;
} finally {
  await browser.close();
  await host.close();
  log.close();
  rmSync(root, { recursive: true, force: true });
}
