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
const wait = async (condition: () => boolean | Promise<boolean>, label: string) => {
    for (let attempt = 0; attempt < 160; attempt++) { if (await condition()) return; await Bun.sleep(25); }
    throw new Error(`Timed out: ${label}`);
};
const bounds = async (page: Page) => assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1 || document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollHeight > innerHeight + 1), false, 'Workspace must fit the viewport');
async function acceptance() {
try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: !!process.env.DECK_TEST_DIRECTORIES_ONLY }), page = await context.newPage(), errors: string[] = [];
    page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        const Native = window.WebSocket;
        (window as any).acceptanceSockets = [];
        window.WebSocket = class extends Native { constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); (window as any).acceptanceSockets.push(this); } };
    });
    let accordion: { firstProject: string; secondProject: string; firstSession: string } | undefined;
    if (process.env.DECK_TEST_SIDEBAR_ONLY) {
        const firstProject = (await command({ type: 'project.register', path: projectOne, name: 'Shared project' })).project.projectId;
        const secondProject = (await command({ type: 'project.register', path: projectTwo, name: 'Shared project' })).project.projectId;
        const firstSession = (await command({ type: 'session.create', projectId: firstProject, title: 'First planning' })).sessionId;
        await command({ type: 'session.create', projectId: firstProject, title: 'First history' });
        await command({ type: 'session.create', projectId: secondProject, title: 'Second planning' });
        await command({ type: 'session.create', projectId: secondProject, title: 'Second history' });
        await command({ type: 'session.create', projectId: secondProject, title: 'Investigate cross-runner startup and preserve independent session history' });
        accordion = { firstProject, secondProject, firstSession };
    }
    await page.goto(host.status().url!);
    if (accordion) {
        const { firstProject, secondProject } = accordion;
        const sidebar = page.getByRole('navigation', { name: 'Sessions', exact: true });
        const group = (id: string, surface = sidebar) => surface.locator(`.project-group[data-project-id="${id}"]`);
        const header = (id: string, surface = sidebar) => group(id, surface).getByRole('button', { name: /^Sessions in / });
        const plus = (id: string, surface = sidebar) => group(id, surface).getByRole('button', { name: /^New session in / });
        await header(firstProject).waitFor();
        assert.equal(await header(firstProject).getAttribute('aria-expanded'), 'true');
        assert.equal(await header(secondProject).getAttribute('aria-expanded'), 'false');
        for (const id of [firstProject, secondProject]) {
            const target = await header(id).getAttribute('aria-controls');
            assert.equal(await group(id).locator(`[id="${target}"]`).count(), 1, 'Disclosure target remains in the DOM when collapsed');
        }
        await sidebar.getByRole('button', { name: 'Add project', exact: true }).click();
        await page.getByRole('dialog').getByRole('heading', { name: 'Add project', exact: true }).waitFor();
        await page.getByRole('dialog').press('Escape');
        await header(firstProject).press('Enter');
        assert.equal(await header(firstProject).getAttribute('aria-expanded'), 'false');
        assert.equal(await page.getByRole('dialog').count(), 0, 'Project header does not open a dialog');
        await header(secondProject).click();
        await group(secondProject).getByRole('button', { name: 'Second planning', exact: true }).waitFor();
        assert.equal(await group(firstProject).getByRole('button', { name: 'Second planning', exact: true }).count(), 0);
        await header(firstProject).click();
        assert.equal(await header(secondProject).getAttribute('aria-expanded'), 'true', 'Projects expand independently');
        assert.equal(claude.turns.length, 0, 'Project disclosure does not create, prepare or run a session');
        await group(firstProject).getByRole('button', { name: 'First planning', exact: true }).press('Enter');
        await page.locator('.composer-gate').getByRole('button', { name: 'Prepare session', exact: true }).click();
        await page.getByLabel('Message the lead').fill('Review this project workspace'); await page.getByLabel('Message the lead').press('Enter');
        await wait(() => claude.turns.length === 1, 'active conversation');
        claude.turns[0]!.emit('tool.completed', { toolCallId: 'browser-read', output: 'Reviewed the project README.' }); claude.turns[0]!.finish();
        await wait(() => !manager.hasRunningWork(), 'completed conversation');
        await page.getByRole('region', { name: 'Conversation', exact: true }).getByText('claude response from lead', { exact: true }).waitFor();
        await header(secondProject).click(); await header(secondProject).click();
        await page.locator('.app-header').getByRole('heading', { name: 'First planning', exact: true }).waitFor();
        for (let repeat = 0; repeat < 2; repeat++) {
            await plus(secondProject).click();
            await page.getByRole('dialog').getByRole('heading', { name: 'New session', exact: true }).waitFor();
            await page.getByRole('dialog').getByText(projectTwo, { exact: true }).waitFor();
            await page.getByRole('dialog').press('Escape');
            await wait(() => plus(secondProject).evaluate(element => document.activeElement === element), 'row plus focus restored');
            await page.locator('.app-header').getByRole('heading', { name: 'First planning', exact: true }).waitFor();
        }
        // Capture B's old HTTP history before mutation, then let forced refresh supersede it.
        let release!: () => void, captured!: () => void, finished!: () => void, hold = true;
        const delayed = new Promise<void>(resolve => { release = resolve; }), requested = new Promise<void>(resolve => { captured = resolve; }), staleFinished = new Promise<void>(resolve => { finished = resolve; });
        await page.route('**/api/sessions?**', async route => {
            if (!hold || new URL(route.request().url()).searchParams.get('projectId') !== secondProject) { await route.continue(); return; }
            hold = false; const response = await route.fetch(); captured(); await delayed;
            await route.fulfill({ response }).catch(() => {}); finished();
        });
        await header(secondProject).click(); await header(secondProject).click(); await requested;
        await plus(secondProject).click();
        const form = page.getByRole('dialog'); await form.getByLabel('Session name', { exact: true }).fill('New in second');
        await form.getByRole('button', { name: 'Create session', exact: true }).click();
        await page.locator('.app-header').getByRole('heading', { name: 'New in second', exact: true }).waitFor();
        await group(secondProject).getByRole('button', { name: 'New in second', exact: true }).waitFor({ timeout: 2000 });
        assert.equal(await group(firstProject).getByRole('button', { name: 'New in second', exact: true }).count(), 0);
        release(); await staleFinished; await page.unroute('**/api/sessions?**');
        assert.equal(await group(secondProject).getByRole('button', { name: 'New in second', exact: true }).count(), 1, 'Delayed pre-create history cannot hide the new session');
        await group(firstProject).getByRole('button', { name: 'First planning', exact: true }).click();
        await page.locator('.app-header').getByRole('heading', { name: 'First planning', exact: true }).waitFor();
        const desktopRows = await sidebar.locator('.session').evaluateAll(elements => elements.map(element => {
            const row = element as HTMLElement, text = row.querySelector('strong')!;
            return { height: row.getBoundingClientRect().height, textHeight: text.getBoundingClientRect().height, visibleText: row.innerText.trim(), label: row.getAttribute('aria-label'), metadata: row.getAttribute('aria-description'), visibleMetadata: !!row.querySelector('small,time') };
        }));
        assert.ok(desktopRows.length >= 6);
        assert.ok(desktopRows.every(row => row.height >= 30 && row.height <= 32 && row.textHeight <= 20), 'Desktop session rows stay thin and single-line');
        assert.ok(desktopRows.every(row => row.visibleText === row.label && !row.visibleMetadata && row.metadata?.includes('Created ')), 'Only the title is visible; recorded metadata remains accessible');
        const longTitle = 'Investigate cross-runner startup and preserve independent session history';
        const longRow = group(secondProject).getByRole('button', { name: longTitle, exact: true });
        assert.ok((await longRow.getAttribute('title'))?.startsWith(`${longTitle}\n`), 'Native tooltip preserves the complete title');
        assert.equal(await longRow.locator('strong').evaluate(element => element.scrollWidth > element.clientWidth && getComputedStyle(element).textOverflow === 'ellipsis'), true, 'Long session titles visibly truncate to one line');
        assert.equal(await sidebar.locator('.project-toggle,.project-new,.navigation-add,.navigation-refresh').evaluateAll(elements => elements.every(element => !!element.querySelector('svg[aria-hidden="true"]'))), true, 'Navigation icons use decorative SVGs in labeled buttons');
        assert.equal(await sidebar.getByText('Workspace', { exact: true }).count(), 0);
        assert.equal(await sidebar.getByText('Local workspace', { exact: true }).count(), 0);
        await page.screenshot({ path: '/tmp/deck-minimal-sidebar-desktop-dark.png', fullPage: true }); await bounds(page);
        await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
        await page.screenshot({ path: '/tmp/deck-minimal-sidebar-desktop-light.png', fullPage: true }); await bounds(page);
        for (const [width, theme] of [[320, 'light'], [320, 'dark'], [390, 'dark'], [390, 'light']] as const) {
            await page.setViewportSize({ width, height: 844 });
            const toggle = page.getByRole('button', { name: theme === 'dark' ? 'Switch to dark theme' : 'Switch to light theme', exact: true });
            if (await toggle.count()) await toggle.click();
            await page.getByRole('button', { name: 'Open sessions', exact: true }).click();
            const drawer = page.getByRole('dialog'), navigation = drawer.getByRole('navigation');
            await header(firstProject, navigation).press('Enter');
            await header(firstProject, navigation).press('Enter');
            assert.equal(await drawer.getByRole('heading', { name: 'New session', exact: true }).count(), 0);
            assert.equal(await navigation.locator('.session').evaluateAll(elements => elements.every(element => element.getBoundingClientRect().height >= 40 && element.getBoundingClientRect().height <= 42)), true, 'Touch rows retain a useful target without two-line metadata');
            assert.equal(await plus(secondProject, navigation).evaluate(element => element.getBoundingClientRect().width >= 40 && element.getBoundingClientRect().height >= 40), true);
            assert.equal(await drawer.getByRole('button', { name: 'Close sessions', exact: true }).locator('svg[aria-hidden="true"]').count(), 1);
            await page.screenshot({ path: `/tmp/deck-minimal-sidebar-mobile-${width}-${theme}.png`, fullPage: true }); await bounds(page);
            await plus(secondProject, navigation).click();
            await page.getByRole('dialog').getByText(projectTwo, { exact: true }).waitFor();
            await page.getByRole('dialog').press('Escape');
            await wait(() => page.getByRole('button', { name: 'Open sessions', exact: true }).evaluate(element => document.activeElement === element), 'mobile visible navigation focus');
            await page.locator('.app-header').getByRole('heading', { name: 'First planning', exact: true }).waitFor();
            await page.getByRole('button', { name: 'Open sessions', exact: true }).click();
            await group(secondProject, page.getByRole('dialog').getByRole('navigation')).getByRole('button', { name: 'Second planning', exact: true }).click();
            await page.locator('.app-header').getByRole('heading', { name: 'Second planning', exact: true }).waitFor();
            assert.equal(await page.getByRole('dialog').isVisible(), false);
            await page.getByRole('button', { name: 'Open sessions', exact: true }).click();
            await group(firstProject, page.getByRole('dialog').getByRole('navigation')).getByRole('button', { name: 'First planning', exact: true }).click();
            await page.locator('.app-header').getByRole('heading', { name: 'First planning', exact: true }).waitFor();
            await bounds(page);
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
        await sidebar.getByRole('button', { name: 'Show projects', exact: true }).waitFor();
        await page.screenshot({ path: '/tmp/deck-minimal-sidebar-collapsed.png', fullPage: true }); await bounds(page);
        await sidebar.getByRole('button', { name: 'Show projects', exact: true }).click();
        assert.equal(await header(secondProject).getAttribute('aria-expanded'), 'true');
        for (let index = 0; index < 31; index++) await command({ type: 'session.create', projectId: firstProject, title: `History ${index}` });
        await sidebar.getByRole('button', { name: 'Refresh sessions', exact: true }).click();
        await group(firstProject).getByRole('button', { name: 'Older sessions', exact: true }).waitFor();
        let releasePage!: () => void, capturedPage!: () => void;
        const delayedPage = new Promise<void>(resolve => { releasePage = resolve; }), requestedPage = new Promise<void>(resolve => { capturedPage = resolve; });
        await page.route('**/api/sessions?**', async route => {
            const url = new URL(route.request().url());
            if (url.searchParams.get('projectId') !== firstProject || !url.searchParams.has('cursor')) { await route.continue(); return; }
            const response = await route.fetch(); capturedPage(); await delayedPage; await route.fulfill({ response });
        });
        await group(firstProject).getByRole('button', { name: 'Older sessions', exact: true }).click(); await requestedPage;
        await sidebar.getByRole('button', { name: 'Refresh sessions', exact: true }).click();
        releasePage(); await group(firstProject).getByRole('button', { name: /^History 0$/ }).waitFor();
        await page.unroute('**/api/sessions?**');
        assert.equal(await group(secondProject).getByRole('button', { name: 'New in second', exact: true }).count(), 1);
        renameSync(projectTwo, join(home, 'project-two-moved'));
        await sidebar.getByRole('button', { name: 'Refresh sessions', exact: true }).click();
        await group(secondProject).getByText('Directory unavailable', { exact: true }).waitFor();
        assert.equal(await plus(secondProject).isDisabled(), true);
        await group(secondProject).getByRole('button', { name: 'Second history', exact: true }).waitFor();
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ ok: true, checks: ['compact-independent-project-accordions', 'header-plus-add-click-separation', 'same-name-distinguishing-paths', 'nested-correct-session-selection', 'disclosure-preserves-active-chat', 'inactive-project-plus-target-and-repeat', 'mutation-invalidates-stale-history', 'per-project-pagination-during-refresh', 'unavailable-project-readable-history', 'desktop-dark-light-and-collapsed', 'mobile320-390-dark-light-and-focus', 'thin-single-line-desktop-and-touch-rows', 'full-accessible-metadata-and-long-title-ellipsis', 'decorative-svg-navigation-and-compact-brand'], screenshots: ['/tmp/deck-minimal-sidebar-desktop-dark.png', '/tmp/deck-minimal-sidebar-desktop-light.png', '/tmp/deck-minimal-sidebar-mobile-320-dark.png', '/tmp/deck-minimal-sidebar-mobile-390-light.png', '/tmp/deck-minimal-sidebar-collapsed.png'] }));
        await context.close(); return;
    }
    await page.getByRole('button', { name: 'Add project', exact: true }).click();
    let dialog = page.getByRole('dialog');
    if (process.env.DECK_TEST_DIRECTORIES_ONLY) {
        const projectsPath = join(home, 'Proyects'), deckPath = join(projectsPath, 'deck'), spacesPath = join(deckPath, 'packages with spaces'), leafPath = join(spacesPath, 'leaf');
        mkdirSync(leafPath, { recursive: true });
        for (let index = 0; index < 24; index++) mkdirSync(join(projectsPath, index < 6 ? `a-${String(index).padStart(2, '0')}` : `folder-${String(index + 1).padStart(2, '0')}`));
        const queries: string[] = []; page.on('request', request => { if (new URL(request.url()).pathname === '/api/directories') queries.push(request.url()); });
        let input = dialog.getByRole('combobox', { name: 'Directory', exact: true });
        const list = () => page.getByRole('listbox', { name: 'Folder suggestions', exact: true });
        const option = (name: string) => list().getByRole('option', { name, exact: true });
        const focused = () => input.evaluate(element => document.activeElement === element);
        await input.fill(`${projectsPath}/`); await input.press('Control+Space');
        await option('deck').waitFor(); assert.equal(await list().getByRole('option').count(), 25);
        await page.screenshot({ path: '/tmp/deck-directory-ctrl-space.png', fullPage: true });
        await option('deck').click(); await option('packages with spaces').waitFor();
        assert.equal(await input.inputValue(), `${deckPath}/`); assert.equal(await focused(), true);
        await input.press('ArrowDown'); assert.ok(await input.getAttribute('aria-activedescendant'));
        await input.press('Enter'); await option('leaf').waitFor();
        assert.equal(await input.inputValue(), `${spacesPath}/`);
        await input.press('ArrowUp'); await input.press('Enter');
        await dialog.getByText('No subfolders in this directory.', { exact: true }).waitFor();
        assert.equal(await input.inputValue(), `${leafPath}/`);
        assert.equal((await manager.query('projects.list', {}) as any).data.projects.length, 0, 'Keyboard selection never submits the registration form');
        await input.press('Escape'); assert.equal(await list().count(), 0); assert.equal(await dialog.isVisible(), true);
        const before = queries.length; await input.press('Control+Space');
        await dialog.getByText('No subfolders in this directory.', { exact: true }).waitFor();
        assert.ok(queries.length > before, 'Same-path Ctrl+Space makes a new request');
        mkdirSync(join(leafPath, 'late folder'));
        await dialog.getByRole('button', { name: 'Show folders', exact: true }).click(); await option('late folder').waitFor();
        await dialog.getByRole('button', { name: 'Show folders', exact: true }).press('Escape');
        assert.equal(await dialog.isVisible(), true); assert.equal(await list().count(), 0);
        await input.fill(deckPath); await input.press('End'); await input.pressSequentially('/pack');
        await option('packages with spaces').waitFor();
        await input.press('ArrowDown'); await input.press('Enter'); await option('leaf').waitFor();
        assert.equal(await input.inputValue(), `${spacesPath}/`, 'Typed slash/prefix and keyboard selection preserve spaces');
        async function holdLookup(prefix: string) {
            let release!: () => void, captured!: () => void, finished!: () => void, hold = true;
            const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { captured = resolve; }), done = new Promise<void>(resolve => { finished = resolve; });
            await page.route('**/api/directories?**', async route => {
                if (!hold || new URL(route.request().url()).searchParams.get('prefix') !== prefix) { await route.continue(); return; }
                hold = false; const response = await route.fetch(); captured(); await gate;
                await route.fulfill({ response }).catch(() => {}); finished();
            });
            return { ready, release, done };
        }
        let held = await holdLookup('pack');
        await input.fill(`${deckPath}/pack`); await held.ready;
        await input.fill(`${spacesPath}/`); await input.press('Control+Space'); await option('leaf').waitFor();
        held.release(); await held.done; await page.unroute('**/api/directories?**');
        assert.deepEqual(await list().getByRole('option').allTextContents(), ['leaf'], 'Old prefix results cannot replace child folders');
        held = await holdLookup('a-');
        await input.fill(`${projectsPath}/a-`); await held.ready; await input.press('Escape');
        mkdirSync(join(projectsPath, 'a-new'));
        await input.press('Control+Space'); await option('a-new').waitFor();
        held.release(); await held.done; await page.unroute('**/api/directories?**');
        await option('a-new').waitFor();
        held = await holdLookup('folder-');
        await input.fill(`${projectsPath}/folder-`); await held.ready;
        await input.press('Escape'); await input.press('Escape'); await dialog.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: 'Add project', exact: true }).click(); dialog = page.getByRole('dialog'); input = dialog.getByRole('combobox', { name: 'Directory', exact: true });
        await input.fill(`${deckPath}/`); await input.press('Control+Space'); await option('packages with spaces').waitFor();
        held.release(); await held.done; await page.unroute('**/api/directories?**');
        assert.deepEqual(await list().getByRole('option').allTextContents(), ['packages with spaces'], 'Closed-dialog results cannot leak into a reopened picker');
        let fail = true;
        await page.route('**/api/directories?**', route => fail ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'temporary-directory-failure' }) }) : route.continue());
        await input.press('Control+Space'); await dialog.getByRole('button', { name: 'Retry folders', exact: true }).waitFor();
        await dialog.getByRole('button', { name: 'Retry folders', exact: true }).press('Escape');
        assert.equal(await list().count(), 0); assert.equal(await dialog.isVisible(), true);
        await input.press('Control+Space'); await dialog.getByRole('button', { name: 'Retry folders', exact: true }).waitFor();
        fail = false; await dialog.getByRole('button', { name: 'Retry folders', exact: true }).press('Enter');
        await option('packages with spaces').waitFor(); assert.equal(await focused(), true); await page.unroute('**/api/directories?**');
        await input.fill(`${root}/`); await input.press('Control+Space');
        await dialog.getByRole('button', { name: 'Retry folders', exact: true }).waitFor();
        assert.equal(await list().getByRole('option').count(), 0, 'The real host blocks paths outside its home boundary');
        const submit = dialog.getByRole('button', { name: 'Add project', exact: true }), submitBounds = (await submit.boundingBox())!;
        await page.mouse.move(submitBounds.x + submitBounds.width / 2, submitBounds.y + submitBounds.height / 2); await page.mouse.down();
        assert.deepEqual(await submit.boundingBox(), submitBounds, 'Outside pointerdown must not reflow the submit target before pointerup');
        assert.equal(await list().count(), 1);
        await page.mouse.up(); await dialog.getByRole('alert').waitFor();
        assert.equal((await manager.query('projects.list', {}) as any).data.projects.length, 0);
        await input.press('Escape'); await dialog.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: 'Add project', exact: true }).click(); dialog = page.getByRole('dialog'); input = dialog.getByRole('combobox', { name: 'Directory', exact: true });
        for (const width of [320, 390]) {
            await page.setViewportSize({ width, height: 844 });
            await input.fill(`${projectsPath}/`); await dialog.getByRole('button', { name: 'Show folders', exact: true }).tap(); await option('deck').waitFor();
            await page.screenshot({ path: `/tmp/deck-directory-mobile-${width}.png`, fullPage: true }); await bounds(page);
            await option('deck').tap(); await option('packages with spaces').waitFor();
            await option('packages with spaces').tap(); await option('leaf').waitFor();
            await option('leaf').tap(); await option('late folder').waitFor();
            assert.equal(await input.inputValue(), `${leafPath}/`); assert.equal(await focused(), true, 'Actual touch selection restores input focus');
        }
        await dialog.getByLabel('Project name (optional)', { exact: true }).fill('Nested project');
        await input.press('Control+Space'); await option('late folder').waitFor();
        await dialog.getByRole('button', { name: 'Add project', exact: true }).tap();
        await page.getByRole('button', { name: 'Open sessions', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: /^Sessions in Nested project/ }).waitFor();
        const registered = await manager.query('projects.list', {}) as any;
        assert.equal(registered.data.projects[0].path, leafPath, 'Actual selected nested directory is registered canonically');
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ ok: true, checks: ['ctrl-space-visible-25-child-folders', 'actual-mouse-keyboard-three-level-selection-with-spaces', 'arrows-enter-without-form-submit', 'leaf-empty-vs-error', 'same-path-ctrl-space-and-button-refetch', 'manual-slash-prefix', 'popup-first-escape-from-input-trigger-retry', 'typing-and-close-reopen-stale-response-fences', 'keyboard-error-retry', 'real-home-boundary-and-registration', 'actual-mobile320-390-touch-selection-and-focus'], screenshots: ['/tmp/deck-directory-ctrl-space.png', '/tmp/deck-directory-mobile-320.png', '/tmp/deck-directory-mobile-390.png'] }));
        await context.close(); return;
    }
    await dialog.getByLabel('Directory', { exact: true }).fill(join(home, 'project-'));
    await page.getByRole('option', { name: 'project-one', exact: true }).waitFor();
    await dialog.getByLabel('Directory', { exact: true }).fill(projectOne);
    await dialog.getByLabel('Project name (optional)', { exact: true }).fill('Project One');
    await page.screenshot({ path: '/tmp/deck-workspace-add-project.png', fullPage: true });
    await dialog.getByRole('button', { name: 'Add project', exact: true }).click();
    await page.locator('.sidebar .project-group').getByRole('button', { name: /^Sessions in Project One/ }).waitFor();
    const listed = await manager.query('projects.list', {}) as any, projectId = listed.data.projects[0].projectId;
    async function newSession(title: string, runner = 'claude', model = 'opus') {
        await page.locator(`.sidebar .project-group[data-project-id="${projectId}"]`).getByRole('button', { name: /^New session in / }).click();
        const form = page.getByRole('dialog');
        await form.getByLabel('Session name', { exact: true }).fill(title);
        await form.getByLabel('Runner', { exact: true }).selectOption(runner);
        await form.getByLabel('Model', { exact: true }).selectOption(model);
        await form.getByRole('button', { name: 'Create session', exact: true }).click();
        await page.locator('.app-header').getByRole('heading', { name: title, exact: true }).waitFor();
        const list = await manager.query('sessions.list', { projectId }) as any;
        return list.data.sessions.find((session: any) => session.title === title).sessionId as string;
    }
    async function prepare() {
        await page.locator('.composer-gate').getByRole('button', { name: /^(Prepare session|Retry preparation)$/ }).click();
        await page.getByLabel('Message the lead').waitFor();
    }
    const first = await newSession('First session');
    assert.equal(await page.getByLabel('Message the lead').count(), 0);
    await prepare(); assert.equal(claude.turns.length, 0, 'Preparing does not run inference');
    await page.getByLabel('Message the lead').fill('Keep this draft while reconnecting');
    let blockReplay = true;
    await page.route('**/api/sessions/**/events?**', route => blockReplay ? route.abort() : route.continue());
    await page.evaluate(() => { (window as any).acceptanceSockets.at(-1).close(); });
    await page.locator('.composer-gate').getByRole('button', { name: 'Reconnect', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Message the lead').count(), 0);
    blockReplay = false;
    await page.locator('.composer-gate').getByRole('button', { name: 'Reconnect', exact: true }).click();
    await page.getByLabel('Message the lead').waitFor();
    assert.equal(await page.getByLabel('Message the lead').inputValue(), 'Keep this draft while reconnecting');
    await page.unroute('**/api/sessions/**/events?**');
    await page.getByLabel('Message the lead').fill('First independent prompt'); await page.getByLabel('Message the lead').press('Enter');
    await wait(() => claude.turns.length === 1, 'first model turn');
    await page.locator('.lead-progress:visible').getByText('Using Read…', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Assignments', exact: true }).click(); dialog = page.getByRole('dialog');
    await dialog.getByLabel('Runner', { exact: true }).selectOption('codex'); await dialog.getByLabel('Model', { exact: true }).selectOption('codex-model');
    await dialog.getByRole('button', { name: 'Save assignment', exact: true }).click();
    await dialog.getByRole('alert').getByText(/session-busy/).waitFor();
    await dialog.press('Escape');
    const second = await newSession('Second session'); await prepare();
    await page.getByLabel('Message the lead').fill('Second independent prompt'); await page.getByLabel('Message the lead').press('Enter');
    await wait(() => claude.turns.length === 2, 'second model turn');
    await page.getByRole('button', { name: 'Refresh sessions', exact: true }).click();
    await page.getByText(/Shared directory · 1 other active session/).waitFor();
    await page.getByRole('button', { name: 'First session', exact: true }).click();
    await page.getByRole('button', { name: 'Close session', exact: true }).click();
    await page.locator('.composer-gate').getByRole('button', { name: 'Prepare session', exact: true }).waitFor();
    assert.equal(claude.turns[0]!.finished, true); assert.equal(claude.turns[1]!.finished, false, 'Other session keeps running');
    assert.equal(await page.getByLabel('Message the lead').count(), 0);
    await page.getByRole('region', { name: 'Conversation', exact: true }).getByText('claude response from lead', { exact: true }).waitFor();
    await prepare();
    await page.locator('.app-header').getByRole('heading', { name: 'First session', exact: true }).waitFor();
    const retained = (await manager.query('sessions.list', { projectId }) as any).data.sessions.filter((item: any) => item.title === 'First session');
    assert.equal(retained.length, 1); assert.equal(retained[0].sessionId, first);
    claude.turns[1]!.emit('tool.completed', { toolCallId: 'browser-read', output: 'Second completed' }); claude.turns[1]!.finish();
    await wait(() => !manager.hasRunningWork(), 'idle sessions');
    await page.getByRole('button', { name: 'Second session', exact: true }).click();
    await page.getByRole('button', { name: 'Assignments', exact: true }).click(); dialog = page.getByRole('dialog');
    await dialog.getByLabel('Runner', { exact: true }).selectOption('codex'); await dialog.getByLabel('Model', { exact: true }).selectOption('codex-model');
    await page.screenshot({ path: '/tmp/deck-workspace-assignments.png', fullPage: true });
    await dialog.getByRole('button', { name: 'Save assignment', exact: true }).click();
    await page.locator('.lead-identity').getByText('codex', { exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Activity', exact: true }).click();
    await page.getByText('Lead assignment changed', { exact: true }).waitFor();
    await page.getByText(/New native context with a limited handoff/).waitFor();
    assert.equal(await page.getByLabel('Message the lead').count(), 0);
    await prepare(); await page.getByLabel('Message the lead').fill('New runner prompt'); await page.getByLabel('Message the lead').press('Enter');
    await wait(() => codex.turns.length === 1, 'new Lead generation');
    assert.equal(codex.turns[0]!.input.taskId, 'lead-g1'); assert.equal(codex.turns[0]!.input.resume, undefined);
    const chat = page.getByRole('region', { name: 'Conversation', exact: true });
    await chat.getByText('codex response from lead-g1', { exact: true }).waitFor();
    assert.equal(await chat.getByText('claude response from lead', { exact: true }).count(), 1);
    assert.ok((await chat.innerText()).includes('claude · opus')); assert.ok((await chat.innerText()).includes('codex · codex-model'));
    await page.locator('.lead-progress:visible').getByText('Using Read…', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Interrupt', exact: true }).click();
    await wait(() => codex.turns[0]!.interrupts.length === 1 && !manager.hasRunningWork(), 'current-generation interrupt');
    // Interrupt intentionally pauses future sends, even when the inbox is empty.
    await page.getByRole('region', { name: 'Queued messages', exact: true }).getByRole('button', { name: 'Resume queue', exact: true }).click();
    await page.getByRole('button', { name: 'Assignments', exact: true }).click(); dialog = page.getByRole('dialog');
    await dialog.getByLabel('Member', { exact: true }).selectOption('reviewer'); await dialog.getByLabel('Model', { exact: true }).selectOption('sonnet');
    await dialog.getByRole('button', { name: 'Save assignment', exact: true }).click();
    await wait(async () => (await manager.query('sessions.list', { projectId }) as any).data.sessions.find((item: any) => item.sessionId === second).members.reviewer.modelId === 'sonnet', 'member override');
    // The selected session is deliberately pushed beyond the first page before an external change.
    for (let index = 0; index < 31; index++) await command({ type: 'session.create', projectId, title: `History ${index}` });
    await page.getByRole('button', { name: 'Refresh sessions', exact: true }).click();
    await page.getByRole('button', { name: 'Older sessions', exact: true }).click();
    await page.getByRole('button', { name: 'First session', exact: true }).first().waitFor();
    const prior = (await manager.query('sessions.list', { projectId }) as any).data.sessions.find((item: any) => item.sessionId === second);
    await command({ type: 'session.assignMember', memberId: 'lead', assignment: { runnerId: 'claude', modelId: 'sonnet' }, expectedRevision: prior.assignmentRevision }, second);
    await page.locator('.lead-identity').getByText('claude', { exact: true }).waitFor({ timeout: 1500 });
    await page.locator('.lead-identity').getByText('sonnet', { exact: true }).waitFor({ timeout: 1500 });
    await prepare(); await page.getByLabel('Message the lead').fill('External assignment is current'); await page.getByLabel('Message the lead').press('Enter');
    await wait(() => claude.turns.length === 3, 'second generation'); assert.equal(claude.turns[2]!.input.taskId, 'lead-g2');
    await page.getByRole('button', { name: 'Interrupt', exact: true }).click(); await wait(() => !manager.hasRunningWork(), 'second-generation interrupt');
    await bounds(page); await page.screenshot({ path: '/tmp/deck-workspace-desktop.png', fullPage: true });
    const registeredTwo = await command({ type: 'project.register', path: projectTwo, name: 'Project Two' });
    await command({ type: 'session.create', projectId: registeredTwo.project.projectId, title: 'Unavailable project history' });
    renameSync(projectTwo, join(home, 'project-two-moved'));
    await page.getByRole('button', { name: 'Refresh sessions', exact: true }).click();
    const secondGroup = page.locator(`.sidebar .project-group[data-project-id="${registeredTwo.project.projectId}"]`);
    await secondGroup.getByText('Directory unavailable', { exact: true }).waitFor();
    await secondGroup.getByRole('button', { name: /^Sessions in / }).click();
    await page.getByRole('button', { name: 'Unavailable project history', exact: true }).waitFor();
    assert.equal(await secondGroup.getByRole('button', { name: /^New session in / }).isDisabled(), true);
    await page.getByRole('button', { name: 'Unavailable project history', exact: true }).click();
    await page.locator('.app-header').getByRole('heading', { name: 'Unavailable project history', exact: true }).waitFor();
    await manager.close(); manager = createManager();
    await page.reload();
    await page.getByRole('button', { name: 'Unavailable project history', exact: true }).waitFor();
    await page.locator(`.sidebar .project-group[data-project-id="${projectId}"]`).getByRole('button', { name: /^Sessions in / }).click();
    await page.getByRole('button', { name: 'Older sessions', exact: true }).click();
    await page.getByRole('button', { name: 'Second session', exact: true }).click();
    await page.locator('.lead-identity').getByText('sonnet', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Message the lead').count(), 0, 'Restart requires preparation again');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Open sessions', exact: true }).click();
    await page.screenshot({ path: '/tmp/deck-workspace-mobile-projects.png', fullPage: true });
    await page.getByRole('dialog').getByRole('button', { name: /^New session in Project One/ }).click();
    dialog = page.getByRole('dialog'); await dialog.getByLabel('Session name', { exact: true }).fill('Mobile session');
    await dialog.getByLabel('Runner', { exact: true }).selectOption('codex'); await dialog.getByLabel('Model', { exact: true }).selectOption('codex-model');
    await dialog.getByRole('button', { name: 'Create session', exact: true }).click();
    await page.locator('.app-header').getByRole('heading', { name: 'Mobile session', exact: true }).waitFor();
    await prepare(); await page.getByRole('tab', { name: 'Activity', exact: true }).click();
    await page.getByRole('button', { name: 'Assignments', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Runner', { exact: true }).waitFor(); await bounds(page);
    await page.getByRole('dialog').press('Escape');
    assert.equal(await page.getByRole('button', { name: 'Assignments', exact: true }).evaluate(element => document.activeElement === element), true);
    await page.getByRole('tab', { name: 'Chat', exact: true }).click();
    await bounds(page); await page.screenshot({ path: '/tmp/deck-workspace-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, checks: ['real-project-home-completion', 'independent-named-sessions', 'non-inference-preparation-gate', 'explicit-reconnect-draft', 'busy-assignment-rejection', 'shared-workspace-indicator', 'close-isolation-history', 'same-session-reprepare', 'lead-runner-transition-and-provenance', 'new-generation-tools-progress-interrupt', 'member-override', 'first-click-history-pagination', 'external-old-page-assignment', 'unavailable-project-history', 'restart-persistence', 'mobile-project-session-dialog-keyboard', 'desktop-mobile-document-bounds'], screenshots: ['/tmp/deck-workspace-add-project.png', '/tmp/deck-workspace-assignments.png', '/tmp/deck-workspace-desktop.png', '/tmp/deck-workspace-mobile-projects.png', '/tmp/deck-workspace-mobile.png'] }));
    await context.close();
} catch (cause) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) { console.error('WORKSPACE_FAILURE', await page.locator('body').innerText()); await page.screenshot({ path: '/tmp/deck-workspace-failure.png', fullPage: true }); }
    throw cause;
} finally { await browser.close(); await host.close(); await manager.close(); rmSync(root, { recursive: true, force: true }); }
}
await acceptance();
