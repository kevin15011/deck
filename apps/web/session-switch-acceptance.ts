/** Production composition regression for immediate, validated session navigation.
 * Protects immediate feedback while summary/history are pending, cancellation,
 * validated delivery, failure/retry, Back, deep links and reduced motion.
 * DECK_TEST_CHROME=/snap/bin/chromium bun apps/web/session-switch-acceptance.ts
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CrossRunnerConfig } from '../../packages/core/src/config/deck-config';
import type { SessionCommandBody } from '../../packages/core/src/session/commands';
import { SessionManager } from '../../packages/session-host/src/session-manager';
import { ApprovalBroker } from '../../packages/session-host/src/approval-broker';
import { CredentialRegistry } from '../../packages/session-host/src/credentials';
import { Supervisor } from '../../packages/session-host/src/supervisor';
import { FakeDriver } from '../../packages/session-host/src/testing/fake-driver';
import { WebService } from '../../packages/session-host/src/web-service';
import { ensureStateLayout, resolveStatePaths } from '../../packages/session-host/src/paths';
import { buildWebAssets } from '../../scripts/generate-web-assets';
const WEB_ASSETS = await buildWebAssets();
mkdirSync('/tmp/deck-immediate-session-switch', { recursive: true });
mkdirSync('/tmp/deck-switch-p2', { recursive: true });

const root = realpathSync(mkdtempSync(join('/tmp', 'deck-perf-state-'))), home = join(root, 'home');
const projectOne = join(home, 'deck');
mkdirSync(projectOne, { recursive: true });
const paths = resolveStatePaths({ env: { XDG_STATE_HOME: join(root, 'state') } }); ensureStateLayout(paths);
const claude = new FakeDriver('claude'), codex = new FakeDriver('codex'), opencode = new FakeDriver('opencode'), drivers = [claude, codex, opencode];
for (const driver of drivers) driver.onStart = turn => turn.init();
const config: CrossRunnerConfig = { enabled: true, members: { lead: { runnerId: 'claude', modelId: 'Opus' }, reviewer: { runnerId: 'claude', modelId: 'Opus' }, investigate: { runnerId: 'codex', modelId: 'GPT-5.4' }, 'apply-fast': { runnerId: 'opencode', modelId: 'Sonnet' } }, approvals: { claude: 'relay', codex: 'runner-default', opencode: 'relay' }, maxConcurrentTasks: 4, claudeTosAcknowledgedAt: null, web: { port: 0, trustedProxy: null, allowedOrigins: [], allowFunnel: false } };
const catalog = { runners: [
    { runnerId: 'claude', label: 'Claude', available: true, models: [{ modelId: 'Opus', label: 'Opus', thinkingLevels: ['low', 'high'] }, { modelId: 'sonnet', label: 'Sonnet', thinkingLevels: ['low', 'high'] }] },
    { runnerId: 'codex', label: 'Codex', available: true, models: [{ modelId: 'GPT-5.4', label: 'GPT-5.4', thinkingLevels: ['low', 'high'] }] },
    { runnerId: 'opencode', label: 'OpenCode', available: true, models: [{ modelId: 'Sonnet', label: 'Sonnet', thinkingLevels: ['low', 'high'] }] },
] };
let manager!: SessionManager;
function createManager() {
    const broker = new ApprovalBroker({ sink: { emit: (sessionId, event) => { manager.openLog(sessionId)?.append(event); } } });
    return new SessionManager({ paths, broker, credentials: new CredentialRegistry({ socketPath: paths.socket.path }), supervisor: new Supervisor({ anchorCommand: ['unused'] }), drivers: { get: id => drivers.find(driver => driver.runnerId === id), list: () => drivers }, config: () => config, sessionMcpCommand: ['/not-launched/deck', 'internal', 'session-mcp'], homeDir: home, modelCatalog: async () => catalog });
}
manager = createManager();
const host = new WebService({ paths, assets: WEB_ASSETS, config: config.web, service: {
    execute: input => manager.execute(input), query: (name, args) => manager.query(name, args), openLog: id => manager.openLog(id), hasRunningWork: () => manager.hasRunningWork(),
} }); host.enable();
const browser = await chromium.launch({ executablePath: process.env.DECK_TEST_CHROME ?? '/snap/bin/chromium', headless: true });
const command = async (body: SessionCommandBody, sessionId?: string) => {
    const result = await manager.execute({ sessionId, clientId: 'acceptance', command: { v: 1, commandId: randomUUID(), ...body } as never });
    assert.equal(result.ok, true, JSON.stringify(result)); return result.ok ? result.data as any : undefined;
};



const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
context.setDefaultTimeout(8000);
if (process.env.DECK_SWITCH_TRACE) await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
await context.addInitScript(() => {
    localStorage.setItem('deck.content-mode', 'both');
    const w = window as any;
    w.switchTimes = []; w.staleFlashes = [];
    const sampleFrame = () => {
        const content = document.querySelector<HTMLElement>('.history-content'), title = document.querySelector('.session-identity h1')?.textContent;
        const text = document.querySelector('.history-row')?.textContent;
        if (content && getComputedStyle(content).visibility !== 'hidden' && text && ['Alpha','Beta','Gamma'].includes(title ?? '') && !text.includes(title!)) w.staleFlashes.push({ title, text });
        requestAnimationFrame(sampleFrame);
    }; requestAnimationFrame(sampleFrame);
    document.addEventListener('click', event => {
        const button = (event.target as Element).closest('button.session');
        if (button) w.switchTimes.push({ name: button.getAttribute('aria-label'), click: performance.now() });
    }, true);
    new MutationObserver(() => {
        const sample = w.switchTimes.at(-1);
        if (!sample) return;
        if (!sample.selected && document.querySelector('button.session.selected')?.getAttribute('aria-label') === sample.name) sample.selected = performance.now();
        if (!sample.loading && document.querySelector('.session-loading')) sample.loading = performance.now();
        if (!sample.ready && !document.querySelector('.session-loading') && document.querySelector('.history-row')?.textContent?.includes(sample.name)) sample.ready = performance.now();
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-current'] });
});
const page = await context.newPage(), errors: string[] = [], requests: string[] = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => requests.push(request.url()));
const ids: Record<string, string> = {};
type Gate = { seen: Promise<void>; release: () => void };
async function hold(id: string, resource: string, failure?: number): Promise<Gate> {
    let release!: () => void, seen!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const observed = new Promise<void>(resolve => { seen = resolve; });
    await page.route(`**/api/sessions/${id}/${resource}`,  async route => {
        seen(); await waiting;
        try {
            if (failure) await route.fulfill({ status: failure, contentType: 'application/json', body: JSON.stringify({ ok: false, message: 'Controlled load failure' }) });
            else await route.continue();
        } catch { /* An aborted navigation owns no response. */ }
        await page.unroute(`**/api/sessions/${id}/${resource}`);
    });
    return { seen: observed, release };
}
const select = (name: string) => page.locator('.sidebar button.session').filter({ hasText: name }).click();
const ready = async (name: string) => {
    await page.waitForFunction(name => !document.querySelector('.session-loading') && document.querySelector('.session-identity h1')?.textContent === name && document.querySelector('.history-row')?.textContent?.includes(name) && !!document.querySelector('.connection-dot.ready'), name);
};
const blocked = () => page.evaluate(() => {
    const prompt = document.querySelector<HTMLTextAreaElement>('#prompt');
    return !prompt || prompt.disabled || !!prompt.closest('[inert]');
});
try {
    const projectId = (await command({ type: 'project.register', path: projectOne, name: 'Switch acceptance' })).project.projectId;
    for (const name of ['Alpha', 'Beta', 'Gamma', 'Empty']) {
        const id = (await command({ type: 'session.create', projectId, title: name })).sessionId;
        ids[name] = id; await command({ type: 'session.prepare' }, id);
        if(name !== 'Empty') manager.openLog(id)!.append({ kind: 'message.completed', source: { taskId: 'lead', memberId: 'lead', runnerId: 'claude' }, data: { role: 'assistant', text: `${name} session content` } });
    }
    if (!process.env.DECK_SWITCH_P2_ONLY) {
    await page.goto(`${host.status().url!}?session=${ids.Alpha}`); await ready('Alpha'); console.log('Loaded Alpha');
    const summary = await hold(ids.Beta!, 'summary'), history = await hold(ids.Beta!, 'history');
    const selectionPath = await page.locator('.sidebar .session-selection-plane path').getAttribute('d');
    await select('Beta'); await summary.seen; console.log('Beta summary held; selected:', await page.locator('.sidebar button.session.selected').getAttribute('aria-label'));
    // RED: this public selection must change while the server response is held.
    await page.waitForFunction(() => document.querySelector('.sidebar button.session.selected')?.getAttribute('aria-label') === 'Beta', undefined, { timeout: 1000 });
    await page.waitForFunction(before => document.querySelector('.sidebar .session-selection-plane path')?.getAttribute('d') !== before, selectionPath);
    assert.equal(await page.locator('.session-loading').isVisible(), true, 'real pending summary shows loading feedback');
    assert.equal(await page.locator('.session-identity h1').textContent(), 'Beta');
    assert.equal(await page.locator('.history-content').isVisible(), false, 'old transcript must not appear under target identity');
    assert.equal(await blocked(), true, 'old composer cannot send');
    assert.equal(requests.some(url => url.includes(`/sessions/${ids.Beta}/history`)), false, 'history waits for summary validation');
    await page.screenshot({ path: '/tmp/deck-immediate-session-switch/loading-desktop.png' });
    summary.release(); await history.seen;
    assert.equal(await page.locator('.session-loading').isVisible(), true, 'history pending keeps loading visible');
    assert.equal(await blocked(), true);
    history.release(); await ready('Beta');
    console.log('PASS immediate selection, validated summary/history, stale transcript and composer isolation');
    // A failed late summary cannot replace a newer successful route or its error.
    const lateSummary = await hold(ids.Gamma!, 'summary', 503);
    await select('Gamma'); await lateSummary.seen;
    await select('Alpha'); await ready('Alpha'); lateSummary.release();
    await page.waitForTimeout(120);
    assert.equal(await page.locator('.session-identity h1').textContent(), 'Alpha');
    assert.equal(await page.locator('.session-loading').count(), 0);
    assert.equal(requests.some(url=>url.includes(`/sessions/${ids.Gamma}/history`)), false);
    console.log('PASS rapid switch cancels delayed summary and failure');

    const backSummary = await hold(ids.Beta!, 'summary');
    await select('Beta'); await backSummary.seen;
    await page.goBack(); await ready('Alpha'); backSummary.release();
    await page.waitForTimeout(120); await ready('Alpha');
    console.log('PASS Back while summary pending');

    const lateHistory = await hold(ids.Beta!, 'history');
    await select('Beta'); await lateHistory.seen;
    await select('Gamma'); await ready('Gamma'); lateHistory.release();
    await page.waitForTimeout(120); await ready('Gamma');
    console.log('PASS rapid switch cancels delayed history');

    const failed = await hold(ids.Beta!, 'summary', 503);
    const historyBefore = requests.filter(url=>url.includes(`/sessions/${ids.Beta}/history`)).length;
    await select('Beta'); await failed.seen; failed.release();
    await page.getByRole('button', {name:'Retry conversation'}).waitFor();
    assert.equal(await blocked(), true);
    assert.equal(requests.filter(url=>url.includes(`/sessions/${ids.Beta}/history`)).length, historyBefore, 'failed summary never enables history');
    // Exercise the form boundary even if an old DOM reference submits programmatically.
    const commandsBefore = requests.filter(url=>url.endsWith('/api/commands')).length;
    await page.evaluate(()=>document.querySelector<HTMLFormElement>('#prompt-composer')?.requestSubmit());
    assert.equal(requests.filter(url=>url.endsWith('/api/commands')).length, commandsBefore);
    await page.getByRole('button', {name:'Retry conversation'}).click(); await ready('Beta');
    console.log('PASS summary failure, no unvalidated delivery, retry');

    const failedHistory = await hold(ids.Alpha!, 'history', 503);
    await select('Alpha'); await failedHistory.seen; failedHistory.release();
    await page.getByRole('button', {name:'Retry conversation'}).waitFor();
    assert.equal(await blocked(), true);
    await page.getByRole('button', {name:'Retry conversation'}).click(); await ready('Alpha');
    console.log('PASS initial history failure and retry');
    await select('Empty');
    await page.waitForFunction(()=>!document.querySelector('.session-loading') && document.querySelector('.session-identity h1')?.textContent==='Empty' && !!document.querySelector('.connection-dot.ready'));
    assert.equal(await page.getByRole('heading',{name:'What are we working on?'}).isVisible(),true);
    await select('Alpha'); await ready('Alpha');
    console.log('PASS a loaded empty session reveals its real empty state');


    // Measured repeated held responses: no minimum spinner duration, no network wait
    // before selection. The workload is a brief actual SessionManager transcript.
    for (const name of ['Beta','Alpha','Beta']) {
        const gate = await hold(ids[name]!, 'summary');
        await page.locator('.sidebar button.session').filter({hasText:name}).focus();
        await page.keyboard.press('Enter'); await gate.seen;
        await page.waitForFunction(name=>document.querySelector('.sidebar button.session.selected')?.getAttribute('aria-label')===name, name);
        await page.waitForTimeout(600); gate.release(); await ready(name);
    }
    const timings = await page.evaluate(()=>(window as any).switchTimes);
    console.log('TIMINGS', JSON.stringify(timings.map((s:any)=>({name:s.name,selectedMs:s.selected-s.click,loadingMs:s.loading-s.click,readyMs:s.ready-s.click}))));
    assert.equal((await page.evaluate(()=>(window as any).staleFlashes)).length, 0, 'no painted frame mislabels stale content');

    const missing = await context.newPage(); missing.on('pageerror',error=>errors.push(error.message));
    await missing.goto(`${host.status().url!}?session=does-not-exist`);
    await missing.waitForFunction(()=>!new URL(location.href).searchParams.has('session') && !document.querySelector('.session-loading'));
    assert.equal(await missing.getByRole('alert').textContent(), 'This session is no longer available.');
    await missing.close();
    const denied = await context.newPage(); denied.on('pageerror',error=>errors.push(error.message));
    let deniedHistory = false;
    denied.on('request',r=>{if(r.url().includes(`/sessions/${ids.Gamma}/history`))deniedHistory=true;});
    await denied.route(`**/api/sessions/${ids.Gamma}/summary`,route=>route.fulfill({status:401,contentType:'application/json',body:'{"ok":false}'}));
    await denied.goto(`${host.status().url!}?session=${ids.Gamma}`);
    await denied.getByRole('heading', {name:'Could not open your workspace'}).waitFor();
    assert.equal(deniedHistory,false); await denied.close();
    console.log('PASS not found and summary authorization rejection');

    await page.setViewportSize({width:390,height:844});
    await page.getByRole('tab',{name:'Activity',exact:true}).click();
    await page.getByRole('button',{name:'Open sessions',exact:true}).click();
    await page.getByRole('dialog',{name:'Workspace',exact:true}).waitFor();
    const mobile = await hold(ids.Gamma!, 'summary');
    await page.locator('.session-drawer button.session').filter({hasText:'Gamma'}).click(); await mobile.seen;
    await page.locator('.session-loading').waitFor();
    assert.equal(await page.getByRole('dialog',{name:'Workspace',exact:true}).isVisible(),false);
    assert.equal(await blocked(),true);
    await page.screenshot({path:'/tmp/deck-immediate-session-switch/loading-mobile.png'});
    const moving = await page.locator('.session-loading-trace').evaluate(node=>getComputedStyle(node).strokeDashoffset);
    await page.waitForTimeout(100);
    assert.notEqual(await page.locator('.session-loading-trace').evaluate(node=>getComputedStyle(node).strokeDashoffset),moving);
    await page.emulateMedia({reducedMotion:'reduce'});
    const staticTrace = await page.locator('.session-loading-trace').evaluate(node=>getComputedStyle(node).strokeDashoffset);
    await page.waitForTimeout(120);
    assert.equal(await page.locator('.session-loading-trace').evaluate(node=>getComputedStyle(node).strokeDashoffset),staticTrace);
    mobile.release(); await ready('Gamma');
    await page.getByRole('tab',{name:'Activity',exact:true}).click();
    await page.getByRole('tabpanel',{name:'Activity',exact:true}).waitFor();
    await page.getByRole('tab',{name:'Chat',exact:true}).click(); await ready('Gamma');
    console.log('PASS mobile Activity-to-session selection, drawer dismissal, GSAP trace and dynamic reduced motion');
    }

    // Protect visible recovery in the chosen mode and approval data ownership.
    // RED diagnostics collect both independent regressions before asserting.
    const red = !!process.env.DECK_SWITCH_P2_RED;
    const observations: Record<string, unknown>[] = [];
    const feedback = async (label: string) => {
        const loading = page.locator('.session-loading');
        const status = page.getByRole('status').filter({hasText: /Opening conversation|Could not open conversation/});
        const state = { label, visible: await loading.isVisible(), accessibleStatuses: await status.count() };
        observations.push(state); console.log('P2_FEEDBACK', JSON.stringify(state));
        if (!red) { assert.equal(state.visible, true, label); assert.equal(state.accessibleStatuses, 1, 'one accessible loading announcement'); }
    };
    const retryWithKeyboard = async () => {
        const retry = page.getByRole('button', {name:'Retry conversation',exact:true});
        await retry.waitFor();
        // Prove native Tab order reaches recovery, not merely programmatic focus.
        for (let i=0; i<45 && !await retry.evaluate(node=>node===document.activeElement); i++) await page.keyboard.press('Tab');
        assert.equal(await retry.evaluate(node=>node===document.activeElement),true,'Retry is keyboard reachable');
        await page.keyboard.press('Enter');
    };
    const assertNoSend = async () => {
        const before = requests.filter(url=>url.endsWith('/api/commands')).length;
        await page.evaluate(()=>{
            const prompt=document.querySelector<HTMLTextAreaElement>('#prompt');
            if(prompt) { const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!; setter.call(prompt,'must not be sent'); prompt.dispatchEvent(new Event('input',{bubbles:true})); }
        });
        await page.evaluate(()=>document.querySelector<HTMLFormElement>('#prompt-composer')?.requestSubmit());
        await page.waitForTimeout(40);
        assert.equal(requests.filter(url=>url.endsWith('/api/commands')).length,before,'unresolved owner cannot send');
    };
    await page.setViewportSize({width:1440,height:900});
    await page.goto(`${host.status().url!}?session=${ids.Alpha}`); await ready('Alpha');
    await page.getByRole('button',{name:'Workspace',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.chat-pane[data-view-exiting]'));
    const desktopSummary = await hold(ids.Beta!, 'summary', 503);
    await select('Beta'); await desktopSummary.seen;
    await feedback('desktop workspace summary pending'); await assertNoSend();
    assert.equal(await page.getByRole('button',{name:'Workspace',exact:true}).getAttribute('aria-pressed'),'true');
    desktopSummary.release();
    await page.waitForFunction(()=>document.querySelector('.session-loading')?.textContent?.includes('Could not open'));
    await feedback('desktop workspace summary failure');
    await page.screenshot({path:'/tmp/deck-switch-p2/desktop-error.png'});
    if (!red) { await retryWithKeyboard(); await ready('Beta'); }
    else { await select('Gamma'); await ready('Gamma'); }
    const desktopHistory = await hold(ids.Alpha!, 'history', 503);
    await select('Alpha'); await desktopHistory.seen;
    await feedback('desktop workspace history pending'); await assertNoSend(); desktopHistory.release();
    await page.waitForFunction(()=>document.querySelector('.session-loading')?.textContent?.includes('Could not open'));
    await feedback('desktop workspace history failure');
    if (!red) { await page.getByRole('button',{name:'Retry conversation'}).click(); await ready('Alpha'); }
    else { await select('Beta'); await ready('Beta'); }
    assert.equal(await page.getByRole('button',{name:'Workspace',exact:true}).getAttribute('aria-pressed'),'true');
    if(!red) console.log('PASS desktop workspace-only summary/history recovery and retained mode');

    // Seed a real pending broker approval in Alpha via the real fake-driver edge.
    await command({type:'prompt.send',text:'Alpha approval setup'},ids.Alpha);
    for(let i=0;i<100 && !claude.turns.some(turn=>turn.input.prompt==='Alpha approval setup');i++) await Bun.sleep(10);
    const turn = claude.turns.find(turn=>turn.input.prompt==='Alpha approval setup')!;
    assert.ok(turn,'Alpha driver turn started');
    const pending = turn.io.approval({approvalId:randomUUID(),tool:'Bash',toolKey:'claude:Bash',risk:'high',exactKey:'printf departing-alpha-secret',identity:JSON.stringify({command:'printf departing-alpha-secret',cwd:projectOne}),summary:'Departing Alpha approval details',input:{command:'printf departing-alpha-secret'}});
    void pending.catch(()=>{});
    await page.setViewportSize({width:390,height:844});
    await page.goto(`${host.status().url!}?session=${ids.Beta}`); await ready('Beta');
    await page.getByRole('tab',{name:'Activity',exact:true}).click();
    // The supported notification navigation edge creates a session entry
    // directly, so Back restores Activity without an intervening drawer entry.
    await page.evaluate(sessionId=>navigator.serviceWorker.dispatchEvent(new MessageEvent('message',{data:{type:'deck.open-session',sessionId}})),ids.Alpha);
    await ready('Alpha');
    await page.getByRole('article',{name:'Approval for Bash',exact:true}).waitFor();
    const mobileSummary = await hold(ids.Beta!, 'summary',503);
    await page.goBack(); await mobileSummary.seen;
    await page.getByRole('tab',{name:'Activity',exact:true,selected:true}).waitFor();
    const staleApprovals = await page.locator('.mobile-approval-overlay').count();
    observations.push({label:'mobile Back Activity departing approval',staleApprovals});
    console.log('P2_OWNERSHIP', JSON.stringify(observations.at(-1)));
    if(!red) assert.equal(staleApprovals,0,'departing approval details must not be mounted under target identity');
    await feedback('mobile Activity summary pending'); await assertNoSend();
    mobileSummary.release();
    await page.waitForFunction(()=>document.querySelector('.session-loading')?.textContent?.includes('Could not open'));
    await feedback('mobile Activity summary failure');
    await page.screenshot({path:'/tmp/deck-switch-p2/mobile-error.png'});
    if (!red) {
        const mobileHistory=await hold(ids.Beta!, 'history',503);
        await retryWithKeyboard(); await mobileHistory.seen;
        await feedback('mobile Activity retry history pending'); await assertNoSend();
        assert.equal(await page.locator('.mobile-approval-overlay').count(),0);
        mobileHistory.release();
        await page.waitForFunction(()=>document.querySelector('.session-loading')?.textContent?.includes('Could not open'));
        await feedback('mobile Activity history failure');
        await page.getByRole('button',{name:'Retry conversation'}).click(); await ready('Beta');
        assert.equal(await page.getByRole('tab',{name:'Activity',exact:true}).getAttribute('aria-selected'),'true');
        assert.equal(await page.locator('.mobile-approval-overlay').count(),0);
        // Forward owns Alpha again; its own approval remains available. Back
        // restores Beta Activity, including under a second held summary.
        await page.goForward(); await ready('Alpha');
        await page.getByRole('article',{name:'Approval for Bash',exact:true}).waitFor();
        const second=await hold(ids.Beta!, 'summary');
        await page.goBack(); await second.seen; await feedback('mobile repeated Back Activity pending');
        assert.equal(await page.locator('.mobile-approval-overlay').count(),0);
        await page.emulateMedia({reducedMotion:'reduce'});
        const offset=await page.locator('.session-loading-trace').evaluate(node=>getComputedStyle(node).strokeDashoffset);
        await page.waitForTimeout(100);
        assert.equal(await page.locator('.session-loading-trace').evaluate(node=>getComputedStyle(node).strokeDashoffset),offset);
        await page.screenshot({path:'/tmp/deck-switch-p2/mobile-pending.png'});
        second.release(); await ready('Beta');
        console.log('PASS mobile Activity Back/Forward, real departing approval isolation, summary/history recovery, keyboard/pointer retry, reduced motion');
    }
    console.log('P2_OBSERVATIONS',JSON.stringify(observations));
    if(red) assert.equal(observations.every(item=>item.visible!==false && item.staleApprovals!==1),true,'P2 browser regression reproduced');
    assert.deepEqual(errors,[]);

} finally {
    if (process.env.DECK_SWITCH_TRACE) await context.tracing.stop({ path: process.env.DECK_SWITCH_TRACE });
    await browser.close(); host.disable(); await manager.close(); rmSync(root, { recursive: true, force: true });
}
