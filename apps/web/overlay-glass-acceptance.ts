/** Isolated real-app overlay acceptance. Fake runner effects only; no shared daemon.
 * DECK_TEST_CHROME=/snap/bin/chromium bun run apps/web/overlay-glass-acceptance.ts
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
const runStarted=performance.now();
const WEB_ASSETS = await buildWebAssets();

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
    for (let attempt = 0; attempt < 600; attempt++) { if (await condition()) return; await Bun.sleep(25); }
    throw new Error(`Timed out: ${label}`);
};




const output='/tmp/deck-overlay-glass';mkdirSync(output,{recursive:true});
const context=await browser.newContext({viewport:{width:1440,height:844},deviceScaleFactor:1});const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
try {
const projectId=(await command({type:'project.register',path:projectOne,name:'Overlay glass project'})).project.projectId;
const title='Review overlay materials and mobile drawer';
const id=(await command({type:'session.create',projectId,title})).sessionId;await command({type:'session.prepare'},id);
await page.goto(host.status().url!);await page.getByRole('button',{name:title,exact:true}).first().click();await page.getByRole('heading',{name:title,exact:true}).waitFor();
const measurements=[];
for(const width of [1440,360,390,430]) {
 await page.setViewportSize({width,height:844});
 for(const theme of ['dark','light','one-dark-pro','one-dark-blood']) {
 await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
 if(width<1000) {
 await page.getByRole('button',{name:'Open sessions',exact:true}).click();await page.waitForTimeout(350);
 const drawer=page.locator('.session-drawer');assert(await drawer.isVisible());
 const paint=await drawer.evaluate(e=>({fill:getComputedStyle(e).backgroundColor,blur:getComputedStyle(e).backdropFilter,x:e.getBoundingClientRect().x}));assert(paint.blur.includes('blur'));assert(Math.abs(paint.x)<1);measurements.push({width,theme,paint});
 await page.screenshot({path:join(output,`${width}-${theme}-drawer.png`)});
 await page.keyboard.press('Escape');await page.waitForTimeout(250);assert.equal(await drawer.isVisible(),false);assert.equal(await page.getByRole('button',{name:'Open sessions',exact:true}).evaluate(e=>e===document.activeElement),true);
 } else {
 await page.locator('.session-compact-toggle').click();await page.waitForTimeout(300);
 const paint=await page.locator('.session-controls-panel').evaluate(e=>({fill:getComputedStyle(e).backgroundColor,blur:getComputedStyle(e).backdropFilter}));assert(paint.blur.includes('blur'));measurements.push({width,theme,paint});
 await page.screenshot({path:join(output,`${width}-${theme}-controls.png`)});await page.keyboard.press('Escape');
 }
 }
}
await page.setViewportSize({width:1440,height:844});
await page.locator('.sidebar .project-more').first().click();await page.waitForTimeout(300);assert(await page.locator('.project-menu').isVisible());await page.screenshot({path:join(output,'project-menu.png')});await page.keyboard.press('Escape');
await page.getByRole('button',{name:'Settings',exact:true}).click();await page.waitForTimeout(300);await page.screenshot({path:join(output,'settings.png')});
await page.getByRole('menuitem').filter({hasText:'Theme'}).click();await page.waitForTimeout(350);assert(await page.locator('.theme-dialog').isVisible());await page.screenshot({path:join(output,'theme-dialog.png')});await page.keyboard.press('Escape');await page.waitForTimeout(350);
await page.setViewportSize({width:390,height:844});
for(const reducedMotion of ['no-preference','reduce'] as const){
 await page.emulateMedia({reducedMotion});
 await page.getByRole('button',{name:'Open sessions',exact:true}).click();await page.waitForTimeout(60);
 if(reducedMotion==='no-preference') {
 const x=await page.locator('.session-drawer').evaluate(e=>e.getBoundingClientRect().x);assert(x<0&&x>-360,'drawer has an intermediate entrance position');
 }
 await page.getByRole('button',{name:'Close sessions',exact:true}).evaluate(e=>(e as HTMLButtonElement).click());
 // History reversal while the exit is in flight must retarget the same native dialog.
 await page.waitForFunction(()=>!history.state?.deck?.route?.overlay);await page.goForward();await page.waitForTimeout(350);assert(await page.locator('.session-drawer').isVisible());
 await page.keyboard.press('Tab');assert(await page.locator('.session-drawer').evaluate(e=>e.contains(document.activeElement)));
 await page.keyboard.press('Escape');await page.waitForTimeout(250);assert.equal(await page.locator('.session-drawer').isVisible(),false);
}
await page.emulateMedia({reducedMotion:'reduce'});
const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
await page.getByRole('button',{name:'Open sessions',exact:true}).click();await page.waitForTimeout(350);assert.equal(await page.locator('.session-drawer').evaluate(e=>getComputedStyle(e).backdropFilter),'none');await page.screenshot({path:join(output,'reduced-transparency.png')});await page.keyboard.press('Escape');await page.waitForTimeout(250);
await cdp.send('Emulation.setEmulatedMedia',{features:[]});
await page.getByRole('button',{name:'Open sessions',exact:true}).click();await page.waitForTimeout(350);await page.locator('.theme-menu-item').filter({hasText:'Theme'}).click();await page.waitForTimeout(400);assert(await page.locator('.theme-dialog').isVisible());await page.screenshot({path:join(output,'mobile-theme-dialog.png')});await page.keyboard.press('Escape');await page.waitForTimeout(350);
await page.emulateMedia({forcedColors:'active'});await page.getByRole('button',{name:'Open sessions',exact:true}).click();await page.waitForTimeout(100);
assert.equal(await page.locator('.session-drawer').evaluate(e=>getComputedStyle(e).backdropFilter),'none');await page.screenshot({path:join(output,'forced-colors.png')});
assert.deepEqual(errors,[]);await Bun.write(join(output,'measurements.json'),JSON.stringify({measurements,errors},null,2));console.log(JSON.stringify({ok:true,output,scenes:22,durationMs:Math.round(performance.now()-runStarted)}));
}catch(e){console.error(e);process.exitCode=1;}
finally{await browser.close();host.disable();await manager.close();rmSync(root,{recursive:true,force:true});process.exit(process.exitCode??0);}
