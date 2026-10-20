/** Isolated real HTTP/WebSocket/browser exercise. Native inference is faked; no installed daemon. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SessionCommandBody } from '../../packages/core/src/session/commands';
import type { CrossRunnerConfig } from '../../packages/core/src/config/deck-config';
import { SessionManager } from '../../packages/session-host/src/session-manager';
import { ApprovalBroker } from '../../packages/session-host/src/approval-broker';
import { CredentialRegistry } from '../../packages/session-host/src/credentials';
import { Supervisor } from '../../packages/session-host/src/supervisor';
import { FakeDriver } from '../../packages/session-host/src/testing/fake-driver';
import { WebService } from '../../packages/session-host/src/web-service';
import { ensureStateLayout, resolveStatePaths, sessionPaths } from '../../packages/session-host/src/paths';
import { WEB_ASSETS } from '../cli/src/runtime/web-assets.generated';
const root=realpathSync(mkdtempSync(join(tmpdir(),'deck-steering-browser-'))),home=join(root,'home'),project=join(home,'project');mkdirSync(project,{recursive:true});
const paths=resolveStatePaths({env:{XDG_STATE_HOME:join(root,'state')}});ensureStateLayout(paths);
const driver=new FakeDriver('codex'),otherDriver=new FakeDriver('claude');
driver.probeResult={status:'ready',version:'0.162.1',capabilities:['turn-steer-text-0.162.1'],mcpIsolationVerified:true};
const writes:any[]=[],resolves:Array<(v:any)=>void>=[];const baseStart=driver.startTask.bind(driver);
driver.startTask=async(input,io)=>{const h=await baseStart(input,io),nativeThreadId=await h.nativeSessionId;return {...h,steeringTarget:()=>({nativeThreadId,nativeTurnId:`turn-${driver.turns.length}`}),steer:async(message:any)=>{writes.push(message);return new Promise<any>(r=>resolves.push(r));},reconcileSteering:async()=>({state:'unknown',reason:'not-in-history'} as const)};};
for(const d of [driver,otherDriver])d.onStart=turn=>{turn.init();turn.say('Isolated fixture response');};
const accept=(i:number)=>resolves[i]!({state:'accepted',...writes[i],via:'receipt'});
const credentials=new CredentialRegistry({socketPath:paths.socket.path});let manager!:SessionManager;
const config:CrossRunnerConfig={enabled:true,members:{lead:{runnerId:'codex',modelId:'gpt-6.1-sol'},investigate:{runnerId:'claude',modelId:'fixture'}},approvals:{claude:'relay',codex:'runner-default',opencode:'relay'},maxConcurrentTasks:4,claudeTosAcknowledgedAt:null,web:{port:0,trustedProxy:null,allowedOrigins:[],allowFunnel:false}};
manager=new SessionManager({paths,credentials,broker:new ApprovalBroker({sink:{emit:(id,draft)=>{manager.openLog(id)?.append(draft);}}}),supervisor:new Supervisor({anchorCommand:['unused']}),drivers:{get:id=>id==='codex'?driver:id==='claude'?otherDriver:undefined,list:()=>[driver,otherDriver]},config:()=>config,sessionMcpCommand:['/not-launched/deck'],homeDir:home});
const host=new WebService({paths,assets:WEB_ASSETS,config:config.web,service:manager});host.enable();
const browser=await chromium.launch({executablePath:process.env.DECK_TEST_CHROME??join(homedir(),'Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(6000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const checks:string[]=[];
const wait=async(condition:()=>boolean|Promise<boolean>,label:string)=>{for(let i=0;i<160;i++){if(await condition())return;await Bun.sleep(25);}throw Error(`Timed out: ${label}`);};
const command=async(body:SessionCommandBody,sessionId?:string)=>{const result=await manager.execute({sessionId,clientId:'browser-fixture',command:{v:1,commandId:randomUUID(),...body} as never});assert.equal(result.ok,true,JSON.stringify(result));return (result as any).data;};
try{
 const registered=await command({type:'project.register',path:project,name:'Steering workspace'});
 const id=(await command({type:'session.create',projectId:registered.project.projectId,title:'Codex conversation'})).sessionId;
 await command({type:'session.create',projectId:registered.project.projectId,title:'Other conversation',members:{lead:{runnerId:'claude',modelId:'fixture'}}});
 const select=async(name:string)=>{await page.getByRole('navigation',{name:'Sessions',exact:true}).getByRole('button',{name,exact:true}).click();await wait(async()=>await page.locator('.app-header h1').innerText()===name,'session selection');};
 const input=page.getByLabel('Message the lead'),action=page.getByRole('button',{name:'Send to current turn',exact:true}),delivery=page.getByRole('region',{name:'Current-turn delivery',exact:true});
 await page.goto(host.status().url!);await select('Codex conversation');await page.locator('.composer-gate').getByRole('button',{name:'Prepare session',exact:true}).click();
 await input.fill('Original prompt');await input.press('Enter');await wait(()=>driver.turns.length===1,'original native turn');await action.waitFor();
 if(process.env.DECK_TEST_STEERING_LATE_REFUSAL_ONLY==='1'){
  await input.fill('An earlier refused message');await action.click();await wait(()=>writes.length===1,'late refusal steering fence');
  await input.fill('Newer admitted message');await input.press('Enter');driver.turns[0]!.finish();await wait(()=>driver.turns.length===2,'barrier expires before newer message admission');
  await input.fill('Draft after refusal');resolves[0]!({state:'not-accepted',reason:'no-active-turn'});await delivery.getByText('Not accepted by Codex · This message was not queued or sent again.',{exact:true}).waitFor();assert.equal(await input.inputValue(),'Draft after refusal');
  assert.equal(await page.getByRole('button',{name:'Remove queued message 1',exact:true}).count(),0);assert.equal(await delivery.getByRole('button').count(),0);
  await select('Other conversation');await select('Codex conversation');assert.equal(await input.inputValue(),'Draft after refusal');
  await input.fill('');await page.reload();await select('Codex conversation');await delivery.getByText('Not accepted by Codex · This message was not queued or sent again.',{exact:true}).waitFor();
  driver.turns[1]!.finish();await wait(()=>driver.turns[1]!.closed,'newer turn completes');assert.equal(driver.turns.length,2);assert.equal(writes.length,1);
  assert.equal(await page.getByRole('button',{name:'Remove queued message 1',exact:true}).count(),0);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks:['late-refusal-terminal-live-and-reload-no-queue-no-third-turn-draft-preserved']}));
 }else{
 await input.fill('Ordinary queued follow-up');await input.press('Enter');await page.getByRole('button',{name:'Remove queued message 1',exact:true}).waitFor();assert.equal(writes.length,0);assert.equal(await action.count(),0);
 await page.getByRole('button',{name:'Remove queued message 1',exact:true}).click();await action.waitFor();checks.push('ordinary-enter-remains-FIFO-queue');
 await input.fill('Explicit current-turn input');await action.focus();await page.keyboard.press('Enter');await wait(()=>writes.length===1,'native steering request');await delivery.getByText('Sending to Codex…',{exact:true}).waitFor();
 await wait(async()=>await input.evaluate(el=>el===document.activeElement),'focus recovery after control removed');assert.equal(await page.getByRole('button',{name:'Remove queued message 1',exact:true}).count(),0);
 accept(0);await delivery.getByText('Accepted by Codex',{exact:true}).waitFor();assert.equal(driver.turns.length,1);checks.push('keyboard-explicit-action-sending-acceptance-no-new-turn');
 await action.waitFor();await input.fill('Possibly received message');await action.click();await wait(()=>writes.length===2,'uncertain steering request');resolves[1]!({state:'unknown',reason:'lost-response'});
 await delivery.getByText(/Uncertain · Codex may already have received/).waitFor();assert.equal(await delivery.getByRole('button').count(),0);assert.equal(writes.length,2);checks.push('uncertainty-visible-no-unsafe-resend');
 await action.waitFor();await input.fill('Accepted while another session is selected');await action.click();await wait(()=>writes.length===3,'pending delivery before switch');await input.fill('Codex draft kept');await select('Other conversation');
 await page.locator('.composer-gate').getByRole('button',{name:'Prepare session',exact:true}).click();await input.fill('Other draft kept');accept(2);assert.equal(await delivery.count(),0);assert.equal(await action.count(),0);
 await select('Codex conversation');assert.equal(await input.inputValue(),'Codex draft kept');await delivery.getByText('Accepted by Codex',{exact:true}).first().waitFor();await select('Other conversation');assert.equal(await input.inputValue(),'Other draft kept');await select('Codex conversation');checks.push('session-switch-drafts-and-delivery-isolation-unsupported-runner');
 await input.fill('');const before=writes.length;await page.reload();await select('Codex conversation');await delivery.getByText(/Uncertain · Codex may already have received/).waitFor();assert.equal(writes.length,before);checks.push('reload-restores-durable-status-without-resend');
 // Receipt delayed beyond completion must keep the original send position.
 await action.waitFor();await input.fill('Earlier input with a late receipt');await action.click();await wait(()=>writes.length===4,'late receipt fence');await input.fill('A later genuine turn');await input.press('Enter');driver.turns[0]!.finish();await wait(()=>driver.turns.length===2,'bounded completion barrier');accept(3);
 await page.getByRole('region',{name:'Conversation',exact:true}).getByText('Accepted by Codex for its original turn.',{exact:true}).waitFor();
 const chronology=await page.locator('.conversation .message').allTextContents();const earlier=chronology.findIndex(text=>text.includes('Earlier input with a late receipt')),later=chronology.findIndex(text=>text.includes('A later genuine turn'));assert(earlier>=0&&later>earlier,'late receipt preserves pre-write chronology');assert.equal(chronology.filter(text=>text.includes('Earlier input with a late receipt')).length,1);checks.push('late-receipt-original-chronology-no-duplicate-user-row');
 const bounds=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1),false,'no outer overflow');
 await action.waitFor();await input.fill('Keyboard ready');await bounds();await page.screenshot({path:'/tmp/deck-steering-desktop-dark.png',fullPage:true});await page.getByRole('button',{name:'Switch to light theme',exact:true}).click();await bounds();await page.screenshot({path:'/tmp/deck-steering-desktop-light.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await bounds();await page.screenshot({path:'/tmp/deck-steering-mobile-light.png',fullPage:true});await page.getByRole('button',{name:'Switch to dark theme',exact:true}).click();await bounds();await page.screenshot({path:'/tmp/deck-steering-mobile-dark.png',fullPage:true});await page.setViewportSize({width:320,height:740});await bounds();assert.equal(await page.locator('.composer').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight+1),true);checks.push('desktop-390-320-light-dark-visual-smoke');
 await page.setViewportSize({width:1440,height:1000});await input.fill('Late delivery at close');await action.click();await wait(()=>writes.length===5,'in-flight close');await input.fill('Draft survives close');await command({type:'session.release'},id);accept(4);await page.getByText('Your draft is kept for this session.',{exact:true}).waitFor();await wait(async()=>await page.locator('.composer-gate button').isEnabled(),'released resources');
 assert.equal(writes.length,5);await page.locator('.composer-gate').getByRole('button',{name:'Prepare session',exact:true}).click();assert.equal(await input.inputValue(),'Draft survives close');checks.push('release-late-receipt-reprepare-draft-preserved-no-resend');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks,screenshots:'/tmp/deck-steering-{desktop,mobile}-{dark,light}.png'}));
 }
}finally{await browser.close();await host.close();await manager.close();rmSync(root,{recursive:true,force:true});}
