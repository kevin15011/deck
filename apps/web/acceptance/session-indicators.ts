/** Accepted indicator contract, exercised with fake transport and real bundled UI. */
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {buildWebAssets} from '../../../scripts/generate-web-assets';
import {WebService} from '../../../packages/session-host/src/web-service';
import {Ledger} from '../../../packages/session-host/src/ledger';
import {summarizeActivity} from '../../../packages/session-host/src/activity-summary';
import {EventLog} from '../../../packages/session-host/src/event-log';
import {ensureStateLayout,resolveStatePaths} from '../../../packages/session-host/src/paths';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=mkdtempSync(join(tmpdir(),'deck-indicators-')),paths=resolveStatePaths({env:{XDG_STATE_HOME:root}});ensureStateLayout(paths);
const log=EventLog.open({dir:join(paths.sessionsDir,'s','events'),sessionId:'s'});
log.append({kind:'session.created'});
for(const [taskId,memberId,state] of [['lead','lead','completed'],['worker','review','running']]) {
 log.append({kind:'task.created',source:{taskId,memberId},data:{taskId,memberId,runnerId:'synthetic',state}});
 log.append({kind:'task.state',source:{taskId,memberId},data:{taskId,state}});
}
const activity={workers:{active:1,queued:1,blocked:1,unsettled:0},attention:{approvals:1,questions:0,decisions:0,byLead:0,byWorkers:1,unowned:0},errors:0};
const session={sessionId:'s',projectId:'p',title:'Indicator session',state:'idle',preparationStatus:'ready',lastSeq:log.lastSeq,generation:0,members:{lead:{runnerId:'synthetic',modelId:'test'}},leadActivity:{state:'completed',pendingApprovals:0,lastReplySeq:0},activity};
let offline=false, malformed: unknown = undefined, streamOffline=false;
const host=new WebService({paths,assets:await buildWebAssets(),config:{port:0,trustedProxy:null,allowedOrigins:[],allowFunnel:false},service:{openLog:id=>id==='s'?log:undefined,hasRunningWork:()=>false,execute:async()=>({ok:true}),query:(name)=>{
 if(name==='projects.status') return malformed!==undefined?{ok:true,data:{projects:malformed}}:offline?{ok:false,code:'offline'}:{ok:true,data:{projects:['p','collapsed'].map(projectId=>({projectId,connected:1,leadsRunning:0,leadsStarting:0,attentionSessions:1,...activity}))}};
 return {ok:true,data:name==='projects.list'?{projects:[{projectId:'p',name:'Current',path:'/tmp/current',available:true},{projectId:'collapsed',name:'Never opened',path:'/tmp/other',available:true}]}:name==='sessions.list'||name==='sessions.status'?{sessions:[session]}:name==='decisions.list'?{decisions:[],seq:log.lastSeq,omittedTerminal:0}:name==='session.summary'?{session}:name==='session.readiness'?{status:'ready',generation:0}:name==='prompts.list'?{seq:log.lastSeq,paused:false,queued:[]}: {}};
}}});host.enable();
const browser=await chromium.launch({executablePath:process.env.DECK_TEST_CHROME,headless:true,args:['--no-sandbox']}),page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(8000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
 const Native=window.WebSocket;
 (window as any).indicatorSockets=[];
 window.WebSocket=class extends Native {constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);(window as any).indicatorSockets.push(this);}};
});
await page.route('**/api/sessions/s/history*',route=>streamOffline?route.abort():route.continue());
try {
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto(host.status().url!);
 const collapsed=page.locator('[data-project-id="collapsed"] .project-indicators').first();
 await collapsed.waitFor();await page.waitForFunction(()=>document.querySelector('[data-project-id="collapsed"] .project-indicators')?.getAttribute('aria-label')?.includes('1 sessions need you'));
 assert.match((await collapsed.getAttribute('aria-label'))!,/1 active subagents/);
 await page.getByRole('button',{name:'Indicator session',exact:true}).first().click();
 await page.waitForFunction(()=>document.querySelector('.tab-worker-count')?.textContent==='1');
 const indicators=page.locator('[data-session-id="s"] .session-indicators').first();
 await page.waitForFunction(()=>document.querySelector('[data-session-id="s"] .session-indicators')?.getAttribute('aria-label')?.includes('Lead available'));
 assert.match((await indicators.getAttribute('aria-label'))!,/1 active subagents.*1 approvals/);
 await page.emulateMedia({reducedMotion:'reduce'});
 assert(['','none'].includes(await page.locator('.tab-working .work-orbit').evaluate(el=>getComputedStyle(el).transform)));
 await page.getByRole('tab',{name:'Subagents',exact:true}).focus();await page.keyboard.press('ArrowLeft');assert.equal(await page.getByRole('tab',{name:'Activity',exact:true}).getAttribute('aria-selected'),'true');
 const failureState=Ledger.empty('s').toState();
 failureState.tasks.failed={taskId:'failed',memberId:'review',attempts:[{attempt:1,runnerId:'fake',modelId:'fake',startedSeq:1,state:'failed',integration:{seq:2,leadTaskId:'lead',leadAttempt:1,commandId:'discard',state:'discarded',note:'Replaced',evidenceSeqs:[1]}}]};
 failureState.tasks.replacement={taskId:'replacement',memberId:'review',attempts:[{attempt:1,runnerId:'fake',modelId:'fake',startedSeq:3,state:'completed'}]};
 activity.errors=summarizeActivity(Ledger.fromState(failureState),'lead').errors;
 assert.equal(activity.errors,0);
 failureState.tasks.failed.attempts.push({attempt:2,runnerId:'fake',modelId:'fake',startedSeq:4,state:'failed'});
 activity.errors=summarizeActivity(Ledger.fromState(failureState),'lead').errors;
 await page.waitForFunction(()=>document.querySelector('[data-project-id="collapsed"] .project-indicators')?.getAttribute('aria-label')?.includes('1 unresolved errors'));
 failureState.tasks.failed.attempts[1]!.state='completed';
 activity.errors=summarizeActivity(Ledger.fromState(failureState),'lead').errors;
 await page.waitForFunction(()=>document.querySelector('[data-project-id="collapsed"] .project-indicators')?.getAttribute('aria-label')?.includes('0 unresolved errors'));
 offline=true;await page.waitForFunction(()=>document.querySelector('[data-project-id="collapsed"] .project-indicators')?.getAttribute('data-stale')==='true',{},{timeout:10000});
 assert.match((await collapsed.getAttribute('aria-label'))!,/Stale.*1 active subagents/);
 offline=false;await page.waitForFunction(()=>!document.querySelector('[data-project-id="collapsed"] .project-indicators')?.hasAttribute('data-stale'),{},{timeout:10000});
 malformed=[{projectId:"p"}];await page.waitForFunction(()=>document.querySelector('[data-project-id="collapsed"] .project-indicators')?.getAttribute('data-stale')==='true',{},{timeout:10000});
 malformed=undefined;await page.waitForFunction(()=>!document.querySelector('[data-project-id="collapsed"] .project-indicators')?.hasAttribute('data-stale'),{},{timeout:10000});

 for(const bad of [[null],[{projectId:'p',...activity,workers:null}],[]]) {
  malformed=bad;
  await page.waitForFunction(()=>document.querySelector('[data-project-id="collapsed"] .project-indicators')?.getAttribute('data-stale')==='true');
  assert.match((await collapsed.getAttribute('aria-label'))!,/Stale.*1 active subagents/);
  malformed=undefined;
  await page.waitForFunction(()=>!document.querySelector('[data-project-id="collapsed"] .project-indicators')?.hasAttribute('data-stale'));
 }
 session.leadActivity.state='running';Object.assign(session.leadActivity,{pendingQuestions:1});
 await page.waitForFunction(()=>document.querySelector('[data-session-id="s"] .session-indicators')?.getAttribute('aria-label')?.includes('Lead waiting'));
 assert.match((await indicators.getAttribute('aria-label'))!,/1 active subagents/);
 assert.equal(await indicators.locator('.work-orbit').count(),0);
 streamOffline=true;
 await page.evaluate(()=>(window as any).indicatorSockets.forEach((s:WebSocket)=>s.close()));
 await page.waitForFunction(()=>document.querySelector('#tab-subagents')?.textContent?.includes('Stale: 1 last known active subagents'));
 assert.equal(await page.locator('#tab-subagents .work-orbit').count(),0);
 assert.equal(await page.locator('.tab-worker-count').textContent(),'1');
 log.append({kind:'task.state',source:{taskId:'worker',memberId:'review'},data:{taskId:'worker',state:'completed'}});
 streamOffline=false;
 await page.waitForFunction(()=>document.querySelector('#tab-subagents [role="status"]')?.textContent==='0 active subagents');
 log.append({kind:'task.continued',source:{taskId:'worker',memberId:'review'},data:{taskId:'worker',attempt:2}});
 log.append({kind:'task.state',source:{taskId:'worker',memberId:'review'},data:{taskId:'worker',state:'running'}});
 await page.waitForFunction(()=>document.querySelector('.tab-worker-count')?.textContent==='1');
 for(const width of [320,390,1024,1440]) {
  await page.setViewportSize({width,height:900});
  if(width<1001) await page.getByRole('button',{name:'Open sessions',exact:true}).click();
  const root=width<1001?page.locator('.session-drawer'):page.locator('.sidebar');
  for (const theme of ['dark', 'light']) {
   await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
   const group = root.locator('[data-project-id="p"]');
   const toggle = group.locator('.project-toggle');
   for (const project of await root.locator('.project-toggle').all()) {
    const geometry = await project.evaluate(el => {
     const name = el.querySelector('.project-name')!.getBoundingClientRect();
     const badges = el.querySelector('.project-indicators')!.getBoundingClientRect();
     const icons = [...el.querySelectorAll('.project-indicators svg')].map(icon => icon.getBoundingClientRect());
     return {nameWidth:name.width, beside:badges.x >= name.right - 1 && badges.top < name.bottom && badges.bottom > name.top, sameLine:icons.every(icon => Math.abs(icon.y - icons[0]!.y) < 2), contained:badges.right <= el.getBoundingClientRect().right};
    });
    assert(geometry.beside && geometry.sameLine && geometry.contained, `${width}/${theme}: project badges: ${JSON.stringify(geometry)}`);
    assert(geometry.nameWidth >= 64, `${width}/${theme}: project name space ${geometry.nameWidth}`);
   }
   await toggle.focus();
   await page.screenshot({path:`/tmp/deck-project-grouping-${width}-${theme}.png`});
   assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
   await page.keyboard.press('Enter');
   assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
   assert.equal(await group.locator('.session').isVisible(), false);
   await page.keyboard.press('Enter');
   await group.locator('.session').waitFor({state:'visible'});
   assert.equal(await group.locator('.session').getAttribute('aria-current'), 'page');
   const grip = group.getByRole('button', {name:'Reorder project Current', exact:true});
   await grip.focus();
   assert(await grip.evaluate(el => el === document.activeElement));
   const menu = group.locator('.project-row .project-more');
   await menu.click();
   await page.getByRole('menu', {name:'Options for Current', exact:true}).waitFor();
   await page.keyboard.press('Escape');
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.screenshot({path:`/tmp/deck-session-indicators-${width}.png`});
  for(const selector of ['[data-project-id="p"] .project-name strong','[data-session-id="s"] .session-label strong']) {
   assert(await root.locator(selector).first().evaluate(el=>el.scrollWidth<=el.clientWidth+1), `${width}: ${selector}`);
  }
  for (const title of ['Current', 'Indicator session', 'Review navigation and project indicators']) {
   const row = root.locator('[data-session-id="s"]').first();
   await row.locator('.session-label strong').evaluate((el, title) => { el.textContent = title; }, title);
   const geometry = await row.evaluate(el => {
    const name = el.querySelector('.session-label')!.getBoundingClientRect();
    const badges = el.querySelector('.session-indicators')!.getBoundingClientRect();
    const icons = [...el.querySelectorAll('.session-indicators svg')].map(icon => icon.getBoundingClientRect());
    return {nameWidth:name.width, beside:badges.x >= name.right - 1 && badges.top < name.bottom && badges.bottom > name.top, sameLine:icons.every(icon => Math.abs(icon.y - icons[0]!.y) < 2), contained:badges.right <= el.getBoundingClientRect().right};
   });
   assert(geometry.beside && geometry.sameLine && geometry.contained, `${width}: ${title}: ${JSON.stringify(geometry)}`);
   assert(geometry.nameWidth >= 64, `${width}: name space ${geometry.nameWidth}`);
   await page.screenshot({path:`/tmp/deck-session-inline-${width}-${title === 'Current' ? 'short' : title === 'Indicator session' ? 'medium' : 'long'}.png`});
  }
  await root.locator('[data-session-id="s"] .session-label strong').first().evaluate(el => { el.textContent = 'Indicator session'; });
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:`/tmp/deck-session-indicators-${width}.png`});
  if(width<1001) await page.getByRole('button',{name:'Close sessions',exact:true}).click();
 }

 assert.deepEqual(errors,[]);console.log('session indicators browser acceptance passed');
} catch(error) { console.log(await page.locator('body').innerText()); console.log(errors); throw error; } finally {await browser.close();await host.disable();log.close();rmSync(root,{recursive:true,force:true});}
