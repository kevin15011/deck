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
try{
 await page.addInitScript(()=>{const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);(window as any).imageObjectURLs=new Set<string>();URL.createObjectURL=blob=>{const url=create(blob);(window as any).imageObjectURLs.add(url);return url;};URL.revokeObjectURL=url=>{(window as any).imageObjectURLs.delete(url);revoke(url);};});
 const project=(await command({type:'project.register',path:projectOne,name:'Image workspace'})).project;
 const first=(await command({type:'session.create',projectId:project.projectId,title:'Image conversation'})).sessionId;
 await command({type:'session.create',projectId:project.projectId,title:'Other conversation'});
 await page.goto(host.status().url!);await page.bringToFront();
 const nav=page.getByRole('navigation',{name:'Sessions',exact:true}),chat=page.getByRole('region',{name:'Conversation',exact:true}),strip=page.getByRole('region',{name:'Attached images',exact:true}),queue=page.getByRole('region',{name:'Queued messages',exact:true});
 const select=async(name:string)=>{await nav.getByRole('button',{name,exact:true}).click();await wait(async()=>await page.locator('.app-header h1').innerText()===name,'selected conversation');};
 await select('Image conversation');await page.locator('.composer-gate').getByRole('button',{name:'Prepare session',exact:true}).click();
 const input=page.getByLabel('Message the lead'),send=page.getByRole('button',{name:'Send prompt',exact:true});
 const paste=async(files:{name:string;bytes:Buffer}[],text='')=>{
  await input.focus();await input.evaluate((element,payload)=>{const data=new DataTransfer();for(const file of payload.files)data.items.add(new File([Uint8Array.from(file.bytes)],file.name,{type:'image/png'}));if(payload.text)data.setData('text/plain',payload.text);element.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));},{files:files.map(file=>({name:file.name,bytes:[...file.bytes]})),text});
 };
 const ready=async(count:number)=>wait(async()=>await strip.locator('[data-image-draft]').count()===count&&await strip.getByText('Ready',{exact:true}).count()===count,'all images uploaded');
 await input.fill('Before after');await input.evaluate(element=>{if(element instanceof HTMLTextAreaElement)element.setSelectionRange(7,7);});
 await paste([{name:'C:\\Users\\Windows\\private\\capture.png',bytes:firstPNG}],'paired ');await ready(1);
 assert.equal(await input.inputValue(),'Before paired after');assert.equal(await strip.getByText('capture.png',{exact:true}).count(),1);assert.equal(await strip.locator('img').evaluate(image=>image instanceof HTMLImageElement?image.naturalWidth:0),1400);
 const thumb=strip.getByRole('button',{name:/^Preview attached image 1/});await thumb.click();
 let viewer=page.getByRole('dialog',{name:/Image preview/});await viewer.locator('img').waitFor();await wait(()=>viewer.locator('img').evaluate(image=>image instanceof HTMLImageElement&&image.naturalWidth===1400),'local preview decoded');
 await viewer.getByRole('button',{name:'Zoom in',exact:true}).click();await viewer.getByRole('button',{name:'Zoom in',exact:true}).click();
 assert.equal(await viewer.locator('.image-preview-viewport').evaluate(element=>element.scrollWidth>element.clientWidth),true);
 await page.screenshot({path:'/tmp/deck-images-preview-desktop-dark.png',fullPage:true});await viewer.getByRole('button',{name:'Fit image',exact:true}).click();await viewer.press('Escape');await wait(()=>thumb.evaluate(element=>element===document.activeElement),'local preview focus returned');
 checks.push('clipboard-file-bytes-mixed-text-basename-thumbnail-zoom-fit-escape');

 await input.fill('');assert.equal(await send.isEnabled(),true);await send.click();await wait(()=>claude.turns.length===1,'image-only native admission');
 await wait(async()=>await strip.count()===0,'accepted thumbnail consumed');assert.equal(claude.turns[0]!.input.prompt,'');assert.equal(claude.turns[0]!.input.images?.length,1);assert.deepEqual(readFileSync(claude.turns[0]!.input.images![0]!.path),firstPNG);
 const sentReference=chat.getByRole('button',{name:'View image 1: capture.png',exact:true});await sentReference.waitFor();assert.equal((await chat.innerText()).includes(root),false);assert.equal((await chat.innerText()).includes('C:\\Users'),false);
 await sentReference.click();viewer=page.getByRole('dialog',{name:/Image preview/});await wait(()=>viewer.locator('img').evaluate(image=>image instanceof HTMLImageElement&&image.naturalWidth===1400),'authenticated stored preview decoded');await viewer.press('Escape');await wait(()=>sentReference.evaluate(element=>element===document.activeElement),'sent preview focus returned');
 const picker=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Attach images',exact:true}).click();await(await picker).setFiles([{name:'second.png',mimeType:'image/png',buffer:secondPNG},{name:'third.png',mimeType:'image/png',buffer:firstPNG}]);await ready(2);
 await send.click();await queue.getByText('Image message',{exact:true}).waitFor();assert.equal(await queue.getByRole('button',{name:/^View image /}).count(),2);assert.equal(claude.turns.length,1);assert.equal(await chat.getByRole('button',{name:/^View image /}).count(),1);
 await queue.getByRole('button',{name:'Remove queued message 1',exact:true}).click();await wait(async()=>await queue.count()===0,'queued image message cancelled');
 checks.push('image-only-native-bytes-stored-preview-multiple-picker-queued-images');

 // Resolve an upload after switching sessions and removing its original draft.
 let release!:()=>void,captured=false,settled=false;const delay=new Promise<void>(resolve=>{release=resolve;});let hold=true;
 await page.route('**/api/sessions/*/attachments?**',async route=>{if(!hold){await route.continue();return;}hold=false;const response=await route.fetch();captured=true;await delay;await route.fulfill({response}).catch(()=>{});settled=true;});
 await paste([{name:'remove-during-upload.png',bytes:secondPNG}]);await wait(()=>captured,'held upload stored');await select('Other conversation');assert.equal(await strip.count(),0);
 await select('Image conversation');await strip.getByRole('button',{name:'Remove attached image 1',exact:true}).click();release();await wait(()=>settled,'aborted upload route settled');await page.unroute('**/api/sessions/*/attachments?**');await Bun.sleep(30);assert.equal(await strip.count(),0,'late upload cannot reinsert removed draft');
 // An inactive session keeps ownership when its upload completes.
 let releaseInactive!:()=>void;const inactiveDelay=new Promise<void>(resolve=>{releaseInactive=resolve;});captured=false;settled=false;hold=true;
 await page.route('**/api/sessions/*/attachments?**',async route=>{if(!hold){await route.continue();return;}hold=false;const response=await route.fetch();captured=true;await inactiveDelay;await route.fulfill({response}).catch(()=>{});settled=true;});
 await paste([{name:'owned-by-first.png',bytes:secondPNG}]);await wait(()=>captured,'inactive upload captured');await select('Other conversation');releaseInactive();await wait(()=>settled,'inactive upload settled');await page.unroute('**/api/sessions/*/attachments?**');assert.equal(await strip.count(),0);await select('Image conversation');await ready(1);
 checks.push('upload-owner-session-and-remove-abort-stale-response-fences');

 // A durable send ACK consumes only its snapshot, preserving later pasted images and text.
 let releaseSend!:()=>void;const sendDelay=new Promise<void>(resolve=>{releaseSend=resolve;});captured=false;settled=false;hold=true;
 await page.route('**/api/commands',async route=>{if(!hold||route.request().postDataJSON().command.type!=='prompt.send'){await route.continue();return;}hold=false;const response=await route.fetch();captured=true;await sendDelay;await route.fulfill({response});settled=true;});
 await input.fill('Submitted with first image');await send.click();await wait(()=>captured,'send durable ACK held');await input.fill('Fresh draft after send');await paste([{name:'new-draft.png',bytes:firstPNG}]);
 await wait(async()=>await strip.getByText('Ready',{exact:true}).count()===1&&await strip.locator('[data-image-draft]').count()===2,'new image uploaded while old image sending');releaseSend();await wait(()=>settled,'send ACK released');await page.unroute('**/api/commands');await ready(1);assert.equal(await input.inputValue(),'Fresh draft after send');await strip.getByText('new-draft.png',{exact:true}).waitFor();
 await queue.getByText('Submitted with first image',{exact:true}).waitFor();await queue.getByRole('button',{name:'Remove queued message 1',exact:true}).click();await wait(async()=>await queue.count()===0,'submitted image queue removed without new draft loss');assert.equal(await strip.locator('[data-image-draft]').count(),1);
 checks.push('acceptance-consumes-submitted-image-ids-only-preserves-new-text');

 let rejectUpload=true;await page.route('**/api/sessions/*/attachments?**',async route=>{if(rejectUpload){rejectUpload=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,message:'Temporary image upload failure.'})});}else await route.continue();});
 await paste([{name:'retry.png',bytes:secondPNG}]);await strip.getByRole('alert').getByText('Temporary image upload failure.',{exact:true}).waitFor();assert.equal(await strip.locator('[data-image-draft]').count(),2);assert.equal(await send.isDisabled(),true);await strip.getByRole('button',{name:'Retry upload',exact:true}).click();await ready(2);await page.unroute('**/api/sessions/*/attachments?**');
 let rejectSend=true;await page.route('**/api/commands',async route=>{if(rejectSend&&route.request().postDataJSON().command.type==='prompt.send'){rejectSend=false;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({ok:false,message:'Queue is full.'})});}else await route.continue();});
 await input.fill('Keep this failed draft');await send.click();await page.getByRole('alert').getByText('Queue is full.',{exact:true}).waitFor();assert.equal(await input.inputValue(),'Keep this failed draft');await ready(2);await page.unroute('**/api/commands');
 checks.push('upload-retry-and-send-rejection-retain-images-text');

 await page.screenshot({path:'/tmp/deck-images-drafts-desktop-dark.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Switch to light theme',exact:true}).tap();await strip.getByRole('button',{name:/^Preview attached image 1/}).tap();viewer=page.getByRole('dialog',{name:/Image preview/});await wait(()=>viewer.locator('img').evaluate(image=>image instanceof HTMLImageElement&&image.naturalWidth===1400),'mobile preview decoded');await viewer.getByRole('button',{name:'Zoom in',exact:true}).tap();await bounds(page);await page.screenshot({path:'/tmp/deck-images-preview-mobile-390-light.png',fullPage:true});await viewer.getByRole('button',{name:'Close image preview',exact:true}).tap();
 await page.setViewportSize({width:320,height:740});await page.getByRole('button',{name:'Switch to dark theme',exact:true}).tap();await bounds(page);await page.screenshot({path:'/tmp/deck-images-drafts-mobile-320-dark.png',fullPage:true});
 await strip.getByRole('button',{name:'Remove attached image 1',exact:true}).tap();await strip.getByRole('button',{name:'Remove attached image 1',exact:true}).tap();await wait(async()=>await strip.count()===0,'all image drafts removed');await wait(async()=>await page.evaluate(()=>(window as any).imageObjectURLs.size===0),'all owned object URLs revoked');
 assert.equal(await input.inputValue(),'Keep this failed draft');await command({type:'session.stop'},first);
 checks.push('mobile390-320-preview-touch-bounds-and-blob-url-cleanup');
 console.log(JSON.stringify({passed:checks,screenshots:['/tmp/deck-images-preview-desktop-dark.png','/tmp/deck-images-drafts-desktop-dark.png','/tmp/deck-images-preview-mobile-390-light.png','/tmp/deck-images-drafts-mobile-320-dark.png'],clipboard:'Browser ClipboardEvent File payload; no OS clipboard commands or user clipboard mutation'}));
}catch(cause){console.error('IMAGE_FAILURE',await page.locator('body').innerText());await page.screenshot({path:'/tmp/deck-images-failure.png',fullPage:true});throw cause;}
finally{await browser.close();await host.close();await manager.close();rmSync(root,{recursive:true,force:true});}
