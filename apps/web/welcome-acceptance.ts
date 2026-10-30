/** Isolated real-app welcome acceptance. Fake runner effects only; no shared daemon.
 * DECK_TEST_CHROME=/snap/bin/chromium bun run apps/web/welcome-acceptance.ts
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





const output='/tmp/deck-welcome';mkdirSync(output,{recursive:true});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
try {
const projectId=(await command({type:'project.register',path:projectOne,name:'Welcome project'})).project.projectId;
const id=(await command({type:'session.create',projectId,title:'A fresh idea'})).sessionId;await command({type:'session.prepare'},id);
await page.goto(host.status().url!);await page.getByRole('button',{name:'A fresh idea',exact:true}).first().click();
await page.waitForFunction(()=>getComputedStyle(document.querySelector('.conversation-welcome')!).visibility==='visible');
const input=page.locator('#prompt');
const measurements=[];
for(const width of [1440,360,390,430])for(const theme of ['light','dark','one-dark-pro','one-dark-blood']){
 await page.setViewportSize({width,height:900});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
 for(const font of ['system','source-serif-4','jetbrains-mono']){
 await page.evaluate(f=>document.documentElement.dataset.font=f,font);await input.fill('An idea worth building');await input.focus();await page.waitForTimeout(80);
 const geometry=await page.evaluate(()=>{const input=document.querySelector('#prompt')!,g=document.querySelector('.conversation-welcome')!,p=document.querySelector('.chat-pane')!;return {input:input.getBoundingClientRect().toJSON(),greeting:g.getBoundingClientRect().toJSON(),pane:p.getBoundingClientRect().toJSON(),count:document.querySelectorAll('#prompt').length};});
 assert.equal(geometry.count,1);assert(geometry.input.top>=geometry.greeting.bottom);assert(geometry.input.bottom<geometry.pane.bottom);measurements.push({width,theme,font,geometry});
 if(font==='system')await page.screenshot({path:join(output,`${width}-${theme}-welcome.png`)});
 }
}
await page.setViewportSize({width:1440,height:900});
// Rejected command preserves the actual input, draft and focus through reversal.
await input.fill('Keep my draft on failure');await input.focus();
await page.evaluate(()=>{(window as any).originalInput=document.querySelector('#prompt');});
await page.route('**/api/commands',async route=>{const body=route.request().postDataJSON();if(body.command?.type==='prompt.send'){await new Promise(r=>setTimeout(r,180));await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Fixture rejected send'})});}else await route.continue();});
await input.press('Enter');await page.waitForTimeout(60);
assert.equal(await page.locator('.conversation-welcome').getAttribute('aria-hidden'),'true');
assert(await page.locator('.composer-dock').evaluate(e=>Number((getComputedStyle(e).transform.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,[^,]+,\s*([^\)]+)/)||[])[1])<0));
await page.waitForFunction(()=>document.querySelector('.conversation-welcome')?.getAttribute('aria-hidden')==='false');await page.waitForTimeout(500);
assert.equal(await input.inputValue(),'Keep my draft on failure');
assert(await input.evaluate(e=>e===(window as any).originalInput&&e===document.activeElement));
await page.screenshot({path:join(output,'failed-send-restored.png')});await page.unroute('**/api/commands');
await input.press('Enter');await page.locator('.message.user').filter({hasText:'Keep my draft on failure'}).waitFor();await page.waitForTimeout(550);
assert(await input.evaluate(e=>e===(window as any).originalInput));assert.equal(await page.locator('.conversation-welcome').getAttribute('aria-hidden'),'true');
assert.equal(await page.locator('.composer-dock').evaluate(e=>Math.round(e.getBoundingClientRect().bottom-e.parentElement!.getBoundingClientRect().bottom)),0);
await page.screenshot({path:join(output,'first-send-chat.png')});
await page.reload();await page.locator('.message.user').filter({hasText:'Keep my draft on failure'}).waitFor();assert.equal(await page.locator('.conversation-welcome').getAttribute('aria-hidden'),'true');
// Empty/populated routes must not share welcome state; reduced motion settles immediately.
let empty=(await command({type:'session.create',projectId,title:'Second empty conversation'})).sessionId;await command({type:'session.prepare'},empty);
const base=host.status().url!;
for(const reducedMotion of ['no-preference','reduce'] as const){
 await page.emulateMedia({reducedMotion});
 await page.goto(`${base}?session=${empty}`);await page.waitForFunction(()=>document.querySelector('.conversation-welcome')?.getAttribute('aria-hidden')==='false');await page.waitForTimeout(500);
 await page.setViewportSize({width:390,height:520});await input.fill('Mobile keyboard draft');await input.focus();await page.waitForTimeout(100);
 assert(await input.evaluate(e=>e.getBoundingClientRect().bottom<=window.innerHeight));await page.screenshot({path:join(output,`mobile-keyboard-${reducedMotion}.png`)});
 await page.getByRole('button',{name:'Send prompt',exact:true}).click();await page.locator('.message.user, .prompt-queue').filter({hasText:'Mobile keyboard draft'}).first().waitFor();await page.waitForTimeout(500);
 assert.equal(await page.locator('.conversation-welcome').getAttribute('aria-hidden'),'true');
 // Go to the first populated session and back while preserving full history.
 await page.goto(`${base}?session=${id}`);await page.locator('.message.user').filter({hasText:'Keep my draft on failure'}).waitFor();assert.equal(await page.locator('.conversation-welcome').getAttribute('aria-hidden'),'true');
 // A new empty session for the next preference run.
 if(reducedMotion==='no-preference'){empty=(await command({type:'session.create',projectId,title:'Reduced empty'})).sessionId;await command({type:'session.prepare'},empty);}
}

// Real client navigation while a target's summary is held/failing.
await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'no-preference'});
const fresh=(await command({type:'session.create',projectId,title:'Switch target empty'})).sessionId;await command({type:'session.prepare'},fresh);
await page.reload();await page.locator('.sidebar button.session').filter({hasText:'Switch target empty'}).waitFor();
let release!:()=>void,seen!:()=>void;const gate=new Promise<void>(r=>release=r),observed=new Promise<void>(r=>seen=r);
await page.route(`**/api/sessions/${fresh}/summary`,async route=>{seen();await gate;try{await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,message:'Controlled summary failure'})});}catch{}});
await page.locator('.sidebar button.session').filter({hasText:'Switch target empty'}).click();await observed;
assert.equal(await page.locator('.conversation-welcome').getAttribute('aria-hidden'),'true');
await page.screenshot({path:join(output,'loading-no-welcome.png')});release();await page.getByRole('button',{name:'Retry conversation',exact:true}).waitFor();assert.equal(await page.locator('.conversation-welcome').getAttribute('aria-hidden'),'true');
await page.screenshot({path:join(output,'load-error-no-welcome.png')});await page.unroute(`**/api/sessions/${fresh}/summary`);await page.getByRole('button',{name:'Retry conversation',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.conversation-welcome')?.getAttribute('aria-hidden')==='false');await page.waitForTimeout(500);
await input.fill('Composition stays here');await input.focus();await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,bubbles:true});await page.waitForTimeout(80);assert.equal(await input.inputValue(),'Composition stays here');assert.equal(await page.locator('.conversation-welcome').getAttribute('aria-hidden'),'false');
for(let i=0;i<3;i++){
 await page.locator('.sidebar button.session').filter({hasText:'A fresh idea'}).click();
 await page.locator('.sidebar button.session').filter({hasText:'Switch target empty'}).click();
}
await page.waitForFunction(()=>document.querySelector('.conversation-welcome')?.getAttribute('aria-hidden')==='false');await page.waitForTimeout(500);assert.equal(await input.inputValue(),'Composition stays here');
await page.screenshot({path:join(output,'rapid-switch-restored.png')});
assert.deepEqual(errors,[]);await Bun.write(join(output,'measurements.json'),JSON.stringify({measurements,errors},null,2));console.log(JSON.stringify({ok:true,output,durationMs:Math.round(performance.now()-runStarted)}));
}catch(e){await page.screenshot({path:join(output,'failure.png')});console.error(e);process.exitCode=1;}
finally{await browser.close();host.disable();await manager.close();rmSync(root,{recursive:true,force:true});process.exit(process.exitCode??0);}
