/** Real HTTP/WebSocket + persistent SessionManager acceptance; only native inference is faked. */
import { chromium, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { readFileSync, mkdtempSync, mkdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
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

const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-session-release-browser-'))), home = join(root, 'home');
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
const cleanupFailures = new Map<string,number>();
let manager!: SessionManager;
function createManager() {
    const broker = new ApprovalBroker({ sink: { emit: (sessionId, event) => { manager.openLog(sessionId)?.append(event); } } });
    return new SessionManager({ paths, broker, credentials: new CredentialRegistry({ socketPath: paths.socket.path }), supervisor: new Supervisor({ anchorCommand: ['unused'] }), drivers: { get: id => drivers.find(driver => driver.runnerId === id), list: () => drivers }, config: () => config, sessionMcpCommand: ['/not-launched/deck', 'internal', 'session-mcp'], homeDir: home, modelCatalog: async () => catalog, childMcp: async (_runner, context) => ({runnerPackages:()=>[],resolveServer:()=>undefined,release:async()=>{const remaining=cleanupFailures.get(context.sessionId)??0;if(remaining){cleanupFailures.set(context.sessionId,remaining-1);throw new Error('Held managed binding cleanup failure');}}}) });
}
manager = createManager();
const host = new WebService({ paths, assets: WEB_ASSETS, config: config.web, service: {
    uploadAttachment: input => manager.uploadAttachment(input), readAttachment: (sessionId,attachmentId) => manager.readAttachment(sessionId,attachmentId),
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
function png(width:number,height:number,color:number[]) {
 const crc=(data:Uint8Array)=>{let value=0xffffffff;for(const byte of data){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0;};
 const chunk=(type:string,data:Buffer)=>{const name=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);name.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([name,data])),data.length+8);return out;};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 const raw=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=y*(width*3+1)+1+x*3,shade=((x>>5)+(y>>5))%2?.65:1;for(let c=0;c<3;c++)raw[at+c]=Math.round(color[c]!*shade);}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
const firstPNG=png(1400,1000,[130,190,165]),secondPNG=png(700,900,[110,145,210]);
const context=await browser.newContext({viewport:{width:1440,height:1000},hasTouch:true}),page=await context.newPage();page.setDefaultTimeout(7000);const checks:string[]=[];
let unlockDrain!:()=>void, draining=false;
const drain=new Promise<void>(resolve=>{unlockDrain=resolve;}),start=claude.startTask.bind(claude);
claude.startTask=async(input,io)=>{const handle=await start(input,io);if(claude.turns.length!==1)return handle;return {...handle,interrupt:async()=>{draining=true;await drain;await handle.interrupt();},close:async()=>{draining=true;await drain;await handle.close();}};};
try{
 const project=(await command({type:'project.register',path:projectOne,name:'Session lifecycle'})).project;
 const first=(await command({type:'session.create',projectId:project.projectId,title:'Retained conversation'})).sessionId;
 const second=(await command({type:'session.create',projectId:project.projectId,title:'Other active conversation'})).sessionId;
 const legacy=(await command({type:'session.create',projectId:project.projectId,title:'Legacy closed conversation'})).sessionId;
 manager.openLog(legacy)!.append({kind:'message.completed',source:{taskId:'lead',memberId:'lead'},data:{role:'assistant',text:'Legacy retained answer'}});
 await command({type:'session.stop'},legacy);
 const successor=(await command({type:'session.continue',title:'Existing separate successor'},legacy)).sessionId;
 await page.goto(host.status().url!);await page.bringToFront();
 const nav=page.getByRole('navigation',{name:'Sessions',exact:true}),chat=page.getByRole('region',{name:'Conversation',exact:true}),strip=page.getByRole('region',{name:'Attached images',exact:true}),queue=page.getByRole('region',{name:'Queued messages',exact:true});
 const row=(id:string)=>nav.locator(`[data-session-id="${id}"]`);
 const select=async(name:string)=>{await nav.getByRole('button',{name,exact:true}).click();await page.locator('.app-header h1').getByText(name,{exact:true}).waitFor();};
 const prepare=async()=>{await page.locator('.composer-gate').getByRole('button',{name:'Prepare session',exact:true}).click();await page.getByLabel('Message the lead').waitFor();};
 const input=page.getByLabel('Message the lead'),send=page.getByRole('button',{name:'Send prompt',exact:true});
 const attach=async(name:string,buffer:Buffer)=>{const picker=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Attach images',exact:true}).click();await(await picker).setFiles([{name,mimeType:'image/png',buffer}]);await strip.getByText('Ready',{exact:true}).waitFor();};
 await select('Retained conversation');await row(first).getByRole('img',{name:'Disconnected',exact:true}).waitFor();await prepare();await row(first).getByRole('img',{name:'Connected',exact:true}).waitFor();
 await attach('history.png',firstPNG);await input.fill('Image history before closing');await send.click();await wait(()=>claude.turns.length===1,'first native image turn');await chat.getByRole('button',{name:'View image 1: history.png',exact:true}).waitFor();
 await input.fill('Pending preserved on close');await send.click();await queue.getByText('Pending preserved on close',{exact:true}).waitFor();
 await input.fill('Draft preserved on close');await attach('draft.png',secondPNG);
 await select('Other active conversation');await prepare();await input.fill('Other work');await send.click();await wait(()=>claude.turns.length===2,'other native turn');
 await select('Retained conversation');
 let releaseReadiness!:()=>void, readyCaptured=false, readySettled=false, holdReady=true;const oldReady=new Promise<void>(resolve=>{releaseReadiness=resolve;});
 await page.route(`**/api/sessions/${first}/readiness`,async route=>{if(!holdReady){await route.continue();return;}holdReady=false;const response=await route.fetch();readyCaptured=true;await oldReady;await route.fulfill({response}).catch(()=>{});readySettled=true;});
 manager.openLog(first)!.append({kind:'diagnostic',data:{code:'session.preparation',status:'ready',generation:0}});await wait(()=>readyCaptured,'earlier ready response held');
 await page.getByRole('button',{name:'Close session',exact:true}).click();await wait(()=>draining,'owned native drain started');
 await page.locator('.composer-gate').getByRole('button',{name:'Closing session…',exact:true}).waitFor();assert.equal(await input.count(),0);assert.equal(await page.locator('.composer-gate').getByRole('button',{name:'Prepare session',exact:true}).count(),0);assert.equal(claude.turns[1]!.finished,false);await row(first).getByRole('img',{name:'Disconnected',exact:true}).waitFor();
 await page.screenshot({path:'/tmp/deck-session-release-draining-desktop.png',fullPage:true});cleanupFailures.set(first,2);unlockDrain();await page.locator('.composer-gate').getByRole('button',{name:'Retry close',exact:true}).waitFor();assert.equal(await page.locator('.composer-gate').getByRole('button',{name:'Prepare session',exact:true}).count(),0);await page.locator('.composer-gate').getByRole('button',{name:'Retry close',exact:true}).click();await page.locator('.composer-gate').getByRole('button',{name:'Prepare session',exact:true}).waitFor();
 releaseReadiness();await wait(()=>readySettled,'stale readiness request settled');await page.unroute(`**/api/sessions/${first}/readiness`);await Bun.sleep(60);assert.equal(await input.count(),0,'stale ready response cannot reopen composer');await row(first).getByRole('img',{name:'Disconnected',exact:true}).waitFor();assert.equal(await page.locator('.connection-dot.ready').count(),0);assert.equal(claude.turns[0]!.finished,true);assert.equal(claude.turns[1]!.finished,false);await queue.getByText('Pending preserved on close',{exact:true}).waitFor();assert.equal(await queue.getByRole('button',{name:'Resume queue',exact:true}).isDisabled(),true);
 await strip.getByText('draft.png',{exact:true}).waitFor();await chat.getByRole('button',{name:'View image 1: history.png',exact:true}).click();let viewer=page.getByRole('dialog',{name:/Image preview/});await wait(()=>viewer.locator('img').evaluate(image=>image instanceof HTMLImageElement&&image.naturalWidth===1400),'retained image after release');await viewer.press('Escape');
 checks.push('active-release-drains-before-prepare-preserves-same-chat-images-drafts-and-other-session');
 await prepare();assert.equal(await input.inputValue(),'Draft preserved on close');await row(first).getByRole('img',{name:'Connected',exact:true}).waitFor();assert.equal(claude.turns.length,2,'Prepare never dispatches paused inbox');await queue.getByRole('button',{name:'Resume queue',exact:true}).click();await wait(()=>claude.turns.length===3,'explicit queue resume');assert.equal(claude.turns[2]!.input.resume?.nativeSessionId,claude.turns[0]!.nativeSessionId);assert.equal(claude.turns[2]!.input.prompt,'Pending preserved on close');
 await send.click();claude.turns[2]!.finish();await wait(()=>claude.turns.length===4,'retained draft dispatch');assert.equal(claude.turns[3]!.input.resume?.nativeSessionId,claude.turns[0]!.nativeSessionId);assert.equal(claude.turns[3]!.input.prompt,'Draft preserved on close');assert.deepEqual(readFileSync(claude.turns[3]!.input.images![0]!.path),secondPNG);claude.turns[3]!.finish();
 await wait(async()=>!(await manager.query('prompts.list',{sessionId:first}) as any).data.active,'first session idle');
 await page.getByRole('button',{name:'Close session',exact:true}).click();await page.locator('.composer-gate').getByRole('button',{name:'Prepare session',exact:true}).waitFor();await prepare();
 assert.equal((await manager.query('sessions.list',{projectId:project.projectId}) as any).data.sessions.filter((session:any)=>session.title==='Retained conversation').length,1);
 checks.push('same-id-reprepare-resume-and-send-with-original-image-history');
 await select('Legacy closed conversation');await chat.getByText('Legacy retained answer',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Continue session',exact:true}).count(),0);await prepare();await input.fill('Reopen original legacy session');await send.click();await wait(()=>claude.turns.length===5,'legacy same identity reopened');assert.ok([...manager.openLog(legacy)!.readAfter(0)].some(event=>event.kind==='message.completed'&&event.data.role==='user'&&event.data.text==='Reopen original legacy session'));claude.turns[4]!.finish();assert.ok((await manager.query('sessions.list',{projectId:project.projectId}) as any).data.sessions.some((session:any)=>session.sessionId===successor));
 checks.push('legacy-ended-prepare-keeps-original-identity-and-existing-successor-separate');
 // Inactive-session menu actions never change the active conversation.
 const more=row(first).getByRole('button',{name:'More options for Retained conversation',exact:true});await more.focus();await more.press('ArrowDown');let menu=page.getByRole('menu',{name:'Options for session Retained conversation',exact:true});await menu.getByRole('menuitem',{name:'Rename session',exact:true}).waitFor();await page.screenshot({path:'/tmp/deck-session-menu-open-desktop-dark.png',fullPage:true});assert.equal(await page.locator('.app-header h1').innerText(),'Legacy closed conversation');await menu.press('Escape');await wait(()=>more.evaluate(element=>element===document.activeElement),'menu Escape returns focus');
 await more.click();await page.getByRole('menuitem',{name:'Rename session',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Rename session',exact:true});await dialog.getByLabel('Session name', {exact:true}).fill('');assert.equal(await dialog.getByRole('button',{name:'Save name',exact:true}).isDisabled(),true);await dialog.getByLabel('Session name',{exact:true}).fill('Renamed retained conversation');
 let reject=true;await page.route('**/api/commands',async route=>{if(reject&&route.request().postDataJSON().command.type==='session.rename'){reject=false;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,message:'Temporary rename failure'})});}else await route.continue();});await dialog.getByRole('button',{name:'Save name',exact:true}).click();await dialog.getByRole('alert').getByText('Temporary rename failure',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Save name',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.unroute('**/api/commands');await row(first).getByRole('button',{name:'Renamed retained conversation',exact:true}).waitFor();assert.equal(await page.locator('.app-header h1').innerText(),'Legacy closed conversation');
 await select('Renamed retained conversation');await chat.getByRole('button',{name:'View image 1: history.png',exact:true}).waitFor();await page.screenshot({path:'/tmp/deck-session-menu-desktop-dark.png',fullPage:true});
 checks.push('session-menu-keyboard-escape-inactive-rename-validation-error-and-history');
 cleanupFailures.set(second,2);await row(second).getByRole('button',{name:'More options for Other active conversation',exact:true}).click();await page.getByRole('menuitem',{name:'Remove session',exact:true}).click();await wait(()=>claude.turns[1]!.finished,'inactive remove drains only target');await row(second).getByRole('button',{name:'More options for Other active conversation',exact:true}).waitFor();await wait(()=>row(second).getByRole('button',{name:'More options for Other active conversation',exact:true}).isEnabled(),'failed removing row exposes retry');await row(second).getByRole('button',{name:'More options for Other active conversation',exact:true}).click();await page.getByRole('menuitem',{name:'Retry removal',exact:true}).click();await wait(async()=>await row(second).count()===0,'inactive removed row hidden after drain');assert.equal(await page.locator('.app-header h1').innerText(),'Renamed retained conversation');
 // Removing current chat clears only rendered selection, after settled removal.
 await row(first).getByRole('button',{name:'More options for Renamed retained conversation',exact:true}).click();await page.getByRole('menuitem',{name:'Remove session',exact:true}).click();await wait(async()=>await row(first).count()===0,'active removed row hidden');assert.equal(await chat.getByRole('button',{name:'View image 1: history.png',exact:true}).count(),0);assert.equal(await input.count(),0);assert.equal([...manager.openLog(first)!.readAfter(0)].some((event:any)=>event.kind==='message.completed'&&event.data.attachments?.length),true);
 await command({type:'session.remove'},successor);await wait(async()=>await row(successor).count()===0,'external inactive removal disappears without local intent');
 checks.push('session-remove-retries-owned-cleanup-isolates-other-work-and-external-catalog-omission');
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Switch to light theme',exact:true}).tap();await page.getByRole('button',{name:'Open sessions',exact:true}).tap();const drawer=page.getByRole('dialog',{name:'Workspace',exact:true});await drawer.getByRole('button',{name:'More options for Legacy closed conversation',exact:true}).tap();await page.screenshot({path:'/tmp/deck-session-menu-open-mobile390-light.png',fullPage:true});await page.getByRole('menuitem',{name:'Rename session',exact:true}).tap();dialog=page.getByRole('dialog',{name:'Rename session',exact:true});await dialog.getByLabel('Session name',{exact:true}).fill('Mobile retained conversation');await dialog.getByRole('button',{name:'Save name',exact:true}).tap();await dialog.waitFor({state:'hidden'});await page.getByRole('button',{name:'Open sessions',exact:true}).tap();await page.screenshot({path:'/tmp/deck-session-menu-mobile390-light.png',fullPage:true});await bounds(page);await drawer.press('Escape');await page.setViewportSize({width:320,height:740});await page.getByRole('button',{name:'Switch to dark theme',exact:true}).tap();await page.getByRole('button',{name:'Open sessions',exact:true}).tap();await page.screenshot({path:'/tmp/deck-session-menu-mobile320-dark.png',fullPage:true});await bounds(page);await drawer.getByRole('button',{name:'Mobile retained conversation',exact:true}).tap();await chat.getByText('Legacy retained answer',{exact:true}).waitFor();
 checks.push('mobile390-320-touch-session-menu-theme-density-and-bounds');
 console.log(JSON.stringify({passed:checks,screenshots:['/tmp/deck-session-release-draining-desktop.png','/tmp/deck-session-menu-desktop-dark.png','/tmp/deck-session-menu-mobile390-light.png','/tmp/deck-session-menu-mobile320-dark.png']}));
}catch(cause){console.error('RELEASE_FAILURE',await page.locator('body').innerText());await page.screenshot({path:'/tmp/deck-session-release-failure.png',fullPage:true});throw cause;}
finally{unlockDrain();await browser.close();await host.close();await manager.close();rmSync(root,{recursive:true,force:true});}
