/** Opt-in real HTTP/WebSocket/Chromium acceptance, with scripted native effects only. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '@playwright/test';
import type {CrossRunnerConfig} from '../../packages/core/src/config/deck-config';
import type {SessionCommandBody} from '../../packages/core/src/session/commands';
import {SessionManager} from '../../packages/session-host/src/session-manager';
import {ApprovalBroker} from '../../packages/session-host/src/approval-broker';
import {CredentialRegistry} from '../../packages/session-host/src/credentials';
import {Supervisor} from '../../packages/session-host/src/supervisor';
import {FakeDriver} from '../../packages/session-host/src/testing/fake-driver';
import {WebService} from '../../packages/session-host/src/web-service';
import {ensureStateLayout,resolveStatePaths} from '../../packages/session-host/src/paths';
import {WEB_ASSETS} from '../cli/src/runtime/web-assets.generated';
const evidence='/tmp/deck-unread-replies-browser';mkdirSync(evidence,{recursive:true});
const root=realpathSync(mkdtempSync('/tmp/dur-')),home=join(root,'home'),project=join(home,'project');mkdirSync(project,{recursive:true});
const paths=resolveStatePaths({env:{XDG_STATE_HOME:join(root,'state')}});ensureStateLayout(paths);
const driver=new FakeDriver();driver.onStart=t=>t.init();
const credentials=new CredentialRegistry({socketPath:paths.socket.path});let manager!:SessionManager;
const config:CrossRunnerConfig={enabled:true,members:{lead:{runnerId:'claude',modelId:'fixture'}},executionBudget:{lead:2,delegated:4},approvals:{claude:'relay',codex:'runner-default',opencode:'relay'},maxConcurrentTasks:4,claudeTosAcknowledgedAt:null,web:{port:0,trustedProxy:null,allowedOrigins:[],allowFunnel:false}};
manager=new SessionManager({paths,credentials,broker:new ApprovalBroker({sink:{emit:(id,draft)=>manager.openLog(id)?.append(draft)}}),supervisor:new Supervisor({anchorCommand:['unused']}),drivers:{get:id=>id==='claude'?driver:undefined,list:()=>[driver]},config:()=>config,sessionMcpCommand:['/not-launched/deck'],homeDir:home});
const host=new WebService({paths,assets:WEB_ASSETS,config:config.web,service:manager});host.enable();
const browser=await chromium.launch({executablePath:process.env.DECK_TEST_CHROME??join(homedir(),'Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(8000);
const errors:string[]=[],checks:string[]=[],releases:(()=>void)[]=[];page.on('pageerror',e=>{errors.push(e.message);console.error('browser-page-error',e.message);});
const wait=async(fn:()=>boolean|Promise<boolean>,label:string)=>{for(let n=0;n<240;n++){if(await fn())return;await Bun.sleep(25);}throw Error('Timed out: '+label);};
const command=async(body:SessionCommandBody,sessionId?:string)=>{const r=await manager.execute({sessionId,clientId:'unread-browser',command:{v:1,commandId:randomUUID(),...body} as never});assert.equal(r.ok,true,JSON.stringify(r));return(r as any).data;};
try{
 console.error('browser-step','register');
 const registered=await command({type:'project.register',path:project,name:'Unread replies'});
 const a=(await command({type:'session.create',projectId:registered.project.projectId,title:'Research conversation'})).sessionId;
 const b=(await command({type:'session.create',projectId:registered.project.projectId,title:'Other conversation'})).sessionId;
 const select=async(name:string)=>{if(await page.getByRole('button',{name:'Open sessions',exact:true}).isVisible())await page.getByRole('button',{name:'Open sessions',exact:true}).click();else if(await page.getByRole('button',{name:'Expand sidebar',exact:true}).isVisible())await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();const nav=page.getByRole('navigation',{name:await page.getByRole('navigation',{name:'Mobile sessions',exact:true}).isVisible()?'Mobile sessions':'Sessions',exact:true});await nav.getByRole('button',{name,exact:true}).click();await wait(async()=>await page.locator('.app-header h1').innerText()===name,'select '+name);};
 const input=page.getByLabel('Message the lead'),toggle=page.locator('.unread-replies-toggle');
 const list=async()=>page.evaluate(async()=>await(await fetch('/api/replies')).json());
 const bounds=async()=>{await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1),false);};
 console.error('browser-step','open');
 await page.goto(host.status().url!);await select('Research conversation');await page.locator('.composer-gate').getByRole('button',{name:'Prepare session',exact:true}).click();await wait(()=>input.isEnabled(),'composer');
 assert.equal(await toggle.count(),0);console.error('browser-step','checkpoint');checks.push('healthy-empty-no-panel');
 await input.fill('Research the behavior');await input.press('Enter');await wait(()=>driver.turns.length===1,'first turn');
 await select('Other conversation');await input.count();
 driver.turns[0]!.say('Research answer remains discoverable.\n\n'+('Detailed explanation of the result.\n\n'.repeat(110)));driver.turns[0]!.finish();
 await wait(async()=>(await list()).total===1,'first unread');const first=(await list()).replies[0];
 await command({type:'prompt.send',text:'Independent result'},a);await wait(()=>driver.turns.length===2,'second turn');driver.turns[1]!.say('Independent background work completed.');driver.turns[1]!.finish();
 await wait(async()=>(await list()).total===2,'two retained replies');
 // Add distant paginated chat without creating any execution or authority.
 for(let n=0;n<90;n++)manager.openLog(a)!.append({kind:'message.completed',source:{taskId:'lead',memberId:'lead'},data:{role:'user',text:`Historical fixture row ${n}`}});
 await wait(async()=>await toggle.innerText()==='2 unread replies','compact count');await toggle.click();assert.equal(await page.locator('.unread-replies-list').count(),1);await page.screenshot({path:join(evidence,'desktop-dark-list.png'),fullPage:true});
 let releaseOrigin:()=>void=()=>{};const originHeld=new Promise<void>(resolve=>releaseOrigin=resolve);let originStarted=false;releases.push(()=>releaseOrigin());
 await page.route(`**/api/sessions/${a}/summary`,async route=>{originStarted=true;await originHeld;await route.continue();});
 await page.locator('.unread-replies-list li button').first().click();await wait(()=>originStarted,'held origin summary');
 await select('Other conversation');releaseOrigin();await Bun.sleep(250);assert.equal(await page.locator('.app-header h1').innerText(),'Other conversation','stale navigation cannot override a later selection');
 await page.unroute(`**/api/sessions/${a}/summary`);await toggle.click();
 await page.locator('.unread-replies-list li button').first().click();await wait(async()=>await page.locator(`#message-${first.messageSeq}`).evaluate(el=>el===document.activeElement).catch(()=>false),'exact historical focus');console.error('browser-step','checkpoint');checks.push('stale-held-origin-cannot-overwrite-later-session-selection');
 assert.equal(new URL(page.url()).searchParams.get('reply'),first.replyId);await wait(async()=>(await list()).total===1,'long answer displayed without whole visibility');assert(await page.locator('.history-navigation').innerText());console.error('browser-step','checkpoint');checks.push('two-replies-retained-exact-paginated-navigation-long-reply-visible-receipt');
 await input.fill('Research draft survives navigation');await select('Other conversation');
 // Cold link loads the exact historical answer, never the latest message.
 const cold=await context.newPage();await cold.goto(`${host.status().url!}/?session=${a}&reply=${first.replyId}`);await wait(async()=>await cold.locator(`#message-${first.messageSeq}`).evaluate(el=>el===document.activeElement).catch(()=>false),'cold exact focus');await cold.close();await page.bringToFront();
 await select('Research conversation');assert.equal(await input.inputValue(),'Research draft survives navigation');console.error('browser-step','checkpoint');checks.push('cold-link-and-session-drafts');
 await select('Other conversation');
 await page.evaluate(async()=>{await navigator.serviceWorker.register('/service-worker.js',{scope:'/'});await navigator.serviceWorker.ready;});
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 const worker=context.serviceWorkers()[0]!;
 const routed=await worker.evaluate(async({sessionId,replyId})=>{
   const clients=await (globalThis as any).clients.matchAll({type:'window',includeUncontrolled:true});
   const client=clients[0];return await new Promise<boolean>(resolve=>{const channel=new MessageChannel(),timer=setTimeout(()=>resolve(false),2000);channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data?.opened===true);};client.postMessage({type:'deck.open-session',sessionId,replyId},[channel.port2]);});
 },{sessionId:a,replyId:first.replyId});
 assert.equal(routed,true);await wait(async()=>await page.locator(`#message-${first.messageSeq}`).evaluate(el=>el===document.activeElement).catch(()=>false),'real worker warm exact link');assert.equal(await input.inputValue(),'Research draft survives navigation');console.error('browser-step','checkpoint');checks.push('real-service-worker-warm-route-exact-focus-draft');
 await page.reload();await wait(async()=>(await list()).total===1,'reload does not read unseen reply');
 const pending=(await list()).replies[0];
 await select('Other conversation');await input.count();
 let releaseReceipt:()=>void=()=>{};const held=new Promise<void>(resolve=>releaseReceipt=resolve);let receiptAttempts=0;releases.push(()=>releaseReceipt());
 await page.route(`**/api/sessions/${a}/replies/${pending.replyId}`,async route=>{if(route.request().method()==='POST'){receiptAttempts++;await held;}await route.continue();});
 // Headless Chrome reports both pages focused on this host. Control the focus
 // predicate for this one negative branch; do not claim physical tab-focus coverage.
 await page.addInitScript(()=>{(window as any).__replyTestFocus=false;const native=document.hasFocus.bind(document);document.hasFocus=()=>typeof (window as any).__replyTestFocus==='boolean'?(window as any).__replyTestFocus:native();});
 const blocker=await context.newPage();await blocker.goto('about:blank');await blocker.bringToFront();
 await page.goto(`${host.status().url!}/?session=${a}&reply=${pending.replyId}`);
 await wait(async()=>await page.locator(`#message-${pending.messageSeq}`).evaluate(el=>el===document.activeElement).catch(()=>false),'unfocused exact answer rendered');await blocker.bringToFront();const focusState=await page.evaluate(()=>({focus:document.hasFocus(),visibility:document.visibilityState}));writeFileSync(join(evidence,'focus-fixture.json'),JSON.stringify(focusState));await Bun.sleep(700);assert.equal(receiptAttempts,0,'unfocused display is inert');
 await page.bringToFront();await page.evaluate(()=>{(window as any).__replyTestFocus=true;window.dispatchEvent(new Event('focus'));});await wait(()=>receiptAttempts>0,'focused viewport attempts exact display');
 await select('Other conversation');releaseReceipt();await wait(async()=>(await list()).total===0,'held exact receipt settles for original identity');await blocker.close();await page.unroute(`**/api/sessions/${a}/replies/${pending.replyId}`);
 await select('Research conversation');console.error('browser-step','checkpoint');checks.push('controlled-focus-gate-inert-until-visible-exact-receipt-session-race');
 // Create another unread reply for the visual count without selecting its chat.
 await select('Other conversation');await command({type:'prompt.send',text:'Visual reply'},a);await wait(()=>driver.turns.length===3,'visual turn');driver.turns[2]!.say('A further result remains unread.');driver.turns[2]!.finish();await wait(async()=>(await list()).total===1,'visual unread');
 await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('light');await bounds();await page.screenshot({path:join(evidence,'desktop-light.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('cyberpunk');await bounds();await toggle.click();await page.screenshot({path:join(evidence,'mobile-390-cyberpunk.png'),fullPage:true});await page.keyboard.press('Escape');assert.equal(await toggle.evaluate(el=>el===document.activeElement),true);
 await page.setViewportSize({width:320,height:740});await bounds();await page.screenshot({path:join(evidence,'mobile-320-cyberpunk.png'),fullPage:true});console.error('browser-step','checkpoint');checks.push('desktop-mobile-themes-keyboard-no-overflow');
 assert.deepEqual(errors,[]);writeFileSync(join(evidence,'browser.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors,evidence}));
}finally{releases.forEach(release=>release());await browser.close();await host.close();await manager.close();rmSync(root,{recursive:true,force:true});}
