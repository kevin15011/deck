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
const context=await browser.newContext({viewport:{width:1440,height:1000},hasTouch:true}),page=await context.newPage();page.setDefaultTimeout(7000);const checks:string[]=[];
try{
 const project=(await command({type:'project.register',path:projectOne,name:'Queue workspace'})).project;
 const first=(await command({type:'session.create',projectId:project.projectId,title:'Queued conversation'})).sessionId;
 await command({type:'session.create',projectId:project.projectId,title:'Other conversation'});
 await page.goto(host.status().url!);await page.bringToFront();
 const nav=page.getByRole('navigation',{name:'Sessions',exact:true}),chat=page.getByRole('region',{name:'Conversation',exact:true}),queue=page.getByRole('region',{name:'Queued messages',exact:true});
 const select=async(name:string)=>{await nav.getByRole('button',{name,exact:true}).click();await wait(async()=>await page.locator('.app-header h1').innerText()===name,'selected conversation');};
 const send=async(text:string)=>{const input=page.getByLabel('Message the lead');await input.fill(text);await input.press('Enter');await wait(async()=>await input.inputValue()==='','draft cleared on durable acceptance');};
 const items=()=>queue.locator('li[data-prompt-id]');
 await select('Queued conversation');await page.locator('.composer-gate').getByRole('button',{name:'Prepare session',exact:true}).click();
 await send('Current work');await wait(()=>claude.turns.length===1,'first native admission');
 await page.locator('.chat-pane .lead-progress').getByText('Using Read…',{exact:true}).waitFor();
 await send('Second queued message');await queue.getByText('Second queued message',{exact:true}).waitFor();
 await send('Third queued message');await send('Fourth queued message');
 assert.equal(claude.turns.length,1);assert.equal(claude.turns[0]!.interrupts.length,0);
 assert.equal(await chat.getByText('Second queued message',{exact:true}).count(),0,'queued text is not a delivered chat message');
 await page.locator('.chat-pane .lead-progress').getByText('Using Read…',{exact:true}).waitFor();assert.equal(await chat.getByText('claude response from lead',{exact:true}).count(),1);
 assert.deepEqual(await items().locator('.queue-preview').allTextContents(),['Second queued message','Third queued message','Fourth queued message']);
 await queue.getByRole('button',{name:'Remove queued message 2',exact:true}).click();await wait(async()=>await items().count()===2,'middle queued message removed');
 assert.deepEqual(await items().locator('.queue-preview').allTextContents(),['Second queued message','Fourth queued message']);
 checks.push('enqueue-while-working-preserves-response-progress-fifo-cancel');

 claude.turns[0]!.finish();await wait(()=>claude.turns.length===2,'second native admission');
 assert.equal(claude.turns[1]!.input.prompt,'Second queued message');await chat.getByText('Second queued message',{exact:true}).waitFor();await wait(async()=>await items().count()===1,'dispatched item leaves pending');
 // A cancellation that reaches the host after dispatch must never interrupt that turn.
 let releaseCancel!:()=>void;const heldCancel=new Promise<void>(resolve=>{releaseCancel=resolve;});let captured=false;
 await page.route('**/api/commands',async route=>{if(route.request().postDataJSON().command.type==='prompt.cancel'){captured=true;await heldCancel;await route.continue();}else await route.continue();});
 await queue.getByRole('button',{name:'Remove queued message 1',exact:true}).click();await wait(()=>captured,'cancel request held before host');
 claude.turns[1]!.finish();await wait(()=>claude.turns.length===3,'fourth native admission wins race');assert.equal(claude.turns[2]!.input.prompt,'Fourth queued message');releaseCancel();
 await queue.getByRole('alert').waitFor();assert.match(await queue.getByRole('alert').innerText(),/started|dispatch/i);assert.equal(claude.turns[2]!.interrupts.length,0);await page.unroute('**/api/commands');
 checks.push('native-serial-admission-and-cancel-after-start-is-not-interrupt');

 await send('Fifth survives navigation');await queue.getByText('Fifth survives navigation',{exact:true}).waitFor();
 await page.getByLabel('Message the lead').fill('Draft for first conversation');await select('Other conversation');
 assert.equal(await queue.count(),0,'inbox does not leak to another session');await page.locator('.composer-gate').getByRole('button',{name:'Prepare session',exact:true}).click();await page.getByLabel('Message the lead').fill('Draft for other conversation');
 await select('Queued conversation');await queue.getByText('Fifth survives navigation',{exact:true}).waitFor();assert.equal(await page.getByLabel('Message the lead').inputValue(),'Draft for first conversation');
 await page.reload();await select('Queued conversation');await queue.getByText('Fifth survives navigation',{exact:true}).waitFor();assert.equal(claude.turns.length,3,'reload never duplicates native admission');
 checks.push('session-inbox-isolation-drafts-and-durable-reload');

 await page.getByRole('button',{name:'Interrupt',exact:true}).click();await queue.getByText('Queue paused',{exact:true}).waitFor();await wait(()=>claude.turns[2]!.finished,'active native interrupted');
 const countBeforePausedSend=claude.turns.length;await send('Sixth stays paused');await wait(async()=>await items().count()===2,'append while paused');
 await Bun.sleep(80);assert.equal(claude.turns.length,countBeforePausedSend);assert.equal(await queue.getByRole('button',{name:'Resume queue',exact:true}).count(),1);
 await page.screenshot({path:'/tmp/deck-prompt-queue-desktop-dark.png',fullPage:true});await bounds(page);
 await queue.getByRole('button',{name:'Resume queue',exact:true}).click();await wait(()=>claude.turns.length===4,'resume starts first waiting');assert.equal(claude.turns[3]!.input.prompt,'Fifth survives navigation');
 claude.turns[3]!.finish();await wait(()=>claude.turns.length===5,'remaining FIFO after resume');assert.equal(claude.turns[4]!.input.prompt,'Sixth stays paused');
 checks.push('interrupt-pauses-pending-send-does-not-resume-explicit-resume-fifo');

 await send('Seventh accepted but cannot start');claude.turns[4]!.finish({status:'failed',error:'Native test failure'});await queue.getByText('Queue paused',{exact:true}).waitFor();
 assert.equal(claude.turns.length,5,'failure does not drain waiting messages');
 const previousProbe=claude.probeResult;claude.probeResult={status:'blocked',reasonCode:'fixture-runner-blocked',capabilities:[]};await queue.getByRole('button',{name:'Resume queue',exact:true}).click();
 await queue.getByText('Could not start',{exact:true}).waitFor();await queue.getByText('Seventh accepted but cannot start',{exact:true}).waitFor();
 assert.equal(await chat.getByText('Seventh accepted but cannot start',{exact:true}).count(),0,'failed pre-admission message was never delivered');
 assert.equal(claude.turns.length,5);claude.probeResult=previousProbe;
 await page.reload();await select('Queued conversation');await queue.getByText('Seventh accepted but cannot start',{exact:true}).waitFor();await queue.getByText('Could not start',{exact:true}).waitFor();
 checks.push('failure-pauses-and-never-dispatched-accepted-text-survives-reload');

 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Switch to light theme',exact:true}).click();await queue.getByRole('button',{name:'Resume queue',exact:true}).tap();await wait(async()=>await queue.getByRole('button',{name:'Resume queue',exact:true}).count()===0,'empty resume does not retry failed message');assert.equal(claude.turns.length,5);
 await send('Mobile active message');await wait(()=>claude.turns.length===6,'mobile native admission');await send('Mobile queued message');await queue.getByText('Mobile queued message',{exact:true}).waitFor();await bounds(page);await page.screenshot({path:'/tmp/deck-prompt-queue-mobile-390-light.png',fullPage:true});
 await page.setViewportSize({width:320,height:740});await page.getByRole('button',{name:'Switch to dark theme',exact:true}).tap();await bounds(page);await page.screenshot({path:'/tmp/deck-prompt-queue-mobile-320-dark.png',fullPage:true});
 await queue.getByRole('button',{name:'Remove queued message 1',exact:true}).tap();await wait(async()=>await items().count()===0,'touch cancellation');
 await send('Cancelled when session closes');await page.getByRole('button',{name:'Close session',exact:true}).tap();await page.locator('.composer-gate').getByRole('button',{name:'Prepare session',exact:true}).waitFor();assert.equal(await items().count(),1);assert.equal(await queue.getByRole('button',{name:'Resume queue',exact:true}).isDisabled(),true);
 checks.push('mobile390-320-touch-cancel-and-close-pauses-waiting');
 console.log(JSON.stringify({passed:checks,screenshots:['/tmp/deck-prompt-queue-desktop-dark.png','/tmp/deck-prompt-queue-mobile-390-light.png','/tmp/deck-prompt-queue-mobile-320-dark.png']}));
}catch(cause){console.error('PROMPT_QUEUE_FAILURE',await page.locator('body').innerText());await page.screenshot({path:'/tmp/deck-prompt-queue-failure.png',fullPage:true});throw cause;}
finally{await browser.close();await host.close();await manager.close();rmSync(root,{recursive:true,force:true});}
