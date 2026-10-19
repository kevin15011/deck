/** Dev-only README capture. All conversation and results are scripted demo fixtures, not real work.
 * Refresh assets first: bun run scripts/generate-web-assets.ts
 * DECK_TEST_CHROME=/snap/bin/chromium bun run apps/web/showcase-screenshots.ts
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
import { WEB_ASSETS } from '../cli/src/runtime/web-assets.generated';

const root = realpathSync(mkdtempSync(join(homedir(), 'deck-showcase-'))), home = join(root, 'home');
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
const browser = await chromium.launch({ executablePath: process.env.DECK_TEST_CHROME ?? join(homedir(), 'Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), headless: true });
const command = async (body: SessionCommandBody, sessionId?: string) => {
    const result = await manager.execute({ sessionId, clientId: 'acceptance', command: { v: 1, commandId: randomUUID(), ...body } as never });
    assert.equal(result.ok, true, JSON.stringify(result)); return result.ok ? result.data as any : undefined;
};
const wait = async (condition: () => boolean | Promise<boolean>, label: string) => {
    for (let attempt = 0; attempt < 160; attempt++) { if (await condition()) return; await Bun.sleep(25); }
    throw new Error(`Timed out: ${label}`);
};

const output = join(import.meta.dir, '../../docs/assets/screenshots');
const errors: string[] = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
// Only the local WebService is reachable; no remote assets or runner services.
await context.route('**/*', route => new URL(route.request().url()).origin === new URL(host.status().url!).origin ? route.continue() : route.abort());
const page = await context.newPage();
page.setDefaultTimeout(10000);
page.on('pageerror', error => errors.push(error.message));
try {
    mkdirSync(output, { recursive: true });
    const projectId = (await command({ type: 'project.register', path: projectOne, name: 'deck' })).project.projectId;
    for (const title of ['Polish empty states', 'Keyboard navigation']) await command({ type: 'session.create', projectId, title });
    const title = 'Keep search when switching tabs';
    const sessionId = (await command({ type: 'session.create', projectId, title })).sessionId;
    await command({ type: 'session.prepare' }, sessionId);
    await page.goto(host.status().url!);
    await page.getByRole('button', { name: title, exact: true }).first().click();
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    await wait(async () => (await page.locator('.connection').innerText()).includes('Connected'), 'prepared session');
    await command({ type: 'prompt.send', text: 'Keep the session search text when I switch workspace tabs. Please keep the fix small.' }, sessionId);
    await wait(() => claude.turns.length > 0, 'Lead turn');
    const lead = claude.turns[0]!;
    lead.say("I’ll ask **Investigate on Codex** to trace the reset, then **Apply Fast on OpenCode** to make the focused fix. This is local UI state; a separate Quality pass is unnecessary for this low-risk change.");
    const grant = { sessionId, taskId: 'lead', memberId: 'lead', runnerId: 'claude' } as never;
    async function delegate(agent: string, task: string, driver: FakeDriver, result: string) {
        const reply = await manager.callTaskTool(grant, 'deck_delegate', { agent, task });
        assert.equal(reply.ok, true, JSON.stringify(reply));
        const taskId = (reply as any).data.taskId;
        await wait(() => driver.turns.some(turn => turn.input.taskId === taskId), agent);
        const turn = driver.turns.find(turn => turn.input.taskId === taskId)!;
        turn.say(result); turn.finish();
        await wait(() => [...manager.openLog(sessionId)!.readAfter(0)].some(event => event.kind === 'task.result' && event.source.taskId === taskId), `${agent} result`);
    }
    await delegate('investigate', 'Trace why session search resets when switching workspace tabs.', codex, 'Traced the reset to tab-local state. Keep the search draft in the parent workspace.');
    await delegate('apply-fast', 'Preserve the search draft across tabs; cover the regression with a focused test.', opencode, 'Moved the draft to the workspace owner. Tab-switch regression passes; query preserved.');
    lead.say('### Search stays with your workspace\n\nThe query now survives tab changes. **Investigate** traced the reset; **Apply Fast** moved the draft to the workspace owner.\n\n- Added a regression for switching away and back.\n- Focused search and tab checks pass.\n- No changes to session storage or runner behavior.');
    // Completion notices can schedule a follow-up Lead turn. Finish these fake
    // acknowledgements too, so the scene represents a settled conversation.
    claude.onStart = turn => { turn.init(); turn.finish(); };
    lead.finish();
    for (const turn of claude.turns) if (turn !== lead) turn.finish();
    await wait(() => !manager.hasRunningWork(), 'all scripted work settled');
    await page.getByRole('tab', { name: 'Subagents', exact: true }).click();
    await wait(async () => await page.locator('.task-result--preview').count() === 2, 'both delegated results');
    await page.getByText('Search stays with your workspace', { exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    await page.locator('.conversation').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: join(output, 'web-workspace-dark.png'), animations: 'disabled' });
    await page.getByLabel('Theme', { exact: true }).selectOption('light');
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(output, 'web-workspace-light.png'), animations: 'disabled' });
    await page.getByLabel('Theme', { exact: true }).selectOption('dark');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('tab', { name: 'Chat', exact: true }).click();
    await page.waitForTimeout(600);
    await page.locator('.conversation').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.screenshot({ path: join(output, 'web-workspace-mobile.png'), animations: 'disabled' });
    assert.deepEqual(errors, [], 'no browser errors');
    assert.equal(await page.getByRole('alert').count(), 0, 'no error banners');
    console.log(JSON.stringify({ ok: true, output, screenshots: ['web-workspace-dark.png', 'web-workspace-light.png', 'web-workspace-mobile.png'], pageErrors: errors }));
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
    await browser.close(); host.disable(); await manager.close();
    rmSync(root, { recursive: true, force: true });
    process.exit(process.exitCode ?? 0);
}
