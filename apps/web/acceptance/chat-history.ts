/** Synthetic browser benchmark and acceptance. Builds fresh production assets;
 * uses a temporary EventLog and fake service, never a native runner or real prompt.
 * DECK_TEST_CHROME=/path/to/chrome CHAT_ACCEPTANCE=1 bun apps/web/acceptance/chat-history.ts
 */
import { chromium } from '@playwright/test';
import { buildWebAssets } from '../../../scripts/generate-web-assets';
import { WebService } from '../../../packages/session-host/src/web-service';
import { EventLog } from '../../../packages/session-host/src/event-log';
import { ensureStateLayout, resolveStatePaths } from '../../../packages/session-host/src/paths';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'deck-chat-bench-'));
const paths = resolveStatePaths({ env: { XDG_STATE_HOME: root } });
ensureStateLayout(paths);
const log = EventLog.open({ dir: join(paths.sessionsDir, 's', 'events'), sessionId: 's' });
log.append({ kind: 'session.created' });
log.append({ kind: 'session.state', data: { state: 'idle' } });
log.append({ kind: 'task.created', source: { taskId: 'lead', memberId: 'lead' }, data: { taskId: 'lead', runnerId: 'synthetic', state: 'completed' } });
const count = 6000;
for (let i = 0; i < count; i++)
    log.append({ kind: 'message.completed', source: { taskId: 'lead', memberId: 'lead' }, data: { role: i % 2 ? 'assistant' : 'user', text: `Synthetic message ${i}\n\n**Markdown** with a table\n\n| Key | Value |\n| --- | --- |\n| index | ${i} |\n\n` + 'Synthetic content with [reference](https://example.com). '.repeat(i % 5 + 1) } });
const other = EventLog.open({ dir: join(paths.sessionsDir, 't', 'events'), sessionId: 't' });
other.append({ kind: 'message.completed', data: { text: 'Other synthetic session' } });
const session = { sessionId: 's', projectId: 'p', title: 'Synthetic history', state: 'idle', lastSeq: log.lastSeq, generation: 0, members: { lead: { runnerId: 'synthetic', modelId: 'test' } } };
const host = new WebService({ paths, assets: await buildWebAssets(), config: { port: 0, trustedProxy: null, allowedOrigins: [], allowFunnel: false }, service: { openLog: id => id === 's' ? log : id === 't' ? other : undefined, hasRunningWork: () => false, execute: async () => ({ ok: true }), query: (name) => ({ ok: true, data: name === 'projects.list' ? { projects: [{ projectId: 'p', name: 'Synthetic', path: '/tmp/synthetic', available: true }] } : name === 'sessions.list' || name === 'sessions.status' ? { sessions: [session, { ...session, sessionId: 't', title: 'Other session' }] } : name === 'session.readiness' ? { status: 'ready', generation: 0 } : name === 'prompts.list' ? { seq: log.lastSeq, paused: false, queued: [] } : {} }) } });
host.enable();
const browser = await chromium.launch({ executablePath: process.env.DECK_TEST_CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.addInitScript(() => {
    const WS = window.WebSocket;
    (window as any).__chatSockets = [];
    window.WebSocket = class extends WS {
        constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); (window as any).__chatSockets.push(this); }
    };
});
const errors: string[] = [];
page.on('pageerror', e => errors.push(e.message));
let requests = 0, events = 0, bytes = 0;
page.on('response', async (r) => {
    if (/\/(events|history)(\?|$)/.test(r.url())) {
        const b = await r.body().catch(() => Buffer.alloc(0));
        bytes += b.length;
        try {
            const d = JSON.parse(b.toString());
            requests++;
            events += (d.events?.length ?? 0) + (d.messages?.length ?? 0);
        }
        catch { }
    }
});
try {
    const start = performance.now();
    await page.goto(host.status().url!);
    await page.getByRole('button', { name: 'Synthetic history', exact: true }).click();
    await page.locator('#prompt').waitFor({ timeout: 20000 }).catch(async (e) => { console.log((await page.locator('body').innerText()).slice(-5000)); console.log(errors); throw e; });
    await page.waitForTimeout(500);
    const loaded = performance.now() - start;
    const timings: number[] = [];
    for (let i = 0; i < 40; i++) {
        const t = performance.now();
        await page.locator('#prompt').pressSequentially('a');
        timings.push(performance.now() - t);
    }
    timings.sort((a, b) => a - b);
    console.log(JSON.stringify({ phase: process.env.CHAT_PHASE ?? 'baseline', syntheticMessages: count, requests, events, bytes, loadedMs: loaded, domMessages: await page.locator('#conversation .message').count(), domNodes: await page.locator('*').count(), typingMs: { median: timings[20], p95: timings[38], max: timings[39] }, errors }, null, 2));
    if (process.env.CHAT_ACCEPTANCE) {
        await import('./chat-history-checks').then(m => m.accept({ page, log, host }));
        if(errors.length)throw new Error(errors.join('\n'));
        console.log('Browser page errors: 0');
    }
}
finally {
    await browser.close();
    await host.close();
    log.close();
    other.close();
    rmSync(root, { recursive: true, force: true });
}
