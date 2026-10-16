/** Real HTTP/WebSocket + persistent SessionManager acceptance; only native inference is faked. */
import { chromium, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
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
import { WEB_ASSETS } from '../cli/src/runtime/web-assets.generated';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-workspace-browser-'))), home = join(root, 'home');
const projectOne = join(home, 'project-one'), projectTwo = join(home, 'project-two');
mkdirSync(projectOne, { recursive: true }); mkdirSync(projectTwo, { recursive: true });
const nestedDirectory = join(projectOne, 'nested folder', 'leaf');
mkdirSync(nestedDirectory, { recursive: true });
const paths = resolveStatePaths({ env: { XDG_STATE_HOME: join(root, 'state') } }); ensureStateLayout(paths);
const claude = new FakeDriver('claude'), codex = new FakeDriver('codex'), drivers = [claude, codex];
for (const driver of drivers) driver.onStart = turn => turn.init();
const config: CrossRunnerConfig = { enabled: true, members: { lead: { runnerId: 'claude', modelId: 'opus' }, reviewer: { runnerId: 'claude', modelId: 'opus' } }, approvals: { claude: 'relay', codex: 'runner-default', opencode: 'relay' }, maxConcurrentTasks: 4, claudeTosAcknowledgedAt: null, web: { port: 0, trustedProxy: null, allowedOrigins: [], allowFunnel: false } };
const catalog = { runners: [
    { runnerId: 'claude', label: 'Claude', available: true, models: [{ modelId: 'opus', label: 'Opus', thinkingLevels: ['low', 'high'] }, { modelId: 'sonnet', label: 'Sonnet', thinkingLevels: ['low', 'high'] }] },
    { runnerId: 'codex', label: 'Codex', available: true, models: [{ modelId: 'codex-model', label: 'Codex model', thinkingLevels: ['low', 'high'] }] },
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
const browser = await chromium.launch({ executablePath: process.env.DECK_TEST_CHROME ?? join(homedir(), 'Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), headless: true });
const command = async (body: SessionCommandBody, sessionId?: string) => {
    const result = await manager.execute({ sessionId, clientId: 'acceptance', command: { v: 1, commandId: randomUUID(), ...body } as never });
    assert.equal(result.ok, true, JSON.stringify(result)); return result.ok ? result.data as any : undefined;
};
const wait = async (condition: () => boolean | Promise<boolean>, label: string) => {
    for (let attempt = 0; attempt < 160; attempt++) { if (await condition()) return; await Bun.sleep(25); }
    throw new Error(`Timed out: ${label}`);
};
const bounds = async (page: Page) => assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1 || document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollHeight > innerHeight + 1), false, 'Workspace must fit the viewport');
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true }), page = await context.newPage();
page.setDefaultTimeout(7000);
const checks: string[] = [];
try {
    const project = (await command({ type: 'project.register', path: projectOne, name: 'Status workspace' })).project.projectId;
    const first = (await command({ type: 'session.create', projectId: project, title: 'Lead discussion' })).sessionId;
    const second = (await command({ type: 'session.create', projectId: project, title: 'Background review' })).sessionId;
    const run = async (id: string, text = 'Review the workspace') => {
        const previous = claude.turns.length;
        await command({ type: 'prompt.send', text }, id);
        await wait(() => claude.turns.length > previous, 'live turn');
        return claude.turns[previous]!;
    };
    const seed = await run(first);
    for (let i = 0; i < 16; i++) seed.say(`Historical answer ${i}\n\n${'Detailed actual reported answer. '.repeat(40)}`);
    seed.finish(); await wait(() => !manager.hasRunningWork(), 'history seed completed');
    await page.goto(host.status().url!); await page.bringToFront();
    await page.evaluate(() => { (window as any).scrollEvidence=[]; document.addEventListener('scroll', event => { const el=event.target; if (el instanceof HTMLElement && el.classList.contains('conversation')) (window as any).scrollEvidence.push({top:el.scrollTop,height:el.scrollHeight,viewport:el.clientHeight,title:document.querySelector('h1')?.textContent}); },true); });
    const nav = page.getByRole('navigation', { name: 'Sessions', exact: true });
    const row = (name: string) => nav.getByRole('button', { name, exact: true });
    const conversation = page.getByRole('region', { name: 'Conversation', exact: true });
    const bottom = () => conversation.evaluate(element => !!element.querySelector('[data-reply-seq]') && element.scrollHeight - element.scrollTop - element.clientHeight < 3);
    const read = async (key: string) => page.evaluate(key => JSON.parse(localStorage.getItem('deck.read-replies') ?? '{}')[key] ?? 0, key);
    await row('Lead discussion').waitFor();
    await wait(async () => await row('Lead discussion').locator('[data-unread]').count() === 1, 'historical unseen reply');
    await row('Lead discussion').click(); await wait(bottom, 'first history opens at latest');
    await wait(async () => await read(first) > 0, 'visible focused latest reply acknowledged');
    assert.equal(await row('Lead discussion').locator('[data-unread]').count(), 0);
    checks.push('initial-hydration-latest-and-exact-visible-read');

    const turn = await run(first, 'More work');
    await wait(async () => await row('Lead discussion').locator('[data-state="working"]').count() === 1, 'actual Lead working');
    const chatBounds = await conversation.boundingBox(); assert.ok(chatBounds);
    await page.mouse.move(chatBounds.x + chatBounds.width / 2, chatBounds.y + chatBounds.height / 2);
    await page.mouse.wheel(0, -200000);
    await wait(async () => await conversation.evaluate(element => element.scrollTop === 0), 'reader settled at older messages');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const markerBefore = await read(first);
    turn.say('Unread while reading older messages');
    await page.getByText('Unread while reading older messages', { exact: true }).waitFor({ state: 'attached' });
    await wait(async () => await row('Lead discussion').locator('[data-unread]').count() === 1, 'work and unread coexist');
    assert.equal(await row('Lead discussion').locator('[data-state="working"]').count(), 1);
    assert.equal(await read(first), markerBefore);
    assert.equal(await conversation.evaluate(element => element.scrollTop), 0, 'new answer preserves manual older reading');
    turn.finish(); await wait(() => !manager.hasRunningWork(), 'Lead settled');
    await wait(async () => await row('Lead discussion').locator('[data-state="completed"][data-unread]').count() === 1, 'static completed plus unread');
    checks.push('working-plus-unread-and-upward-reading-preserved');

    const background = await run(second); background.say('Background completed response'); background.finish();
    await wait(() => !manager.hasRunningWork(), 'background settled');
    await wait(async () => await row('Background review').locator('[data-unread]').count() === 1, 'background poll detects real Lead reply');
    await page.screenshot({ path: '/tmp/deck-status-sidebar-unread.png', fullPage: true });
    assert.equal(await read(second), 0);
    await row('Background review').click(); await wait(async () => await read(second) > 0, 'background response now visibly read');
    // Re-enter a previously scrolled-up chat through a deliberately delayed real replay.
    let release!: () => void, captured!: () => void;
    const delay = new Promise<void>(resolve => { release = resolve; }), requested = new Promise<void>(resolve => { captured = resolve; });
    await page.route(`**/api/sessions/${first}/events?after=0`, async route => { const response = await route.fetch(); captured(); await delay; await route.fulfill({ response }); });
    await row('Lead discussion').click(); await requested;
    assert.equal(await read(first), markerBefore, 'selection before delayed history is not reading');
    release(); await wait(bottom, 'switch to prior older-reading chat lands at latest after replay');
    await wait(async () => await read(first) > markerBefore, 'delayed latest response visibly read');
    await page.unroute(`**/api/sessions/${first}/events?after=0`);
    checks.push('background-status-and-delayed-switch-always-latest');

    const modalTurn = await run(first, 'Dialog visibility');
    await nav.getByRole('button', { name: 'Add project', exact: true }).click();
    const beforeModal = await read(first); modalTurn.say('Response behind modal');
    await page.getByText('Response behind modal', { exact: true }).waitFor({ state: 'attached' });
    await Bun.sleep(150); assert.equal(await read(first), beforeModal);
    await page.getByRole('dialog').press('Escape'); await wait(async () => await read(first) > beforeModal, 'read after modal dismissed');
    const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    const other = await context.newPage(); await other.goto('about:blank'); await other.bringToFront();
    await wait(async () => !(await page.evaluate(() => document.hasFocus())), 'actual browser document blurred');
    const beforeBlur = await read(first); modalTurn.say('Response while page blurred');
    await page.getByText('Response while page blurred', { exact: true }).waitFor({ state: 'attached' });
    await Bun.sleep(150); assert.equal(await read(first), beforeBlur, 'blurred page never reads');
    await page.bringToFront(); await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }); await wait(async () => await read(first) > beforeBlur, 'focus acknowledges visible response'); await other.close();
    checks.push('modal-and-blurred-page-do-not-read');

    const delegated = await manager.callTaskTool({ sessionId: first, taskId: 'lead', memberId: 'lead', runnerId: 'claude' } as never, 'deck_delegate', { agent: 'reviewer', task: 'Review the changes' });
    assert.equal(delegated.ok, true); const childId = delegated.ok ? (delegated.data as any).taskId : '';
    await wait(() => claude.turns.some(turn => turn.input.taskId === childId), 'real delegated turn');
    const child = claude.turns.find(turn => turn.input.taskId === childId)!; child.say('Subagent result ready'); manager.openLog(first)!.append({ kind: 'task.result', source: { taskId: childId, memberId: 'reviewer', runnerId: 'claude' }, data: { summary: 'Different available summary' } });
    await wait(async () => page.locator('.task-card [data-unread]').count().then(count => count === 1), 'hidden subagent result unread');
    await page.getByRole('tab', { name: 'Subagents', exact: true }).click();
    await page.getByText('Different available summary', { exact: true }).waitFor(); await Bun.sleep(100);
    assert.equal(await page.locator('.task-card [data-unread]').count(), 1, 'mismatched result and closed transcript do not read assistant reply');
    await page.getByRole('button', { name: 'Open full view' }).click();
    await wait(async () => page.locator('.task-card [data-unread]').count().then(count => count === 0), 'visible actual child transcript read');
    child.finish(); await wait(() => child.finished, 'child final outcome');
    const childMarker = await read(`${first}:${childId}:1`); assert.ok(childMarker > 0);
    const continued = await manager.callTaskTool({ sessionId: first, taskId: 'lead', memberId: 'lead', runnerId: 'claude' } as never, 'deck_delegate', { agent: 'reviewer', task: 'Continue reviewing', continueTaskId: childId }); assert.equal(continued.ok, true);
    await wait(() => claude.turns.filter(turn => turn.input.taskId === childId).length === 2, 'continued child attempt');
    await wait(async () => page.locator('.task-card [data-state="working"]').count().then(count => count === 1), 'continued child actual work');
    assert.equal(await read(`${first}:${childId}:2`), 0);
    claude.turns.filter(turn => turn.input.taskId === childId).at(-1)!.finish({ status: 'failed', error: 'Native failure' });
    await wait(async () => page.locator('.task-card [data-state="error"]').count().then(count => count === 1), 'child actual failure');
    checks.push('subagent-result-visibility-attempt-and-error');

    await page.screenshot({ path: '/tmp/deck-status-desktop-dark.png', fullPage: true }); await bounds(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await row('Lead discussion').locator('.work-orbit').evaluate(element => getComputedStyle(element).animationName), 'none');
    checks.push('reduced-motion-working-static');
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await page.screenshot({ path: '/tmp/deck-status-desktop-light.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('tab', { name: 'Subagents', exact: true }).click();
    const beforeHidden = await read(first); modalTurn.say('Lead response while mobile Subagents open');
    await page.getByText('Lead response while mobile Subagents open', { exact: true }).waitFor({ state: 'attached' });
    await Bun.sleep(150); assert.equal(await read(first), beforeHidden);
    await page.getByRole('tab', { name: 'Chat', exact: true }).click(); await wait(bottom, 'mobile Chat latest follows hidden updates');
    await wait(async () => await read(first) > beforeHidden, 'mobile visible Chat read');
    const mobileBounds = await conversation.boundingBox(); assert.ok(mobileBounds); await page.mouse.move(mobileBounds.x + mobileBounds.width / 2, mobileBounds.y + mobileBounds.height / 2); await page.mouse.wheel(0, -200000); await wait(async () => await conversation.evaluate(element => element.scrollTop === 0), 'mobile older reader'); await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const openMobileSession = async (name: string) => { await page.getByRole('button', { name: 'Open sessions', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name, exact: true }).click(); };
    await openMobileSession('Background review'); await page.getByText('Background completed response', { exact: true }).waitFor();
    await openMobileSession('Lead discussion'); await wait(bottom, 'mobile switched session latest despite prior upward reading');
    await page.screenshot({ path: '/tmp/deck-status-mobile-390-latest.png', fullPage: true });
    await page.getByRole('button', { name: 'Open sessions', exact: true }).click(); await bounds(page);
    await page.screenshot({ path: '/tmp/deck-status-mobile-390-light.png', fullPage: true });
    await page.getByRole('button', { name: 'Close sessions', exact: true }).click();
    await page.setViewportSize({ width: 320, height: 740 }); await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await openMobileSession('Background review'); await page.getByText('Background completed response', { exact: true }).waitFor();
    await openMobileSession('Lead discussion'); await wait(bottom, 'mobile320 session switch latest after render'); await bounds(page);
    await page.screenshot({ path: '/tmp/deck-status-mobile-320-dark.png', fullPage: true });
    checks.push('mobile-hidden-chat-and-switch-latest-bounds');
    await command({ type: 'session.stop' }, first); await wait(() => !manager.hasRunningWork(), 'final Lead stopped');
    const persisted = await read(first); await page.reload(); await page.bringToFront();
    await page.getByRole('button', { name: 'Open sessions', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Lead discussion', exact: true }).waitFor(); assert.equal(await read(first), persisted);
    checks.push('read-cursors-survive-reload');
    console.log(JSON.stringify({ passed: checks, screenshots: ['/tmp/deck-status-desktop-dark.png', '/tmp/deck-status-desktop-light.png', '/tmp/deck-status-mobile-390-light.png', '/tmp/deck-status-mobile-320-dark.png'] }));
} catch (cause) { console.error('STATUS_DIAGNOSTICS', JSON.stringify(await page.evaluate(() => ({chat:{top:document.querySelector('.conversation')?.scrollTop,height:document.querySelector('.conversation')?.scrollHeight,viewport:document.querySelector('.conversation')?.clientHeight},focus:document.activeElement?.outerHTML.slice(0,250),scrolls:(window as any).scrollEvidence?.slice(-20),storage:localStorage.getItem('deck.read-replies'),replies:Array.from(document.querySelectorAll('[data-reply-seq]')).slice(-3).map(e=>({seq:e.getAttribute('data-reply-seq'),rect:e.getBoundingClientRect().toJSON()})),icons:Array.from(document.querySelectorAll('.sidebar .agent-indicator')).map(e=>e.outerHTML)})))); console.error('STATUS_FAILURE', await page.locator('body').innerText()); await page.screenshot({ path: '/tmp/deck-status-failure.png', fullPage: true }); throw cause; }
finally { await browser.close(); await host.close(); await manager.close(); rmSync(root, { recursive: true, force: true }); }
