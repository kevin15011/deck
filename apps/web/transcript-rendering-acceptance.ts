/** Production composition regression for interruptible history formatting.
 * Protects complete content/cursors, generation cancellation, anchors, selection,
 * keyboard/focus, streaming and the existing live-only user entrance.
 * DECK_TEST_CHROME=/snap/bin/chromium bun apps/web/transcript-rendering-acceptance.ts
 */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
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
const wait = async (condition: () => boolean | Promise<boolean>, label: string) => {
    for (let attempt = 0; attempt < 600; attempt++) { if (await condition()) return; await Bun.sleep(25); }
    throw new Error(`Timed out: ${label}`);
};



const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
context.setDefaultTimeout(15_000);
if (process.env.DECK_TRANSCRIPT_TRACE) await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
await context.addInitScript(() => {
    const w = window as any;
    w.samples = []; w.entrances = []; w.pages = [];
    w.focuses = []; document.addEventListener('focusin', event => w.focuses.push({ target: (event.target as HTMLElement).id || (event.target as HTMLElement).tagName, time: performance.now() }));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { w.copied = text; } } });
    const fetch = window.fetch;
    window.fetch = Object.assign(async (...args: Parameters<typeof window.fetch>) => {
        const response = await fetch(...args), json = response.json.bind(response);
        response.json = async () => { const value = await json(); if (String(args[0]).includes('/history')) w.pages.push({ url: String(args[0]), ...value }); return value; };
        return response;
    }, fetch);
    new MutationObserver(records => {
        const pending = [...document.querySelectorAll<HTMLElement>('[data-markdown-pending]')];
        w.samples.push({ pending: pending.length, rows: document.querySelectorAll('.history-row').length, time: performance.now() });
        for (const record of records) {
            const node = record.target as HTMLElement;
            if (node.matches?.('.message.user') && node.style.opacity && Number(node.style.opacity) < 0.99) w.entrances.push(node.textContent);
        }
        if (w.holdNext && pending.length) {
            w.holdNext = false;
            const range = document.createRange(); range.setStart(pending[0]!.firstChild!, 0); range.setEnd(pending[0]!.firstChild!, 100);
            window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
            w.held = pending[0]; w.selected = window.getSelection()!.toString();
        }
        if (w.switchNext && pending.length) {
            w.switchNext = false;
            [...document.querySelectorAll<HTMLButtonElement>('button.session')].find(button => button.getAttribute('aria-label') === 'Brief')!.click();
        }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
});
const page = await context.newPage(), errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const dense = Array.from({ length: 12 }, (_, i) => `### Finding ${i + 1}\n\nThe coordinator preserves **ordering** and [documented results](https://example.invalid/results).\n\n- Preserve session identity.\n- Measure the complete delivery path.\n\n| Phase | State |\n| --- | --- |\n| Request | completed |\n| Render | pending |\n\n\`\`\`typescript\nasync function resolve(id: string) { return api.load(id); }\n\`\`\`\n\n> Keep observable behavior stable.\n\n`).join('');
const ids: Record<string, string> = {};
let streamTimer: ReturnType<typeof setInterval> | undefined;
const settled = () => page.waitForFunction(() => document.querySelectorAll('.history-row').length > 0 && !document.querySelector('[data-markdown-pending]'));
const select = async (name: string) => { await page.getByRole('button', { name, exact: true }).first().click(); };
const anchor = () => page.locator('#conversation').evaluate(element => {
    const top = element.getBoundingClientRect().top;
    const row = [...element.querySelectorAll<HTMLElement>('[data-history-id]')].find(row => row.getBoundingClientRect().bottom > top)!;
    return { id: row.dataset.historyId!, offset: row.getBoundingClientRect().top - top };
});
try {
    const projectId = (await command({ type: 'project.register', path: projectOne, name: 'Transcript acceptance' })).project.projectId;
    for (const [name, count] of [['Brief', 8], ['Dense', 400]] as const) {
        const id = (await command({ type: 'session.create', projectId, title: name })).sessionId;
        ids[name] = id; await command({ type: 'session.prepare' }, id);
        for (let i = 0; i < count; i++) manager.openLog(id)!.append({ kind: 'message.completed', source: { taskId: 'lead', memberId: 'lead', ...(i % 2 ? { runnerId: 'claude' } : {}) }, data: { role: i % 2 ? 'assistant' : 'user', text: `${name} row ${i}\n\n${i % 2 && name === 'Dense' ? dense : 'Synthetic brief message.'}` } });
    }
    // Protect the same row and relative position when formatting is paused in
    // a hidden pane. Selection holds one source row until real hidden geometry
    // is established; clearing it then exposes hidden queue work on the RED.
    const hiddenFailures: string[] = [];
    for (const mobile of [false, true]) {
        const reading = await context.newPage();
        reading.on('pageerror', error => errors.push(error.message));
        if (mobile) await reading.setViewportSize({ width: 390, height: 844 });
        await reading.addInitScript(() => { (window as any).holdNext = true; localStorage.setItem('deck.content-mode', 'chat'); });
        await reading.goto(`${host.status().url!}?session=${ids.Dense}`);
        await reading.waitForFunction(() => (window as any).held && document.querySelectorAll('[data-markdown-pending]').length === 1 && !!document.querySelector('.connection-dot.ready'));
        const source = await reading.evaluate(() => {
            const root = document.querySelector<HTMLElement>('#conversation')!, row = (window as any).held.closest('[data-history-id]') as HTMLElement;
            root.scrollTop += row.getBoundingClientRect().top - root.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
            root.dispatchEvent(new Event('scroll', { bubbles: true }));
            return { id: row.dataset.historyId, fraction: (root.getBoundingClientRect().top - row.getBoundingClientRect().top) / row.getBoundingClientRect().height };
        });
        const hide = () => mobile ? reading.getByRole('tab', { name: 'Activity', exact: true }).evaluate(node => (node as HTMLElement).click()) : reading.getByRole('button', { name: 'Workspace', exact: true }).evaluate(node => (node as HTMLElement).click());
        const show = () => mobile ? reading.getByRole('tab', { name: 'Chat', exact: true }).evaluate(node => (node as HTMLElement).click()) : reading.getByRole('button', { name: 'Chat', exact: true }).evaluate(node => (node as HTMLElement).click());
        await hide();
        await reading.waitForFunction(() => document.querySelector<HTMLElement>('#conversation')!.clientHeight === 0 && !!document.querySelector('.connection-dot.ready'));
        const pausedPending = await reading.locator('[data-markdown-pending]').count();
        // A hidden viewport can resize (for example when browser chrome changes).
        await reading.setViewportSize({ width: mobile ? 390 : 1440, height: mobile ? 780 : 820 });
        await reading.evaluate(() => window.getSelection()!.removeAllRanges());
        await reading.waitForTimeout(450);
        const hiddenPending = await reading.locator('[data-markdown-pending]').count();
        await show();
        await reading.waitForFunction(() => document.querySelector<HTMLElement>('#conversation')!.clientHeight > 0 && !!document.querySelector('.connection-dot.ready') && !document.querySelector('[data-markdown-pending]'));
        await reading.waitForTimeout(450);
        const returned = await reading.locator('#conversation').evaluate(root => {
            const top = root.getBoundingClientRect().top;
            const row = [...root.querySelectorAll<HTMLElement>('[data-history-id]')].find(row => row.getBoundingClientRect().bottom > top)!;
            return { id: row.dataset.historyId, fraction: (top - row.getBoundingClientRect().top) / row.getBoundingClientRect().height };
        });
        console.log(JSON.stringify({ scenario: mobile ? 'mobile hidden tab' : 'desktop workspace-only', source, returned, pausedPending, hiddenPending }));
        const label = mobile ? 'mobile' : 'desktop';
        if (returned.id !== source.id) hiddenFailures.push(`${label}: returning to chat lost the row being read`);
        if (Math.abs(returned.fraction - source.fraction) >= .03) hiddenFailures.push(`${label}: returning to chat lost relative position inside source row`);
        if (!hiddenPending || hiddenPending !== pausedPending) hiddenFailures.push(`${label}: hidden chat did not pause formatting`);
        await reading.close();

        // Delay only the HTTP edge so the actual production app hydrates while
        // the pane is already hidden, including a mobile workspace route.
        const hydrating = await context.newPage();
        hydrating.on('pageerror', error => errors.push(error.message));
        if (mobile) await hydrating.setViewportSize({ width: 390, height: 844 });
        await hydrating.addInitScript(() => localStorage.setItem('deck.content-mode', 'workspace'));
        let releaseHistory!: () => void;
        const historyGate = new Promise<void>(resolve => { releaseHistory = resolve; });
        await hydrating.route('**/history', async route => { await historyGate; await route.continue(); });
        await hydrating.goto(`${host.status().url!}?session=${ids.Dense}`);
        if (mobile) await hydrating.getByRole('tab', { name: 'Activity', exact: true }).click();
        await hydrating.waitForFunction(() => document.querySelector<HTMLElement>('#conversation')?.clientHeight === 0);
        releaseHistory();
        await hydrating.waitForFunction(() => document.querySelectorAll('.history-row').length === 40 && !!document.querySelector('.connection-dot.ready'));
        const hydratedPending = await hydrating.locator('[data-markdown-pending]').count();
        await hydrating.waitForTimeout(450);
        assert(hydratedPending > 0, 'hidden hydration must leave source rows queued');
        assert.equal(await hydrating.locator('[data-markdown-pending]').count(), hydratedPending, 'hidden hydration must not consume the formatting queue');
        assert(await hydrating.locator('#conversation').textContent().then(text => text!.includes('Dense row 360') && text!.includes('Dense row 399')), 'all fetched source stays available while hidden');
        const reveal = () => mobile ? hydrating.getByRole('tab', { name: 'Chat', exact: true }).evaluate(node => (node as HTMLElement).click()) : hydrating.getByRole('button', { name: 'Chat', exact: true }).evaluate(node => (node as HTMLElement).click());
        const conceal = () => mobile ? hydrating.getByRole('tab', { name: 'Activity', exact: true }).evaluate(node => (node as HTMLElement).click()) : hydrating.getByRole('button', { name: 'Workspace', exact: true }).evaluate(node => (node as HTMLElement).click());
        // Reverse an opening while work is still pending, then prove it pauses
        // again and eventually finishes on the next return.
        await reveal(); await hydrating.waitForTimeout(30); await conceal();
        await hydrating.waitForFunction(() => document.querySelector<HTMLElement>('#conversation')!.clientHeight === 0 && !!document.querySelector('.connection-dot.ready'));
        const reversedPending = await hydrating.locator('[data-markdown-pending]').count();
        await hydrating.waitForTimeout(450);
        assert(reversedPending > 0, 'rapid reversal must exercise an unfinished queue');
        assert.equal(await hydrating.locator('[data-markdown-pending]').count(), reversedPending, 'rapid reversal must pause remaining work');
        await reveal();
        await hydrating.waitForFunction(() => document.querySelector<HTMLElement>('#conversation')!.clientHeight > 0 && !!document.querySelector('.connection-dot.ready') && !document.querySelector('[data-markdown-pending]'));
        await hydrating.waitForFunction(() => { const root = document.querySelector('#conversation')!; return root.scrollHeight - root.scrollTop - root.clientHeight < 4; });
        assert.equal(await hydrating.locator('.message.lead h3').count(), 20 * 12, 'hidden hydration eventually formats the entire original page');
        console.log(JSON.stringify({ scenario: `${label} hidden hydration and rapid reversal`, hydratedPending, reversedPending }));
        await hydrating.close();
    }
    assert.deepEqual(hiddenFailures, [], 'hidden pane reading-position regressions');
    console.log('PASS desktop/mobile hidden source row retains relative reading anchor');
    await page.addInitScript(() => localStorage.setItem('deck.content-mode', 'both'));
    await page.goto(host.status().url!); await select('Brief'); await settled();
    await page.evaluate(() => { (window as any).holdNext = true; });
    await select('Dense');
    await page.waitForFunction(() => (window as any).held && document.querySelectorAll('[data-markdown-pending]').length === 1);
    assert.equal(await page.locator('.history-row').count(), 40, 'initial fetched page stays complete');
    assert(await page.evaluate(() => (window as any).held.isConnected && window.getSelection()!.toString() === (window as any).selected), 'selection survives other formatting commits');
    assert(await page.evaluate(() => document.querySelector('#conversation')!.textContent!.includes('Dense row 360')), 'older source text is searchable during fill');
    await page.evaluate(() => window.getSelection()!.removeAllRanges()); await settled();
    assert.equal(await page.locator('.message.lead h3').count(), 20 * 12, 'all Markdown eventually formatted');
    assert.equal(await page.evaluate(() => (window as any).entrances.length), 0, 'hydration has no user entrance');
    await page.locator('.message.lead').last().getByRole('button', { name: 'Copy message', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
    await page.waitForFunction(() => !!(window as any).copied);
    assert.equal(await page.evaluate(() => (window as any).copied), `Dense row 399\n\n${dense}`, 'copy retains exact source');
    const link = page.locator('.message.lead a').last(); await link.focus(); assert(await link.evaluate(node => node === document.activeElement), 'formatted links are keyboard accessible');
    console.log('PASS complete page, eventual Markdown, retained selection/search/copy, keyboard access and no hydration entrance');

    // Keep a fully formatted visible answer anchored while older rows fill above it.
    await select('Brief'); await settled(); await select('Dense');
    await page.waitForFunction(() => !!document.querySelector('[data-markdown-pending]'));
    await page.locator('#conversation').evaluate(element => { element.scrollTop -= 300; element.dispatchEvent(new Event('scroll', { bubbles: true })); });
    const before = await anchor(); await settled(); const after = await anchor();
    assert.equal(after.id, before.id); assert(Math.abs(after.offset - before.offset) < 3, `reading anchor moved ${after.offset - before.offset}px`);
    await page.locator('#conversation').focus(); await page.keyboard.press('PageUp');
    const priorIds = await page.locator('.history-row').evaluateAll(rows => rows.map(row => Number((row as HTMLElement).dataset.historyId)));
    await page.getByRole('button', { name: 'Older messages', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
    await page.waitForFunction(() => document.querySelectorAll('.history-row').length === 80); await settled();
    const paged = await page.locator('.history-row').evaluateAll(rows => rows.map(row => Number((row as HTMLElement).dataset.historyId)));
    assert.deepEqual(paged.slice(-40), priorIds); assert(paged.every((id, i) => !i || id > paged[i - 1]!), 'paging retains order');
    assert(await page.evaluate(() => (window as any).pages.some((p: any) => p.url.includes('before='))), 'older cursor used');
    assert.equal(await page.evaluate(() => (window as any).entrances.length), 0, 'paging has no entrance');
    console.log('PASS upward scroll during fill, keyboard scrolling and unchanged older cursor/order');

    await select('Brief'); await settled();
    for (let i = 0; i < 3; i++) {
        await page.evaluate(() => { (window as any).switchNext = true; }); await select('Dense');
        await page.waitForFunction(() => !(window as any).switchNext && document.querySelector('button.session[aria-current="page"]')?.getAttribute('aria-label') === 'Brief' && document.querySelectorAll('.history-row').length === 8 && !document.querySelector('#conversation')!.textContent!.includes('Dense row'));
        await page.waitForTimeout(150);
        assert(!await page.locator('#conversation').innerText().then(text => text.includes('Dense row')), 'cancelled generation cannot reappear');
    }
    console.log('PASS three rapid switches during formatting');

    // Fake inference uses the real SessionManager/WS path while history fills.
    await command({ type: 'prompt.send', text: 'Stream during history fill' }, ids.Dense);
    await wait(() => claude.turns.length > 0, 'FakeDriver streaming turn');
    const turn = claude.turns.at(-1)!; let ticks = 0;
    streamTimer = setInterval(() => turn.emit('message.delta', { text: `Live tick ${++ticks}. ` }), 75);
    await select('Dense');
    await page.waitForFunction(() => document.querySelector('button.session[aria-current="page"]')?.getAttribute('aria-label') === 'Dense' && !!document.querySelector('.connection-dot.ready') && !!document.querySelector('[data-markdown-pending]'));
    await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Jump to latest ↓')?.click());
    await page.locator('#prompt').focus(); await settled();
    assert(await page.locator('#conversation').innerText().then(text => text.includes('Live tick')), 'stream updates coexist with fill');
    assert(await page.locator('#prompt').evaluate(node => document.activeElement === node), `composer focus survives fill: ${JSON.stringify(await page.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0, 120), events: (window as any).focuses.slice(-15) })))}`);
    clearInterval(streamTimer); streamTimer = undefined; turn.say('Final streamed answer'); turn.finish();
    await wait(() => !manager.hasRunningWork(), 'stream turn finished');
    await page.getByText('Final streamed answer', { exact: true }).waitFor();
    assert.equal(await page.getByText('Final streamed answer', { exact: true }).count(), 1, 'completion reconciles one live row');
    await page.waitForFunction(() => { const root = document.querySelector('#conversation')!; return root.scrollHeight - root.scrollTop - root.clientHeight < 4; });
    await command({ type: 'prompt.send', text: 'New live user entrance' }, ids.Dense);
    await page.waitForFunction(() => (window as any).entrances.some((text: string) => text.includes('New live user entrance')));
    claude.turns.at(-1)!.say('Entrance acknowledged'); claude.turns.at(-1)!.finish();
    await wait(() => !manager.hasRunningWork(), 'entrance turn finished');
    console.log('PASS streaming/completion, focus, bottom following and new-user entrance');

    await page.emulateMedia({ reducedMotion: 'reduce' }); await select('Brief'); await settled(); await select('Dense'); await settled();
    const entrances = await page.evaluate(() => (window as any).entrances.length);
    await command({ type: 'prompt.send', text: 'Reduced motion user' }, ids.Dense);
    await page.getByText('Reduced motion user', { exact: true }).waitFor(); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => (window as any).entrances.length), entrances, 'reduced motion skips entrance');
    claude.turns.at(-1)!.say('Reduced acknowledged'); claude.turns.at(-1)!.finish();
    await wait(() => !manager.hasRunningWork(), 'reduced motion turn finished');
    // A scrollbar jump can land inside source text before its formatting turn.
    const reading = await context.newPage(); reading.on('pageerror', error => errors.push(error.message));
    await reading.goto(host.status().url!); await reading.getByRole('button', { name: 'Dense', exact: true }).first().click();
    await reading.waitForFunction(() => !!document.querySelector('[data-markdown-pending]'));
    const sourcePosition = await reading.evaluate(() => {
        const root = document.querySelector<HTMLElement>('#conversation')!;
        const row = document.querySelector<HTMLElement>('[data-markdown-pending]')!.closest<HTMLElement>('[data-history-id]')!;
        root.scrollTop += row.getBoundingClientRect().top - root.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
        root.dispatchEvent(new Event('scroll', { bubbles: true }));
        return { id: row.dataset.historyId, fraction: (root.getBoundingClientRect().top - row.getBoundingClientRect().top) / row.getBoundingClientRect().height };
    });
    await reading.waitForFunction(() => !document.querySelector('[data-markdown-pending]'));
    const formattedPosition = await reading.evaluate(() => {
        const root = document.querySelector<HTMLElement>('#conversation')!, top = root.getBoundingClientRect().top;
        const row = [...root.querySelectorAll<HTMLElement>('[data-history-id]')].find(row => row.getBoundingClientRect().bottom > top)!;
        return { id: row.dataset.historyId, fraction: (top - row.getBoundingClientRect().top) / row.getBoundingClientRect().height };
    });
    assert.equal(formattedPosition.id, sourcePosition.id, 'formatting must retain the message being read');
    assert(Math.abs(formattedPosition.fraction - sourcePosition.fraction) < .03, `reading position changed: ${JSON.stringify({ sourcePosition, formattedPosition })}`);
    await reading.close(); console.log('PASS reader position inside a pending dense row');
    assert.deepEqual(errors, []); console.log('PASS reduced motion and zero browser exceptions');
} finally {
    if (streamTimer) clearInterval(streamTimer);
    if (process.env.DECK_TRANSCRIPT_TRACE) await context.tracing.stop({ path: process.env.DECK_TRANSCRIPT_TRACE });
    await browser.close(); host.disable(); await manager.close(); rmSync(root, { recursive: true, force: true });
}
