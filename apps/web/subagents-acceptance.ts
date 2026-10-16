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

const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-subagents-browser-'))), home = join(root, 'home');
const projectOne = join(home, 'project-one'), projectTwo = join(home, 'project-two');
mkdirSync(projectOne, { recursive: true }); mkdirSync(projectTwo, { recursive: true });
const nestedDirectory = join(projectOne, 'nested folder', 'leaf');
mkdirSync(nestedDirectory, { recursive: true });
const paths = resolveStatePaths({ env: { XDG_STATE_HOME: join(root, 'state') } }); ensureStateLayout(paths);
const claude = new FakeDriver('claude'), codex = new FakeDriver('codex'), drivers = [claude, codex];
for (const driver of drivers) driver.onStart = turn => turn.init();
const config: CrossRunnerConfig = { enabled: true, members: { lead: { runnerId: 'claude', modelId: 'opus' }, reviewer: { runnerId: 'claude', modelId: 'opus' }, investigate: { runnerId: 'claude', modelId: 'opus' } }, approvals: { claude: 'relay', codex: 'runner-default', opencode: 'relay' }, maxConcurrentTasks: 4, claudeTosAcknowledgedAt: null, web: { port: 0, trustedProxy: null, allowedOrigins: [], allowFunnel: false } };
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

const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors: string[] = [];
page.setDefaultTimeout(7000); page.on('pageerror', error => errors.push(error.message));
try {
    const project = (await command({ type: 'project.register', path: projectOne, name: 'Subagents' })).project.projectId;
    const session = (await command({ type: 'session.create', projectId: project, title: 'Delegation' })).sessionId;
    await page.goto(host.status().url!);
    await page.getByRole('button', { name: 'Delegation', exact: true }).first().click();
    await page.getByRole('heading', { name: 'Delegation', exact: true }).waitFor();
    await page.waitForTimeout(300);
    const tab = (name: string) => page.getByRole('tab', { name, exact: true });
    assert.equal(await tab('Activity').getAttribute('aria-selected'), 'true', 'starts on Activity');
    await command({ type: 'prompt.send', text: 'Investigate' }, session);
    await wait(() => claude.turns.length > 0, 'lead turn');
    const delegated = await manager.callTaskTool({ sessionId: session, taskId: 'lead', memberId: 'lead', runnerId: 'claude' } as never, 'deck_delegate', { agent: 'investigate', task: 'Map the workspace' });
    assert.equal(delegated.ok, true, JSON.stringify(delegated)); const childId = (delegated as any).data.taskId;
    await wait(() => claude.turns.some(turn => turn.input.taskId === childId), 'child turn');
    const child = claude.turns.find(turn => turn.input.taskId === childId)!;
    await tab('Subagents').waitFor();
    await wait(async () => (await tab('Subagents').getAttribute('aria-selected')) === 'true', 'delegation brings the workspace to Subagents');
    // The user stays where they go afterwards, and reopened history never moves them.
    await tab('OpenSpec').click();
    child.say('Update while on OpenSpec');
    await page.waitForTimeout(300);
    assert.equal(await tab('OpenSpec').getAttribute('aria-selected'), 'true', 'later messages do not move the user');
    await tab('Activity').click();
    await page.reload();
    await page.getByRole('button', { name: 'Delegation', exact: true }).first().click();
    await page.getByRole('heading', { name: 'Delegation', exact: true }).waitFor();
    await page.waitForTimeout(400);
    assert.equal(await tab('Activity').getAttribute('aria-selected'), 'true', 'existing delegations do not move the user on load');
    for (let i = 0; i < 8; i++) child.say(`Child finding ${i}\n\n${'Detail line. '.repeat(30)}`);
    await page.getByRole('tab', { name: 'Subagents', exact: true }).click();
    const card = page.locator('.task-card').first();
    await card.waitFor();
    assert.equal(await card.getByRole('heading', { name: 'Investigate' }).count(), 1, 'role label replaces the raw member id');
    assert.equal(await card.locator('img.agent-avatar').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 128 && img.src.startsWith('data:image/png')), true, 'avatar is inlined and decodes');
    manager.openLog(session)!.append({ kind: 'task.result', source: { taskId: childId, memberId: 'investigate', runnerId: 'claude' }, data: { summary: `Findings\n\n${'A long reported result line. '.repeat(60)}` } } as never);
    await card.locator('.task-result--preview').waitFor();
    await card.getByRole('button', { name: 'Open full view' }).waitFor();
    assert.equal(await card.locator('details').count(), 0, 'the list carries no inline conversation');
    assert.ok((await card.boundingBox())!.height < 150, 'list cards are compact');
    assert.ok(await card.locator('.task-result--preview').evaluate(el => el.scrollHeight >= el.clientHeight && el.clientHeight <= 80), 'result is a short preview');
    await page.screenshot({ path: '/tmp/deck-subagents-list.png' });
    // Full view.
    await card.getByRole('button', { name: 'Open full view' }).click();
    const detail = page.locator('.subagent-detail');
    await detail.waitFor();
    const full = detail.locator('.task-transcript--full');
    const fullMetrics = () => full.evaluate(el => ({ client: el.clientHeight, gap: el.scrollHeight - el.scrollTop - el.clientHeight }));
    await wait(async () => (await fullMetrics()).client > 300, 'full view gives the conversation room');
    assert.ok((await fullMetrics()).gap < 3, 'full view starts at the newest message');
    child.say('Full view follow-up');
    await wait(async () => (await fullMetrics()).gap < 3 && (await full.textContent())!.includes('Full view follow-up'), 'full view follows');
    // Pauses while reading history, resumes on demand.
    await full.evaluate(el => { el.scrollTop = 0; });
    await page.waitForTimeout(100);
    child.say('Message while reading history');
    await detail.getByRole('button', { name: 'New messages ↓' }).waitFor();
    assert.ok((await full.evaluate(el => el.scrollTop)) < 5, 'does not yank the reader away from history');
    await detail.getByRole('button', { name: 'New messages ↓' }).click();
    await wait(async () => (await fullMetrics()).gap < 3, 'jump returns to the latest message');
    await page.screenshot({ path: '/tmp/deck-subagents-detail.png' });
    assert.equal(await detail.locator('.detail-pick').count(), 1, 'switcher lists the subagents');
    await detail.getByRole('button', { name: '← Subagents' }).click();
    await page.locator('.task-card').first().waitFor();
    assert.equal(await page.locator('.subagent-detail').count(), 0, 'back returns to the list');
    const favicon = await page.evaluate(async () => {
        const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
        if (!link) return false;
        const image = new Image(); image.src = link.href; await image.decode();
        return link.href.startsWith('data:image/svg+xml') && image.naturalWidth > 0;
    });
    assert.equal(favicon, true, 'page declares a decodable favicon');
    assert.deepEqual(errors, []);
    // The session indicator stops rotating once the Lead completes (React reuses the SVG node).
    const sessionIndicator = page.locator('nav[aria-label="Sessions"] .session-row .agent-indicator').first();
    await wait(async () => (await sessionIndicator.getAttribute('data-state')) === 'working', 'lead shows working');
    await wait(() => sessionIndicator.locator('.work-orbit').evaluate(el => el.hasAttribute('transform') || (el as SVGElement).style.transform !== ''), 'working glyph rotates');
    claude.turns[0]!.finish();
    await wait(async () => (await sessionIndicator.getAttribute('data-state')) === 'completed', 'lead shows completed');
    await page.waitForTimeout(250);
    assert.equal(await sessionIndicator.locator('svg *').evaluateAll(nodes => nodes.every(node => !node.hasAttribute('transform') && (node as SVGElement).style.transform === '')), true, 'completed check does not keep spinning');
    child.finish();
    console.log(JSON.stringify({ ok: true, checks: ['avatar', 'compact-list', 'full-view', 'follow-bottom', 'pause-when-reading', 'back', 'auto-switch', 'favicon', 'indicator-stops'] }));
} catch (error) { console.error(error); process.exitCode = 1; } finally { await browser.close(); host.disable?.(); await Bun.sleep(50); rmSync(root, { recursive: true, force: true }); process.exit(process.exitCode ?? 0); }
