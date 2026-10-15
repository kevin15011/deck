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
const context = await browser.newContext({viewport:{width:1440,height:1000},hasTouch:true}), page=await context.newPage();
page.setDefaultTimeout(7000); const checks:string[]=[];
try {
 const first=(await command({type:'project.register',path:projectOne,name:'First project'})).project;
 const second=(await command({type:'project.register',path:projectTwo,name:'Second project'})).project;
 const firstSession=(await command({type:'session.create',projectId:first.projectId,title:'First conversation'})).sessionId;
 await command({type:'session.create',projectId:second.projectId,title:'Second conversation'});
 await page.goto(host.status().url!);
 const sidebar=page.getByRole('navigation',{name:'Sessions',exact:true});
 const group=(id:string,surface=sidebar)=>surface.locator(`.project-group[data-project-id="${id}"]`);
 const more=(id:string,surface=sidebar)=>group(id,surface).getByRole('button',{name:/^More options for /});
 const disclosure=(id:string,surface=sidebar)=>group(id,surface).getByRole('button',{name:/^Sessions in /});
 const current=page.locator('.app-header h1');
 await group(first.projectId).getByRole('button',{name:'First conversation',exact:true}).click();
 await page.locator('.composer-gate').getByRole('button',{name:'Prepare session',exact:true}).click();
 await page.getByLabel('Message the lead').fill('Start actual work'); await page.getByLabel('Message the lead').press('Enter');
 await wait(()=>claude.turns.length===1,'actual active Lead');
 await page.getByLabel('Message the lead').fill('Draft kept when this project is hidden');
 const beforeExpanded=await disclosure(first.projectId).getAttribute('aria-expanded');
 await more(first.projectId).focus();await more(first.projectId).press('ArrowDown');
 const menu=page.getByRole('menu');await menu.waitFor();
 assert.equal(await menu.getByRole('menuitem',{name:'Rename project',exact:true}).evaluate(element=>element===document.activeElement),true);
 await page.keyboard.press('ArrowDown');assert.equal(await menu.getByRole('menuitem',{name:'Remove project',exact:true}).evaluate(element=>element===document.activeElement),true);
 await page.keyboard.press('Home');await page.keyboard.press('End');await page.keyboard.press('Escape');
 assert.equal(await menu.count(),0);assert.equal(await more(first.projectId).evaluate(element=>element===document.activeElement),true);
 assert.equal(await disclosure(first.projectId).getAttribute('aria-expanded'),beforeExpanded);assert.equal(await page.getByRole('dialog').count(),0);
 await more(first.projectId).click();await page.getByLabel('Message the lead').click();assert.equal(await menu.count(),0);
 await more(first.projectId).click();await page.keyboard.press('Tab');assert.equal(await menu.count(),0);
 checks.push('separate-svg-menu-keyboard-escape-outside-tab');

 await more(second.projectId).click();await menu.getByRole('menuitem',{name:'Rename project',exact:true}).click();
 let dialog=page.getByRole('dialog');const name=dialog.getByLabel('Project name',{exact:true});
 assert.equal(await name.inputValue(),'Second project');assert.equal(await name.evaluate(element=>element===document.activeElement),true);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await wait(()=>more(second.projectId).evaluate(element=>element===document.activeElement),'rename cancel focus');
 await more(second.projectId).press('ArrowDown');await page.keyboard.press('Enter');
 dialog=page.getByRole('dialog');await dialog.getByLabel('Project name',{exact:true}).fill('   ');
 assert.equal(await dialog.getByRole('button',{name:'Save name',exact:true}).isDisabled(),true);
 await dialog.getByLabel('Project name',{exact:true}).fill('Renamed second');
 let reject=true;
 await page.route('**/api/commands',async route=>{const body=route.request().postDataJSON();if(reject&&body.command.type==='project.rename'){reject=false;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,code:'simulated-rename-failure',message:'Rename could not be saved.'})});}else await route.continue();});
 await dialog.getByRole('button',{name:'Save name',exact:true}).click();await dialog.getByRole('alert').getByText('Rename could not be saved.',{exact:true}).waitFor();
 assert.match(await disclosure(second.projectId).getAttribute('aria-label')??'',/Second project/);assert.equal(await current.innerText(),'First conversation');
 await dialog.getByRole('button',{name:'Save name',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.unroute('**/api/commands');
 await wait(async()=>!!(await disclosure(second.projectId).getAttribute('aria-label'))?.includes('Renamed second'),'rename persisted');
 assert.equal(await current.innerText(),'First conversation');assert.equal(await page.getByLabel('Message the lead').inputValue(),'Draft kept when this project is hidden');
 assert.equal(await disclosure(second.projectId).getAttribute('aria-expanded'),'false','rename does not expand project');
 await group(second.projectId).getByRole('button',{name:/^New session in /}).click();await page.getByRole('dialog').getByRole('heading',{name:'New session',exact:true}).waitFor();await page.getByRole('dialog').getByText(projectTwo,{exact:true}).waitFor();await page.keyboard.press('Escape');
 checks.push('inactive-target-rename-validation-failure-retry-plus-separation');

 await more(second.projectId).click();await menu.getByRole('menuitem',{name:'Remove project',exact:true}).click();await group(second.projectId).waitFor({state:'detached'});
 assert.equal(await current.innerText(),'First conversation');assert.equal(await page.getByLabel('Message the lead').inputValue(),'Draft kept when this project is hidden');assert.equal(claude.turns[0]!.finished,false);
 const add=async(path:string)=>{await sidebar.getByRole('button',{name:'Add project',exact:true}).click();const form=page.getByRole('dialog');
  let releaseFolders!:()=>void,foldersRequested!:()=>void,foldersSettled!:()=>void;let held=true,folderCaptured=false;
  const folderDelay=new Promise<void>(resolve=>{releaseFolders=resolve;}),folderRequest=new Promise<void>(resolve=>{foldersRequested=resolve;}),folderDone=new Promise<void>(resolve=>{foldersSettled=resolve;});
  await page.route('**/api/directories?**',async route=>{if(!held){await route.continue();return;}held=false;const response=await route.fetch();folderCaptured=true;foldersRequested();await folderDelay;await route.fulfill({response}).catch(()=>{});foldersSettled();});
  await form.getByRole('combobox',{name:'Directory',exact:true}).fill(path);await wait(()=>folderCaptured,'manual directory lookup captured');
  const submit=form.getByRole('button',{name:'Add project',exact:true}),before=await submit.boundingBox();assert.ok(before);
  await page.mouse.move(before.x+before.width/2,before.y+before.height/2);await page.mouse.down();releaseFolders();await folderDone;await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const during=await submit.boundingBox();assert.deepEqual(during,before,'pending folder response cannot move a held Add click');await page.mouse.up();await form.waitFor({state:'hidden'});await page.unroute('**/api/directories?**');};
 await add(projectTwo);await group(second.projectId).getByRole('button',{name:'Second conversation',exact:true}).waitFor();
 assert.match(await disclosure(second.projectId).getAttribute('aria-label')??'',/Renamed second/);checks.push('inactive-hide-preserves-work-draft-readd-identity-history-name');

 // An old project catalog snapshot must not resurrect a row after successful removal.
 let release!:()=>void,captured!:()=>void,fulfilled!:()=>void;
 const delay=new Promise<void>(resolve=>{release=resolve;}),requested=new Promise<void>(resolve=>{captured=resolve;}),settled=new Promise<void>(resolve=>{fulfilled=resolve;});let hold=true;
 await page.route('**/api/projects',async route=>{if(!hold){await route.continue();return;}hold=false;const response=await route.fetch();captured();await delay;await route.fulfill({response});fulfilled();});
 await sidebar.getByRole('button',{name:'Refresh sessions',exact:true}).click();await requested;
 await more(second.projectId).click();await menu.getByRole('menuitem',{name:'Remove project',exact:true}).click();await group(second.projectId).waitFor({state:'detached'});release();await settled;await page.unroute('**/api/projects');await Bun.sleep(80);
 assert.equal(await group(second.projectId).count(),0);assert.equal(await current.innerText(),'First conversation');await add(projectTwo);await group(second.projectId).getByRole('button',{name:'Second conversation',exact:true}).waitFor();
 checks.push('stale-catalog-cannot-resurrect-hidden-project');

 // Removal response is delayed while the user selects a different conversation.
 let finishRemove!:()=>void,removed!:()=>void;const heldRemove=new Promise<void>(resolve=>{finishRemove=resolve;}),removeApplied=new Promise<void>(resolve=>{removed=resolve;});
 await page.route('**/api/commands',async route=>{const body=route.request().postDataJSON();if(body.command.type==='project.remove'&&body.command.projectId===first.projectId){const response=await route.fetch();removed();await heldRemove;await route.fulfill({response});}else await route.continue();});
 await more(first.projectId).click();await menu.getByRole('menuitem',{name:'Remove project',exact:true}).click();await removeApplied;
 await group(second.projectId).getByRole('button',{name:'Second conversation',exact:true}).click();await wait(async()=>await current.innerText()==='Second conversation','switch during hide request');
 finishRemove();await group(first.projectId).waitFor({state:'detached'});await page.unroute('**/api/commands');assert.equal(await current.innerText(),'Second conversation');assert.equal(claude.turns[0]!.finished,false);
 await more(second.projectId).click();await menu.getByRole('menuitem',{name:'Remove project',exact:true}).click();await group(second.projectId).waitFor({state:'detached'});
 await page.getByText('Choose a session or create one to start.',{exact:true}).waitFor();assert.equal(await page.getByText('claude response from lead',{exact:true}).count(),0);
 await add(projectOne);await group(first.projectId).getByRole('button',{name:'First conversation',exact:true}).click();await page.getByLabel('Message the lead').waitFor(); await page.getByRole('region',{name:'Conversation',exact:true}).getByText('claude response from lead',{exact:true}).waitFor(); assert.equal(await page.getByLabel('Message the lead').inputValue(),'Draft kept when this project is hidden');
 await add(projectTwo);await group(second.projectId).getByRole('button',{name:'Second conversation',exact:true}).waitFor();
 checks.push('late-remove-does-not-clear-new-selection-last-hide-safe-empty-draft-restored');

 await more(first.projectId).click();await bounds(page);await page.screenshot({path:'/tmp/deck-project-actions-desktop-dark.png',fullPage:true});await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Switch to light theme',exact:true}).click();await more(second.projectId).click();await page.screenshot({path:'/tmp/deck-project-actions-desktop-light.png',fullPage:true});await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Open sessions',exact:true}).tap();
 let drawer=page.getByRole('dialog');await more(first.projectId,drawer).tap();await menu.waitFor();
 const menuBounds=await menu.boundingBox();assert.ok(menuBounds&&menuBounds.x>=0&&menuBounds.x+menuBounds.width<=390);
 await menu.getByRole('menuitem',{name:'Rename project',exact:true}).tap();dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'Rename project',exact:true}).waitFor();await dialog.getByLabel('Project name',{exact:true}).fill('Mobile project');await page.screenshot({path:'/tmp/deck-project-actions-rename.png',fullPage:true});await dialog.getByRole('button',{name:'Save name',exact:true}).tap();
 await wait(()=>page.getByRole('button',{name:'Open sessions',exact:true}).evaluate(element=>element===document.activeElement),'mobile rename returns to visible navigation trigger');
 await page.getByRole('button',{name:'Open sessions',exact:true}).tap();drawer=page.getByRole('dialog');await more(first.projectId,drawer).tap();await bounds(page);await page.screenshot({path:'/tmp/deck-project-actions-mobile-390.png',fullPage:true});
 await page.keyboard.press('Escape');assert.equal(await menu.count(),0);assert.equal(await drawer.isVisible(),true,'Escape closes menu before drawer');
 await page.setViewportSize({width:320,height:740});await more(second.projectId,drawer).tap();await menu.waitFor();await bounds(page);await page.screenshot({path:'/tmp/deck-project-actions-mobile-320.png',fullPage:true});
 await menu.getByRole('menuitem',{name:'Remove project',exact:true}).tap();await group(second.projectId,drawer).waitFor({state:'detached'});assert.equal(await current.innerText(),'First conversation');
 checks.push('desktop-light-dark-mobile390-320-touch-menu-rename-remove-focus-bounds');
 await command({type:'session.stop'},firstSession);assert.equal(claude.turns[0]!.finished,true);
 console.log(JSON.stringify({passed:checks,screenshots:['/tmp/deck-project-actions-desktop-dark.png','/tmp/deck-project-actions-desktop-light.png','/tmp/deck-project-actions-rename.png','/tmp/deck-project-actions-mobile-390.png','/tmp/deck-project-actions-mobile-320.png']}));
} catch(cause){console.error('PROJECT_ACTIONS_FIELDS',await page.locator('input').evaluateAll(inputs=>inputs.filter((input): input is HTMLInputElement => input instanceof HTMLInputElement).map(input=>({value:input.value,expanded:input.getAttribute('aria-expanded'),focused:input===document.activeElement,disabled:input.disabled}))));console.error('PROJECT_ACTIONS_FAILURE',await page.locator('body').innerText());await page.screenshot({path:'/tmp/deck-project-actions-failure.png',fullPage:true});throw cause;}
finally{await browser.close();await host.close();await manager.close();rmSync(root,{recursive:true,force:true});}
