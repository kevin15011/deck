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

const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-ordering-browser-'))), home = join(root, 'home');
const projectOne = join(home, 'project-one'), projectTwo = join(home, 'project-two');
mkdirSync(projectOne, { recursive: true }); mkdirSync(projectTwo, { recursive: true });
const nestedDirectory = join(projectOne, 'nested folder', 'leaf');
mkdirSync(nestedDirectory, { recursive: true });
const paths = resolveStatePaths({ env: { XDG_STATE_HOME: join(root, 'state') } }); ensureStateLayout(paths);
const claude = new FakeDriver('claude'), codex = new FakeDriver('codex'), drivers = [claude, codex];
for (const driver of drivers) driver.onStart = turn => {
    turn.init(); turn.say(`${driver.runnerId} response from ${turn.input.taskId}`);
    turn.emit('reasoning.delta', { text: 'Native test reasoning', format: 'snapshot', messageId: turn.input.taskId, partId: 'text:0' });
    turn.emit('tool.started', { toolCallId: 'browser-read', toolName: 'Read', input: { path: 'README.md' } });
};
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
const titles = (page: Page, project: string) => page.locator(`nav[aria-label="Sessions"] .project-group[data-project-id="${project}"] .session-row .session-label strong`).allTextContents();
const projectNames = (page: Page) => page.locator('nav[aria-label="Sessions"] .project-tree > .project-group .project-name strong').allTextContents();
async function acceptance() {
try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors: string[] = [];
    page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message));
    const one = (await command({ type: 'project.register', path: projectOne, name: 'Alpha' })).project.projectId;
    const two = (await command({ type: 'project.register', path: projectTwo, name: 'Beta' })).project.projectId;
    for (const title of ['S1', 'S2', 'S3']) await command({ type: 'session.create', projectId: one, title });
    await page.goto(host.status().url!);
    const sidebar = page.getByRole('navigation', { name: 'Sessions', exact: true });
    await sidebar.locator(`.project-group[data-project-id="${one}"]`).waitFor();
    await sidebar.locator(`.project-group[data-project-id="${one}"]`).getByRole('button', { name: /^Sessions in / }).waitFor();
    const group = sidebar.locator(`.project-group[data-project-id="${one}"]`);
    if (await group.getByRole('button', { name: /^Sessions in / }).getAttribute('aria-expanded') !== 'true') await group.getByRole('button', { name: /^Sessions in / }).click();
    await page.waitForFunction(() => document.querySelectorAll('nav[aria-label="Sessions"] .session-row').length >= 3);
    const original = await titles(page, one);
    assert.equal(original.length, 3);
    assert.deepEqual(await projectNames(page), ['Alpha', 'Beta']);

    // Pointer drag: first session below the last one.
    const rows = group.locator('.session-row');
    const a = (await rows.nth(0).boundingBox())!, c = (await rows.nth(2).boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 8, { steps: 4 });
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2 + 6, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    const dragged = await titles(page, one);
    assert.deepEqual(dragged, [original[1], original[2], original[0]], 'pointer drag reorders sessions');
    assert.equal(await page.evaluate(() => document.querySelector('nav[aria-label="Sessions"] .session-row')!.getAttribute('style') ?? ''), '', 'row transforms are cleared after settling');

    // A plain click still selects a session.
    await rows.nth(0).locator('button.session').click();
    assert.equal(await rows.nth(0).locator('button.session').getAttribute('aria-current'), 'page');

    // Keyboard reorder through the grip.
    await rows.nth(0).getByRole('button', { name: /^Reorder session/ }).focus();
    await page.keyboard.press('Space'); await page.waitForTimeout(150); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(250); await page.keyboard.press('Space');
    await page.waitForTimeout(600);
    assert.deepEqual(await titles(page, one), [dragged[1], dragged[0], dragged[2]], 'keyboard reorders sessions');

    // Project drag from its header.
    const p1 = (await sidebar.locator('.project-group').nth(0).locator('.project-row').boundingBox())!, p2 = (await sidebar.locator('.project-group').nth(1).locator('.project-row').boundingBox())!;
    await page.mouse.move(p1.x + 60, p1.y + p1.height / 2); await page.mouse.down();
    await page.mouse.move(p1.x + 60, p1.y + p1.height / 2 + 10, { steps: 4 });
    await page.mouse.move(p2.x + 60, p2.y + p2.height / 2 + 12, { steps: 12 });
    await page.mouse.up(); await page.waitForTimeout(600);
    assert.deepEqual(await projectNames(page), ['Beta', 'Alpha'], 'pointer drag reorders projects');

    // Persistence across reload; a new session lands on top without disturbing the saved order.
    const afterKeys = await titles(page, one);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('nav[aria-label="Sessions"] .project-group').length === 2);
    assert.deepEqual(await projectNames(page), ['Beta', 'Alpha'], 'project order survives reload');
    await page.locator(`.project-group[data-project-id="${one}"]`).getByRole('button', { name: /^Sessions in / }).click().catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('nav[aria-label="Sessions"] .session-row').length >= 3);
    assert.deepEqual(await titles(page, one), afterKeys, 'session order survives reload');
    await command({ type: 'session.create', projectId: one, title: 'Fresh' });
    await sidebar.locator('.navigation-refresh').click();
    await page.waitForFunction(() => document.querySelectorAll('nav[aria-label="Sessions"] .session-row').length >= 4);
    assert.deepEqual(await titles(page, one), ['Fresh', ...afterKeys], 'new sessions stay on top');

    // GSAP motion: dialog reveal, press feedback, and reduced-motion opt-out.
    const openDialogOpacity = () => page.evaluate(async () => {
        (document.querySelector('nav[aria-label="Sessions"] .navigation-add') as HTMLButtonElement).click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const dialog = document.querySelector('dialog[open]') as HTMLElement;
        return dialog ? Number(getComputedStyle(dialog).opacity) : -1;
    });
    const closeDialog = async () => { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog[open]')); };
    const animated = await openDialogOpacity();
    assert.ok(animated >= 0 && animated < 0.99, `dialog reveals with a GSAP tween (opacity ${animated})`);
    await closeDialog();
    const pressed = await page.evaluate(async () => {
        const button = document.querySelector('nav[aria-label="Sessions"] .navigation-refresh') as HTMLButtonElement;
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerType: 'mouse' }));
        await new Promise(resolve => setTimeout(resolve, 80));
        return getComputedStyle(button).transform;
    });
    assert.notEqual(pressed, 'none', 'buttons give press feedback');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await openDialogOpacity(), 1, 'reduced motion skips tweens');
    await closeDialog();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.screenshot({ path: '/tmp/deck-ordering.png' });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, checks: ['pointer-session-drag', 'click-select', 'keyboard-reorder', 'project-drag', 'persistence', 'new-on-top', 'dialog-tween', 'press-feedback', 'reduced-motion'] }));
} catch (error) { console.error(error); process.exitCode = 1; } finally { await browser.close(); host.disable?.(); await Bun.sleep(50); rmSync(root, { recursive: true, force: true }); process.exit(process.exitCode ?? 0); }
}
await acceptance();
