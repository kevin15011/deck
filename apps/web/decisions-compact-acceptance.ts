/** Opt-in composed browser regression. Uses an isolated fixture service, never an installed daemon. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
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
import {ensureStateLayout,resolveStatePaths,sessionPaths} from '../../packages/session-host/src/paths';
import {WEB_ASSETS} from '../cli/src/runtime/web-assets.generated';

const evidence='/tmp/deck-decisions-compact-evidence';mkdirSync(evidence,{recursive:true});
const root=realpathSync(mkdtempSync(join(tmpdir(),'deck-compact-browser-'))),home=join(root,'home'),project=join(home,'project');mkdirSync(project,{recursive:true});
const paths=resolveStatePaths({env:{XDG_STATE_HOME:join(root,'state')}});ensureStateLayout(paths);
const driver=new FakeDriver();driver.onStart=turn=>{turn.init();turn.say('Fixture response');};
const credentials=new CredentialRegistry({socketPath:paths.socket.path});let manager!:SessionManager;
const config:CrossRunnerConfig={enabled:true,members:{lead:{runnerId:'claude',modelId:'fixture'}},executionBudget:{lead:2,delegated:4},approvals:{claude:'relay',codex:'runner-default',opencode:'relay'},maxConcurrentTasks:4,claudeTosAcknowledgedAt:null,web:{port:0,trustedProxy:null,allowedOrigins:[],allowFunnel:false}};
manager=new SessionManager({paths,credentials,broker:new ApprovalBroker({sink:{emit:(id,draft)=>{manager.openLog(id)?.append(draft);}}}),supervisor:new Supervisor({anchorCommand:['unused']}),drivers:{get:id=>id==='claude'?driver:undefined,list:()=>[driver]},config:()=>config,sessionMcpCommand:['/not-launched/deck'],homeDir:home});
const host=new WebService({paths,assets:WEB_ASSETS,config:config.web,service:manager});host.enable();
const browser=await chromium.launch({executablePath:process.env.DECK_TEST_CHROME??join(homedir(),'Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(6000);
const errors:string[]=[],checks:string[]=[],measurements:Record<string,unknown>={};page.on('pageerror',error=>errors.push(error.message));
const wait=async(condition:()=>boolean|Promise<boolean>,label:string)=>{for(let i=0;i<160;i++){if(await condition())return;await Bun.sleep(25);}throw Error(`Timed out: ${label}`);};
const command=async(body:SessionCommandBody,sessionId?:string)=>{const result=await manager.execute({sessionId,clientId:'compact-browser-fixture',command:{v:1,commandId:randomUUID(),...body} as never});assert.equal(result.ok,true,JSON.stringify(result));return (result as any).data;};
try{
 const registered=await command({type:'project.register',path:project,name:'Compact decisions'});
 const id=(await command({type:'session.create',projectId:registered.project.projectId,title:'Compact conversation'})).sessionId;
 await command({type:'session.create',projectId:registered.project.projectId,title:'Empty conversation'});
 const select=async(name:string)=>{if(await page.getByRole('button',{name:'Open sessions',exact:true}).isVisible())await page.getByRole('button',{name:'Open sessions',exact:true}).click();const nav=page.getByRole('navigation',{name:await page.getByRole('navigation',{name:'Mobile sessions',exact:true}).isVisible()?'Mobile sessions':'Sessions',exact:true});await nav.getByRole('button',{name,exact:true}).click();await wait(async()=>await page.locator('.app-header h1').innerText()===name,'session selection');};
 const input=page.getByLabel('Message the lead'),panel=page.getByRole('region',{name:'Decisions',exact:true});
 const bounds=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1),false,'no outer overflow');
 await page.goto(host.status().url!);await select('Compact conversation');await page.locator('.composer-gate').getByRole('button',{name:'Prepare session',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('cyberpunk');await wait(async()=>await input.isEnabled(),'composer ready');
 if(process.env.DECK_TEST_DECISIONS_BASELINE==='1'){
  await panel.waitFor();measurements.emptyPanelCount=await panel.count();measurements.emptyPanelHeight=await panel.evaluate(el=>el.getBoundingClientRect().height);assert.equal(measurements.emptyPanelCount,1);
  await page.screenshot({path:join(evidence,'before-mobile-cyberpunk.png'),fullPage:true});writeFileSync(join(evidence,'baseline.json'),JSON.stringify(measurements,null,2));console.log(JSON.stringify({baseline:true,...measurements}));
 }else{
  await wait(async()=>await panel.count()===0,'healthy empty decisions hidden');assert.equal(await page.locator('.decisions-panel').count(),0);await bounds();
  await page.screenshot({path:join(evidence,'empty-mobile-cyberpunk.png'),fullPage:true});measurements.emptyPanelHeight=0;checks.push('composed-empty-has-zero-panels-and-zero-footer-height');
  await input.fill('Plan the compact decisions change');await input.press('Enter');await wait(()=>driver.turns.length===1,'fake Lead turn');
  const events=()=>[...manager.openLog(id)!.readAfter(0)],promptId=String(events().find(e=>e.kind==='prompt.dispatched')!.data.promptId);
  const call=async(name:string,args:Record<string,unknown>)=>{const grant=credentials.lookup(JSON.parse(readFileSync(sessionPaths(paths,id).taskCredentialFile('lead'),'utf8')).token)!;return manager.callTaskTool(grant,name,args);};
  const opened=await call('deck_decision_open',{commandId:'compact-open',key:'compact',question:'May the compact change proceed?',source:{promptId}});assert.equal(opened.ok,true);const decisionId=(opened as any).data.decisionId;
  const toggle=panel.getByRole('button',{name:'Decisions: 1 open',exact:true});await toggle.waitFor();assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await panel.count(),1);assert.equal(await panel.getByRole('button',{name:'Reply to May the compact change proceed?',exact:true}).count(),0);
  measurements.collapsedHeight=await panel.evaluate(el=>el.getBoundingClientRect().height);assert(Number(measurements.collapsedHeight)<=52);checks.push('composed-pending-one-collapsed-disclosure-no-duplicate');
  for(const theme of ['dark','light','cyberpunk']){await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption(theme);await bounds();await page.screenshot({path:join(evidence,`pending-mobile-${theme}.png`),fullPage:true});}
  await page.setViewportSize({width:320,height:740});await bounds();assert.equal(await panel.count(),1);await page.screenshot({path:join(evidence,'pending-mobile-320-cyberpunk.png'),fullPage:true});await page.setViewportSize({width:390,height:844});
  await toggle.focus();await page.keyboard.press('Space');await panel.getByRole('button',{name:'Reply to May the compact change proceed?',exact:true}).waitFor();assert.equal(await toggle.getAttribute('aria-expanded'),'true');
  await panel.getByRole('button',{name:'Reply to May the compact change proceed?',exact:true}).click();assert.equal(await input.evaluate(el=>el===document.activeElement),true);await input.fill('Draft preserved while collapsed');await toggle.click();
  await page.getByRole('button',{name:'Clear reply target',exact:true}).waitFor();assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.match(await page.locator('#decision-target-status').innerText(),/Replying to:/);
  await page.getByRole('button',{name:'Clear reply target',exact:true}).focus();await page.keyboard.press('Escape');assert.equal(await input.inputValue(),'Draft preserved while collapsed');assert.equal(await input.evaluate(el=>el===document.activeElement),true);checks.push('keyboard-explicit-expansion-reply-target-visible-collapsed-escape-focus');
  await toggle.click();let failQuery=true;const query=`**/api/sessions/${id}/decisions`;
  await page.route(query,route=>failQuery?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,code:'compact-query-error'})}):route.continue());
  await panel.getByRole('button',{name:'Refresh decisions',exact:true}).click();await panel.getByRole('alert').waitFor();await toggle.click();assert.match(await panel.getByRole('alert').innerText(),/compact-query-error/);assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  failQuery=false;await panel.getByRole('button',{name:'Refresh decisions',exact:true}).click();await wait(async()=>await panel.getByRole('alert').count()===0,'query recovery');await page.unroute(query);assert.equal(await input.inputValue(),'Draft preserved while collapsed');checks.push('errors-visible-while-collapsed-and-retry-preserves-draft');
  await toggle.click();await panel.getByRole('button',{name:'Cancel decision: May the compact change proceed?',exact:true}).focus();await page.keyboard.press('Enter');
  const history=panel.getByRole('button',{name:'Decision history',exact:true});await history.waitFor();await wait(async()=>await history.evaluate(el=>el===document.activeElement),'focus recovers from removed row');await history.click();assert.equal(await history.getAttribute('aria-expanded'),'false');await history.click();await panel.getByText('Resolved decisions',{exact:true}).click();await panel.getByRole('link',{name:'View origin for May the compact change proceed?',exact:true}).click();await page.getByRole('article',{name:'Decision origin',exact:true}).waitFor();await page.getByRole('button',{name:'Close origin',exact:true}).click();checks.push('terminal-history-and-exact-origin-remain-accessible-focus-recovered');
  await select('Empty conversation');await wait(async()=>await panel.count()===0,'empty other session');await page.screenshot({path:join(evidence,'empty-other-mobile-cyberpunk.png'),fullPage:true});
  await select('Compact conversation');await panel.getByRole('button',{name:'Decision history',exact:true}).waitFor();assert.equal(await input.inputValue(),'Draft preserved while collapsed');assert.equal(await panel.count(),1);assert.equal(await panel.getByRole('button',{name:'Decision history',exact:true}).getAttribute('aria-expanded'),'false');
  for(let i=0;i<3;i++){await select('Empty conversation');await wait(async()=>await panel.count()===0,'no orphan panel after repeated switch');assert.equal(await page.locator('.composer-gate').count(),1);await select('Compact conversation');await panel.getByRole('button',{name:'Decision history',exact:true}).waitFor();assert.equal(await panel.count(),1);assert.equal(await page.locator('.composer').count(),1);assert.equal(await input.inputValue(),'Draft preserved while collapsed');}
  await bounds();checks.push('session-switch-resets-disclosure-no-duplication-preserves-draft');
  assert.deepEqual(errors,[]);writeFileSync(join(evidence,'browser.json'),JSON.stringify({ok:true,checks,measurements},null,2));console.log(JSON.stringify({ok:true,checks,measurements}));
 }
}catch(error){writeFileSync(join(evidence,'browser-failure.txt'),await page.locator('body').innerText());await page.screenshot({path:join(evidence,'browser-failure.png'),fullPage:true});
 if(String(error).includes('empty other session')){
  await page.getByRole('button',{name:'Open sessions',exact:true}).click();await page.getByRole('navigation',{name:'Mobile sessions',exact:true}).getByRole('button',{name:'Compact conversation',exact:true}).click();
  await wait(async()=>await page.locator('.app-header h1').innerText()==='Compact conversation','failure reproduction return');
  writeFileSync(join(evidence,'duplicate-red.json'),JSON.stringify({panelsAfterRoundTrip:await page.locator('.decisions-panel').count()},null,2));await page.screenshot({path:join(evidence,'duplicate-after-switch-red.png'),fullPage:true});
 }throw error;}
finally{await browser.close();await host.close();await manager.close();rmSync(root,{recursive:true,force:true});}
