/** Real Chromium worker/permission/notification flow; provider delivery is simulated through CDP. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import type { CrossRunnerConfig } from '../../packages/core/src/config/deck-config';
import { startDaemon } from '../../packages/session-host/src/daemon';
import { ControlClient } from '../../packages/session-host/src/control-client';
import { SessionManager } from '../../packages/session-host/src/session-manager';
import { FakeDriver } from '../../packages/session-host/src/testing/fake-driver';
import { resolveStatePaths } from '../../packages/session-host/src/paths';
import { buildWebAssets } from '../../scripts/generate-web-assets';
const root = mkdtempSync(join(tmpdir(), 'deck-push-browser-')),
  project = join(root, 'project');
mkdirSync(project);
const paths = resolveStatePaths({
    env: { XDG_STATE_HOME: join(root, 'state') },
    tmpdir: root,
  }),
  driver = new FakeDriver();
let manager!: SessionManager;
const config: CrossRunnerConfig = {
  enabled: true,
  members: { lead: { runnerId: 'claude', modelId: 'opus' } },
  approvals: { claude: 'relay', opencode: 'relay', codex: 'runner-default' },
  maxConcurrentTasks: 4,
  claudeTosAcknowledgedAt: null,
  web: { port: 0, trustedProxy: null, allowedOrigins: [], allowFunnel: false },
};
const assets = await buildWebAssets();
const started = await startDaemon({
  paths,
  version: 'test',
  anchorCommand: ['unused'],
  recoverOnStart: false,
  idleMs: 600000,
  web: { config: config.web, assets, push: { send: async () => 201 } },
  createService: (services) =>
    (manager = new SessionManager({
      ...services,
      drivers: { get: () => driver, list: () => [driver] },
      config: () => config,
      homeDir: root,
      sessionMcpCommand: ['unused'],
    })),
});
if (!started.ok) throw new Error('daemon start failed');
const control = await ControlClient.connect(paths.socket.path),
  status: any = await control.request({
    t: 'query',
    name: 'web.status',
    args: {},
  }),
  base = status.outcome.data.url as string;
const result = await manager.execute({
  clientId: 'acceptance',
  command: {
    v: 1,
    commandId: randomUUID(),
    type: 'session.create',
    projectRoot: project,
  },
});
if (!result.ok) throw new Error(JSON.stringify(result));
const id = (result.data as any).sessionId;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({
    executablePath: process.env.DECK_TEST_CHROME ?? '/snap/bin/chromium',
    headless: true,
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      permissions: ['notifications'],
    }),
    page = await context.newPage();
  context.setDefaultTimeout(8000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const key = createECDH('prime256v1');
  key.generateKeys();
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/acceptance',
    keys: {
      p256dh: key.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
  await page.addInitScript((subscription) => {
    let active = false;
    Object.defineProperty(PushManager.prototype, 'getSubscription', {
      value: async () =>
        active
          ? {
              toJSON: () => subscription,
              unsubscribe: async () => {
                active = false;
                return true;
              },
            }
          : null,
    });
    Object.defineProperty(PushManager.prototype, 'subscribe', {
      value: async () => {
        active = true;
        return {
          toJSON: () => subscription,
          unsubscribe: async () => {
            active = false;
            return true;
          },
        };
      },
    });
  }, subscription);
  await page.goto(`${base}/?session=${id}`);
  await page
    .getByRole('button', { name: 'Notifications', exact: true })
    .waitFor()
    .catch(async () =>
      page.getByLabel('Notifications', { exact: true }).waitFor(),
    );
  await page.getByLabel('Notifications', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Enable notifications', exact: true })
    .waitFor();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page
    .getByRole('button', { name: 'Enable notifications', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Disable notifications', exact: true })
    .waitFor();
  assert.equal(await page.evaluate(() => Notification.permission), 'granted');
  const credential = (await context.cookies(base)).find(
    (c) => c.name === 'deck_device',
  )!;
  assert.ok(
    credential.expires > Date.now() / 1000 + 179 * 86400,
    'push cookie must survive browser close with finite lifetime',
  );
  const vapid = await page.evaluate(
    async () => (await (await fetch('/api/push')).json()).publicKey as string,
  );
  const originalOwner = JSON.parse(
    readFileSync(join(paths.webDir, 'push.json'), 'utf8'),
  ).subscriptions[0].deviceId;
  // Browser push registration would contact a real provider. Keep subscription effects fake here.
  const worker = context.serviceWorkers()[0]!;
  assert.ok(worker);
  let cdp = await context.newCDPSession(page);
  const registrations: any[] = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', (event) =>
    registrations.push(...event.registrations),
  );
  await cdp.send('ServiceWorker.enable');
  await page.waitForTimeout(100);
  const registration = registrations.find((r) => r.scopeURL === `${base}/`);
  assert.ok(registration, 'real worker registered at root');
  assert.equal(new URL(page.url()).searchParams.get('session'), id);
  await page.keyboard.press('Escape');
  // Complete a real host turn so the service worker's authenticated stale-attention check succeeds.
  driver.autoComplete = true;
  await manager.execute({
    sessionId: id,
    clientId: 'acceptance',
    command: {
      v: 1,
      commandId: randomUUID(),
      type: 'prompt.send',
      text: 'fixture',
    },
  });
  while (manager.hasRunningWork()) await Bun.sleep(20);
  const notificationSeq = [...manager.openLog(id)!.readAfter(0)]
    .filter((e) => e.kind === 'turn.completed')
    .at(-1)!.seq;
  const other = await context.newPage();
  await other.goto('about:blank');
  await page.close();
  await context.clearCookies();
  assert.equal(
    (await context.cookies(base)).length,
    0,
    'received push must show even without a session cookie',
  );
  cdp = await context.newCDPSession(other);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin: base,
    registrationId: registration.registrationId,
    data: JSON.stringify({
      sessionId: id,
      seq: notificationSeq,
      kind: 'finished',
    }),
  });
  let notices: any[] = [];
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    notices = await worker.evaluate(async () => {
      const r = (self as any).registration;
      return (await r.getNotifications()).map((n: any) => ({
        title: n.title,
        body: n.body,
        data: n.data,
      }));
    });
    if (notices.length) break;
    await Bun.sleep(50);
  }
  assert.equal(notices[0]?.body, 'The Lead is ready for you.');
  assert.equal(notices[0]?.data.sessionId, id);
  // Cold routing and responsive control, against authenticated production APIs/assets.
  await other.close();
  const cold = await context.newPage();
  // The browser retained its provider subscription while its Deck credential was cleared.
  await cold.addInitScript(
    ({ subscription, vapid }) => {
      let current = subscription;
      const browserSub = () => ({
        options: {
          applicationServerKey: Uint8Array.from(
            atob(vapid.replace(/-/g, '+').replace(/_/g, '/')),
            (c) => c.charCodeAt(0),
          ).buffer,
        },
        toJSON: () => current,
        unsubscribe: async () => true,
      });
      Object.defineProperty(PushManager.prototype, 'getSubscription', {
        value: async () => browserSub(),
      });
      Object.defineProperty(PushManager.prototype, 'subscribe', {
        value: async () => {
          current = {
            ...subscription,
            endpoint: subscription.endpoint + '-recovered',
          };
          return browserSub();
        },
      });
    },
    { subscription, vapid },
  );
  await cold.goto(`${base}/?session=${id}`);
  await cold
    .getByRole('heading', { name: /Session/ })
    .first()
    .waitFor();
  assert.equal(new URL(cold.url()).searchParams.get('session'), id);
  await cold.getByLabel('Notifications', { exact: true }).click();
  await cold
    .getByRole('button', { name: 'Enable notifications', exact: true })
    .click();
  await cold
    .getByRole('button', { name: 'Disable notifications', exact: true })
    .waitFor();
  const recovered = JSON.parse(
    readFileSync(join(paths.webDir, 'push.json'), 'utf8'),
  ).subscriptions;
  assert.equal(
    recovered.find(
      (s: any) => s.subscription.endpoint === subscription.endpoint,
    ).deviceId,
    originalOwner,
  );
  assert.notEqual(
    recovered.find((s: any) => s.subscription.endpoint.endsWith('-recovered'))
      .deviceId,
    originalOwner,
  );
  await cold.getByLabel('Notifications', {exact:true}).click();

  // The worker-to-page route changes sessions in place and retains an unsent composer draft.
  const second = await manager.execute({
    clientId: 'acceptance',
    command: {
      v: 1,
      commandId: randomUUID(),
      type: 'session.create',
      projectRoot: project,
    },
  });
  if (!second.ok) throw new Error('second session failed');
  const otherId = (second.data as any).sessionId;
  const prepare = cold.getByRole('button', {
      name: 'Prepare session',
      exact: true,
    }),
    composer = cold.getByLabel('Message the lead');
  const available = await Promise.race([
    prepare.waitFor().then(() => 'prepare'),
    composer.waitFor().then(() => 'composer'),
  ]);
  if (available === 'prepare') await prepare.click();
  await cold.getByLabel('Message the lead').fill('Unsent notification draft');
  const route = async (sessionId: string) =>
    worker.evaluate(async (id) => {
      const windows = await (self as any).clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const channel = new MessageChannel();
      const reply = new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 2000);
        channel.port1.onmessage = (event) => {
          clearTimeout(timer);
          resolve(event.data?.opened);
        };
      });
      windows[0].postMessage({ type: 'deck.open-session', sessionId: id }, [
        channel.port2,
      ]);
      return reply;
    }, sessionId);
  assert.equal(await route(otherId), true);
  await cold.waitForURL(`**/?session=${otherId}`);
  assert.equal(await route(id), true);
  await cold.waitForURL(`**/?session=${id}`);
  await cold.getByLabel('Message the lead').waitFor();
  assert.equal(
    await cold.getByLabel('Message the lead').inputValue(),
    'Unsent notification draft',
  );
  for (const width of [1440, 390, 320]) {
    await cold.setViewportSize({ width, height: 850 });
    await cold.getByLabel('Notifications', { exact: true }).click();
    await cold.getByRole('region', { name: 'Browser notifications' }).waitFor();
    assert.equal(
      await cold.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await cold.screenshot({ path: `/tmp/deck-push-${width}.png` });
    await cold.keyboard.press('Escape');
  }
  const ios = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1',
    viewport: { width: 390, height: 844 },
  });
  const phone = await ios.newPage();
  await phone.goto(base);
  await phone.getByLabel('Notifications', { exact: true }).click();
  await phone.getByText(/Add to Home Screen/).waitFor();
  assert.equal(
    await phone
      .getByRole('button', { name: 'Enable notifications', exact: true })
      .count(),
    0,
  );
  await ios.close();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        'real-service-worker-registration',
        'permission-granted',
        'CDP-simulated-push',
        'real-notification-api-without-cookie',
        'persistent-180-day-cookie',
        'cleared-cookie-safe-subscription-replacement',
        'cold-session-routing',
        'warm-routing-retains-draft',
        'desktop-mobile-control',
        'emulated-iOS-install-guidance',
      ],
      liveProviderDelivery: false,
    }),
  );
  await context.close();
} catch (error) {
  for (const context of browser?.contexts() ?? [])
    for (const page of context.pages())
      if (!page.isClosed())
        await page
          .screenshot({ path: '/tmp/deck-push-failure.png' })
          .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  control.close();
  await started.daemon.stop('acceptance');
  rmSync(root, { recursive: true, force: true });
}
