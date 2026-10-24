/** Real Chromium worker/permission/notification flow; provider delivery is simulated through CDP. */
import { chromium, type Page } from '@playwright/test';
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
async function openNotifications(page: Page) {
  const mobile = (page.viewportSize()?.width ?? 1440) <= 1000;
  await page.getByRole('button', {name:mobile ? 'Open sessions' : 'Deck menu',exact:true}).click();
  await page.getByRole(mobile ? 'button' : 'menuitem', {name:/Notifications/}).click();
}
try {
  browser = await chromium.launch({
    executablePath: process.env.DECK_TEST_CHROME ?? '/snap/bin/chromium',
    headless: true,
    // Use Chromium's notification center: Linux desktop portals may immediately
    // dismiss headless notifications, making getNotifications nondeterministic.
    args: ['--no-sandbox','--disable-features=NativeNotifications'],
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
  await openNotifications(page);
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
  const approvalSetting=page.getByRole('checkbox',{name:'Answer approvals from notifications'});
  assert.equal(await approvalSetting.isChecked(),false);
  await approvalSetting.check();
  await page.getByText('Approval actions are on for this browser where supported.',{exact:true}).waitFor();
  await page.reload();
  await openNotifications(page);
  assert.equal(await page.getByRole('checkbox',{name:'Answer approvals from notifications'}).isChecked(),true);
  await page.getByRole('checkbox',{name:'Answer approvals from notifications'}).uncheck();
  await page.getByText('Approval actions are off for this browser.',{exact:true}).waitFor();
  await page.evaluate(()=>{
    (window as any).__originalCachePut=Cache.prototype.put;
    Cache.prototype.put=async()=>{throw Error('test storage unavailable');};
  });
  await page.getByRole('checkbox',{name:'Answer approvals from notifications'}).click();
  await page.getByText('Could not save approval actions. Check browser storage settings and retry.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('checkbox',{name:'Answer approvals from notifications'}).isChecked(),false);
  await page.evaluate(()=>{Cache.prototype.put=(window as any).__originalCachePut;});
  await page.getByRole('checkbox',{name:'Answer approvals from notifications'}).check();
  await page.getByText('Approval actions are on for this browser where supported.',{exact:true}).waitFor();
  await page.keyboard.press('Escape');
  async function checkApprovalAction(page:Page) {
    // Exercise a real worker action with the browser's HttpOnly cookie and the
    // production command/broker/event path. Provider delivery alone is simulated.
    driver.autoComplete=false;
    cdp=await context.newCDPSession(page);
    await cdp.send('ServiceWorker.enable');
    const before=driver.turns.length;
    await manager.execute({sessionId:id,clientId:'acceptance',command:{v:1,commandId:randomUUID(),type:'prompt.send',text:'approval fixture'}});
    while(driver.turns.length===before)await Bun.sleep(20);
    const approvalTurn=driver.turns.at(-1)!;approvalTurn.init();
    const approvalResult=approvalTurn.io.approval({approvalId:'native',tool:'Bash',toolKey:'claude:Bash',risk:'normal',summary:'private command'});
    const requested=[...manager.openLog(id)!.readAfter(0)].filter(e=>e.kind==='approval.requested').at(-1)!;
    const approvalId=requested.data.approvalId as string;
    await page.getByRole('button',{name:'Allow once',exact:true}).waitFor();
    // Stop the app's presence acknowledgements from clearing the test notification.
    const background=await context.newPage();await background.goto('about:blank');await background.bringToFront();
    await cdp.send('ServiceWorker.deliverPushMessage',{origin:base,registrationId:registration.registrationId,data:JSON.stringify({sessionId:id,seq:requested.seq,kind:'approval',approvalId,tool:'Bash',risk:'normal'})});
    const approvalDeadline=Date.now()+8000;
    while(Date.now()<approvalDeadline && !await worker.evaluate(async()=> (await (self as any).registration.getNotifications()).some((n:any)=>n.data.approvalId)))await Bun.sleep(30);
    const actionable=await worker.evaluate(async()=>{
      const n=(await (self as any).registration.getNotifications()).find((n:any)=>n.data.approvalId);
      return n ? {title:n.title,actions:n.actions.map((a:any)=>a.action)} : null;
    });
    assert.deepEqual(actionable,{title:'Allow Bash once?',actions:['allow','deny']});
    await worker.evaluate(async()=>{
      const n=(await (self as any).registration.getNotifications()).find((n:any)=>n.data.approvalId);
      (self as any).dispatchEvent(new (self as any).NotificationEvent('notificationclick',{notification:n,action:'allow'}));
    });
    const answer=await Promise.race([approvalResult,Bun.sleep(10000).then(()=>{throw Error('worker approval response timed out');})]);
    assert.deepEqual(answer,{decision:'allow',scope:'once'});
    await page.bringToFront();await background.close();
    await page.getByRole('button',{name:'Allow once',exact:true}).waitFor({state:'hidden'});
    assert.equal(await worker.evaluate(async()=> (await (self as any).registration.getNotifications()).filter((n:any)=>n.data.approvalId).length),0);
    approvalTurn.finish();while(manager.hasRunningWork())await Bun.sleep(20);
    driver.autoComplete=true;
    console.log('PASS opt-in persists and real worker action resolves the approval card through authenticated HTTP');
  }
  // Complete a real host turn; received pushes must display without further auth checks.
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
  // Real registration replacement and counting, with no app window open.
  await worker.evaluate(() => {
    (self as any).__badges = [];
    Object.defineProperty((self as any).navigator, 'setAppBadge', {configurable:true,value:async(count:number)=>(self as any).__badges.push(count)});
    Object.defineProperty((self as any).navigator, 'clearAppBadge', {configurable:true,value:async()=>(self as any).__badges.push(0)});
  });
  const readNotices = (): Promise<any[]> => worker.evaluate(async () => (await (self as any).registration.getNotifications()).map((n:any)=>({title:n.title,body:n.body,tag:n.tag,data:n.data,renotify:n.renotify})));
  const deliver = async (data:Record<string,unknown>) => {
    await cdp.send('ServiceWorker.deliverPushMessage',{origin:base,registrationId:registration.registrationId,data:JSON.stringify(data)});
  };
  for(const seq of [notificationSeq+1,notificationSeq+2]) {
    await deliver({sessionId:id,seq,kind:'finished',sessionName:'Push acceptance',summary:`Latest reply ${seq}`,replyId:`reply-${seq}-1`});
    const until=Date.now()+8000;
    while(Date.now()<until && !(await readNotices()).some(n=>n.data.seq===seq))await Bun.sleep(30);
  }
  const grouped=await readNotices();
  assert.equal(grouped.length,1);assert.equal(grouped[0].data.count,3);
  assert.equal(grouped[0].title,'3 new replies · Push acceptance');
  assert.equal(grouped[0].body,`Latest reply ${notificationSeq+2}`);
  assert.equal(grouped[0].renotify,true);
  await deliver({sessionId:id,seq:notificationSeq+3,kind:'question',attention:'decision',tagId:'abcdefghijklmnop'});
  await deliver({sessionId:id,seq:notificationSeq+4,kind:'approval'});
  await deliver({sessionId:'other-session',seq:1,kind:'finished'});
  const until=Date.now()+8000;
  while(Date.now()<until && (await readNotices()).length<4)await Bun.sleep(30);
  assert.equal((await readNotices()).length,4,JSON.stringify(await readNotices()));
  assert.equal(await worker.evaluate(()=>(self as any).__badges.at(-1)),6);
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
  await cold.bringToFront();
  await cold.locator('#conversation').waitFor();
  assert.equal(new URL(cold.url()).searchParams.get('session'), id);
  const cleared=Date.now()+8000;
  while(Date.now()<cleared && (await readNotices()).some(n=>n.data.sessionId===id))await Bun.sleep(30);
  assert.deepEqual((await readNotices()).map(n=>n.data.sessionId),['other-session']);
  assert.equal(await worker.evaluate(()=>(self as any).__badges.at(-1)),1);
  await openNotifications(cold);
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
  await cold.getByRole('button',{name:'Done',exact:true}).click();
  await checkApprovalAction(cold);

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
    await openNotifications(cold);
    await cold.getByRole('dialog', { name: 'Notifications',exact:true }).waitFor();
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
  await openNotifications(phone);
  await phone.getByRole('status').filter({hasText:/Add to Home Screen/}).waitFor();
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
        'approval-opt-in-default-off-persists-and-rolls-back-storage-errors',
        'real-worker-action-authenticated-http-resolves-approval-card',
        'CDP-simulated-push',
        'real-notification-api-without-cookie',
        'grouped-replies-count-latest-preview-renotify',
        'separate-decisions-approvals-and-session-tags',
        'visible-session-clears-only-local-session-notifications',
        'badge-total-and-session-clear-with-fake-OS-effects',
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
