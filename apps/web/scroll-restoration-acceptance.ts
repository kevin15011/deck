/** Opt-in real HTTP/WebSocket/Chromium acceptance, with scripted native effects only. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
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
const evidence='/tmp/deck-chat-scroll-browser';mkdirSync(evidence,{recursive:true});
const root=realpathSync(mkdtempSync('/tmp/dni-')),home=join(root,'home'),project=join(home,'project');mkdirSync(project,{recursive:true});
const paths=resolveStatePaths({env:{XDG_STATE_HOME:join(root,'state')}});ensureStateLayout(paths);
const driver=new FakeDriver();driver.onStart=t=>t.init();
const credentials=new CredentialRegistry({socketPath:paths.socket.path});let manager!:SessionManager;
const config:CrossRunnerConfig={enabled:true,members:{lead:{runnerId:'claude',modelId:'fixture'}},executionBudget:{lead:2,delegated:4},approvals:{claude:'relay',codex:'runner-default',opencode:'relay'},maxConcurrentTasks:4,claudeTosAcknowledgedAt:null,web:{port:0,trustedProxy:null,allowedOrigins:[],allowFunnel:false}};
manager=new SessionManager({paths,credentials,broker:new ApprovalBroker({sink:{emit:(id,draft)=>manager.openLog(id)?.append(draft)}}),supervisor:new Supervisor({anchorCommand:['unused']}),drivers:{get:id=>id==='claude'?driver:undefined,list:()=>[driver]},config:()=>config,sessionMcpCommand:['/not-launched/deck'],homeDir:home});
// Exercise current source without regenerating or overwriting bundled CLI assets.
const build=await Bun.build({entrypoints:[join(import.meta.dir,'src/main.tsx')],target:'browser',naming:'app.[ext]'});
assert(build.success,build.logs.map(String).join('\n'));
const assets={...WEB_ASSETS};
for(const output of build.outputs)assets['/'+output.path.split('/').at(-1)!]={body:new Uint8Array(await output.arrayBuffer()),contentType:output.type};
assets['/service-worker.js']={body:readFileSync(join(import.meta.dir,'src/service-worker.js'),'utf8'),contentType:'text/javascript'};
const host=new WebService({paths,assets,config:config.web,service:manager});host.enable();
const browser=await chromium.launch({...(process.env.DECK_TEST_CHROME?{executablePath:process.env.DECK_TEST_CHROME}:{}),headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(8000);
const errors:string[]=[],checks:string[]=[],releases:(()=>void)[]=[];page.on('pageerror',e=>{errors.push(e.message);console.error('browser-page-error',e.message);});
const wait=async(fn:()=>boolean|Promise<boolean>,label:string)=>{for(let n=0;n<240;n++){if(await fn())return;await Bun.sleep(25);}throw Error('Timed out: '+label);};
await context.addInitScript(()=>{window.addEventListener('beforeinstallprompt',event=>{if(event.isTrusted){event.preventDefault();event.stopImmediatePropagation();}},true);});
const command=async(body:SessionCommandBody,sessionId?:string)=>{const r=await manager.execute({sessionId,clientId:'unread-browser',command:{v:1,commandId:randomUUID(),...body} as never});assert.equal(r.ok,true,JSON.stringify(r));return(r as any).data;};
const checkpoint=(name:string)=>{checks.push(name);console.error('pass',name);};
const hold=()=>{let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);releases.push(()=>release());return{promise,release};};
try{
 const p1=(await command({type:'project.register',path:project,name:'Alpha'})).project.projectId;
 const s1=(await command({type:'session.create',projectId:p1,title:'First conversation'})).sessionId;
 const s2=(await command({type:'session.create',projectId:p1,title:'Second conversation'})).sessionId;
 for(const id of [s1,s2])for(let n=0;n<80;n++)manager.openLog(id)!.append({kind:'message.completed',source:{taskId:'lead',memberId:'lead'},data:{role:'assistant',text:`Historical row ${n}. `+'Reading context. '.repeat(30)}});
 const input=page.getByLabel('Message the lead'),drawer=page.getByRole('dialog',{name:'Workspace',exact:true});
 const heading=()=>page.locator('.app-header h1').innerText();
 const ready=async()=>{await wait(async()=>{if(await input.count()&&await input.isEnabled())return true;const prepare=page.locator('.composer-gate').getByRole('button',{name:'Prepare session',exact:true});if(await prepare.isVisible()&&await prepare.isEnabled({timeout:100}).catch(()=>false))await prepare.click({timeout:500}).catch(()=>{});return false;},'composer ready');};
 const current=()=>page.evaluate(()=>history.state?.deck);
 const select=async(name:string,waitReady=true)=>{if(await page.getByRole('button',{name:'Open sessions',exact:true}).isVisible())await page.getByRole('button',{name:'Open sessions',exact:true}).click();else if(await page.getByRole('button',{name:'Expand sidebar',exact:true}).isVisible())await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();
  const nav=page.getByRole('navigation',{name:await drawer.isVisible()?'Mobile sessions':'Sessions',exact:true});
  // Explicitly expand a collapsed project; this is presentation, not automatic routing.
  if(!await nav.getByRole('button',{name,exact:true}).isVisible()){const toggle=nav.getByRole('button',{name:name==='First conversation'?/Sessions in Alpha/:/Sessions in Beta/});await toggle.click();}
  await nav.getByRole('button',{name,exact:true}).click();await wait(async()=>await heading()===name,'select '+name);if(waitReady)await ready();};
 const position=()=>page.evaluate(()=>{const viewport=document.getElementById('conversation')!,top=viewport.getBoundingClientRect().top;const row=[...viewport.querySelectorAll<HTMLElement>('[data-history-id]')].find(row=>row.getBoundingClientRect().bottom>top);if(!row)return{id:0,seq:0,offset:0};return{id:Number(row.dataset.historyId),seq:Number(row.querySelector<HTMLElement>('[id^="message-"]')?.id.slice(8)),offset:row.getBoundingClientRect().top-top};});

 const pair=host.pair();await page.goto(`${host.status().url!}/?session=${s1}#pair=${new URL(pair.url).hash.split('=')[1]}`);await ready();
 const tail=()=>page.locator('#conversation').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop);
 const bottom=async()=>{const latest=page.getByRole('button',{name:'Jump to latest ↓',exact:true});if(await latest.isVisible())await latest.click();await page.locator('#conversation').evaluate(el=>el.scrollTop=el.scrollHeight);await wait(async()=>await tail()<3,'tail');await Bun.sleep(350);};
 // First persist a reading position, then explicitly reach the bottom. The old
 // reading anchor must no longer win when this conversation is selected again.
 await page.locator('#conversation').evaluate(el=>el.scrollTop=350);await Bun.sleep(350);assert((await current()).route.anchor);
 await bottom();await select('Second conversation');await select('First conversation');
 await wait(async()=>await tail()<3,'returning chat follows tail instead of obsolete reading anchor');checkpoint('reading-to-tail-switch-return');
 await page.locator('#conversation').evaluate(el=>el.scrollTop=450);await Bun.sleep(350);const reading=await position();
 await select('Second conversation');await bottom();await select('First conversation');
 await wait(async()=>{const at=await position();return at.id===reading.id&&Math.abs(at.offset-reading.offset)<3;},'independent reading position');checkpoint('independent-reading-anchor');
 await bottom();await page.getByRole('tab',{name:'Activity',exact:true}).click();
 manager.openLog(s1)!.append({kind:'message.completed',source:{taskId:'lead',memberId:'lead'},data:{role:'assistant',text:'Growth while hidden. '.repeat(250)}});
 await wait(async()=>await page.locator('.history-row').last().textContent().then(text=>text?.includes('Growth while hidden.')??false),'hidden message delivered');
 await page.getByRole('tab',{name:'Chat',exact:true}).click();await wait(async()=>await tail()<3,'tail after hidden growth');checkpoint('hidden-chat-growth');
 await page.locator('#conversation').focus();await page.keyboard.press('Home');await Bun.sleep(350);assert(await tail()>80);await page.keyboard.press('End');await wait(async()=>await tail()<3,'keyboard End');
 await select('Second conversation');await select('First conversation');await wait(async()=>await tail()<3,'keyboard tail restoration');checkpoint('keyboard-tail-restoration');

 // Hold a real history response while navigating away. Its eventual completion
 // must not move or annotate the newly selected conversation.
 await select('Second conversation');await bottom();
 const gate=hold();let requested=false;
 const pattern=`**/api/sessions/${s1}/history*`;
 await page.route(pattern,async route=>{requested=true;await gate.promise;await route.continue().catch(()=>{});});
 await select('First conversation',false);await wait(()=>requested,'delayed hydration requested');
 await select('Second conversation');gate.release();await page.unroute(pattern);await Bun.sleep(350);
 assert.equal((await current()).route.session,s2);assert(await tail()<3);assert.equal((await current()).route.anchor,undefined);
 await select('First conversation');await wait(async()=>await tail()<3,'tail after delayed hydration');checkpoint('stale-hydration-after-fast-switch');
 await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'no-preference'});
 await bottom();const left=page.getByRole('button',{name:'Left panel',exact:true});
 await left.click();await wait(async()=>!await page.locator('#conversation').isVisible(),'desktop chat hidden');
 await select('Second conversation');await select('First conversation');await left.click();await wait(async()=>await page.locator('#conversation').isVisible(),'desktop chat shown');await wait(async()=>await tail()<3,'desktop session switch');
 await left.click();await left.click();await wait(async()=>await page.locator('#panel-chat').evaluate(el=>!(el as HTMLElement).hidden&&!el.hasAttribute('data-view-exiting')&&!el.style.transform),'rapid panel reversal');await wait(async()=>await tail()<3,'tail after rapid panel reversal');
 await page.getByRole('tab',{name:'Activity',exact:true}).focus();await page.keyboard.press('ArrowRight');await wait(async()=>await page.getByRole('tab',{name:'Subagents',exact:true}).getAttribute('aria-selected')==='true','workspace keyboard transition');
 await page.emulateMedia({reducedMotion:'reduce'});await wait(async()=>await tail()<3,'reduced motion tail');checkpoint('desktop-panel-reversal-keyboard-reduced-motion');
 manager.openLog(s1)!.append({kind:'message.completed',source:{taskId:'lead',memberId:'lead'},data:{role:'assistant',text:'Live tail growth. '.repeat(250)}});
 await wait(async()=>await page.locator('.history-row').last().textContent().then(text=>text?.includes('Live tail growth.')??false),'live message delivered');await wait(async()=>await tail()<3,'live tail growth');checkpoint('live-tail-growth');
 // Reflow and older-scroll intent can land in the same browser frame. The
 // scroll event is asynchronous, so queue both changes before it is delivered.
 await bottom();
 await page.locator('#conversation').evaluate(el=>{el.dispatchEvent(new WheelEvent('wheel',{deltaY:-400,bubbles:true}));(el.firstElementChild as HTMLElement).style.paddingTop='90px';el.scrollTop-=400;});
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 assert(await tail()>200,'manual older scroll survives coincident reflow');
 checkpoint('manual-scroll-during-reflow');
 await page.screenshot({path:join(evidence,'desktop-tail.png')});
 assert.deepEqual(errors,[]);writeFileSync(join(evidence,'browser.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors,evidence}));
}catch(error){await page.screenshot({path:join(evidence,'failure.png'),fullPage:true}).catch(()=>{});writeFileSync(join(evidence,'failure.json'),JSON.stringify({checks,errors,url:page.url(),state:await page.evaluate(()=>history.state).catch(()=>null)},null,2));throw error;}finally{releases.forEach(release=>release());await browser.close();await host.close();await manager.close();rmSync(root,{recursive:true,force:true});}
