import { selectTheme } from './acceptance-theme';
/** Opt-in mobile menu visual/interaction acceptance. Local HTTP + fake native effects only. */
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

const phase=process.env.DECK_MENU_PHASE??'after';
const evidence=join('/tmp/deck-mobile-menu-evidence',phase);mkdirSync(evidence,{recursive:true});
const root=realpathSync(mkdtempSync('/tmp/deck-menu-')),home=join(root,'home');mkdirSync(home);
const paths=resolveStatePaths({env:{XDG_STATE_HOME:join(root,'state')}});ensureStateLayout(paths);
const driver=new FakeDriver();driver.onStart=turn=>turn.init();
const credentials=new CredentialRegistry({socketPath:paths.socket.path});let manager!:SessionManager;
const config:CrossRunnerConfig={enabled:true,members:{lead:{runnerId:'claude',modelId:'fixture'}},executionBudget:{lead:2,delegated:4},approvals:{claude:'relay',codex:'runner-default',opencode:'relay'},maxConcurrentTasks:4,claudeTosAcknowledgedAt:null,web:{port:0,trustedProxy:null,allowedOrigins:[],allowFunnel:false}};
manager=new SessionManager({paths,credentials,broker:new ApprovalBroker({sink:{emit:(id,draft)=>manager.openLog(id)?.append(draft)}}),supervisor:new Supervisor({anchorCommand:['unused']}),drivers:{get:id=>id==='claude'?driver:undefined,list:()=>[driver]},config:()=>config,sessionMcpCommand:['/not-launched/deck'],homeDir:home});
const host=new WebService({paths,assets:WEB_ASSETS,config:config.web,service:manager});host.enable();
const browser=await chromium.launch({executablePath:process.env.DECK_TEST_CHROME??join(homedir(),'Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',isMobile:true,hasTouch:true});
const page=await context.newPage();page.setDefaultTimeout(8000);
const errors:string[]=[],checks:string[]=[],measurements:unknown[]=[];page.on('pageerror',e=>errors.push(e.message));
await context.addInitScript(()=>window.addEventListener('beforeinstallprompt',e=>{if(e.isTrusted){e.preventDefault();e.stopImmediatePropagation();}},true));
const command=async(body:SessionCommandBody,sessionId?:string)=>{const reply=await manager.execute({sessionId,clientId:'menu-browser',command:{v:1,commandId:randomUUID(),...body} as never});assert.equal(reply.ok,true,JSON.stringify(reply));return(reply as any).data;};
const drawer=page.getByRole('dialog',{name:'Workspace',exact:true});
const open=async()=>{await page.getByRole('button',{name:'Open sessions',exact:true}).click();await drawer.waitFor();};
const screenshot=async(name:string)=>page.screenshot({path:join(evidence,name+'.png'),fullPage:true});
const close=async()=>{await drawer.getByRole('button',{name:'Close sessions',exact:true}).click();await drawer.waitFor({state:'hidden'});};
const settle=()=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
const options=async(name:string|RegExp,menuName:string)=>{
 const trigger=drawer.getByRole('button',{name,exact:typeof name==='string'});await trigger.scrollIntoViewIfNeeded();await settle();await trigger.click();
 const menu=drawer.getByRole('menu',{name:menuName,exact:true});await menu.waitFor();
 if(phase==='after'){const box=await menu.boundingBox();assert(box&&box.x>=0&&box.y>=0&&box.x+box.width<=page.viewportSize()!.width&&box.y+box.height<=844,'options are in viewport');}
};
try{
 const ids:string[]=[];
 for(const [index,name] of ['Deck workspace','Research and development','Archived experiments'].entries()){
  const path=join(home,'project-'+index);mkdirSync(path);
  const project=(await command({type:'project.register',path,name})).project.projectId;
  for(let n=0;n<(index===0?16:index===1?2:0);n++)ids.push((await command({type:'session.create',projectId:project,title:n===0?'Current conversation':n===1?'Review navigation and unread replies':'Conversation '+(n+1)})).sessionId);
 }
 await page.goto(host.pair().url);await page.locator('.app-header').waitFor();
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});await selectTheme(page,'cyberpunk');
  await open();await drawer.locator('.navigation-scroll').evaluate(el=>el.scrollTop=0);await settle();
  const expanded=drawer.getByRole('button',{name:/^Sessions in Deck workspace /});
  if(await expanded.getAttribute('aria-expanded')==='true')await expanded.click();
  await settle();await screenshot(`menu-${width}-projects`);
  if(await expanded.getAttribute('aria-expanded')!=='true')await expanded.click();
  await drawer.getByRole('button',{name:'Current conversation',exact:true}).waitFor();await screenshot(`menu-${width}-sessions`);
  const stats=await drawer.evaluate(el=>{
   const box=(node:Element)=>{const b=node.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom};};
   const nav=el.querySelector('.project-navigation')!,footer=el.querySelector('.deck-menu')!,scroll=el.querySelector('.navigation-scroll')!;
   return{viewport:innerWidth,drawer:box(el),navigation:box(nav),footer:box(footer),scroll:box(scroll),scrollHeight:scroll.scrollHeight,scrollWidth:scroll.scrollWidth,clientWidth:scroll.clientWidth,close:box(el.querySelector('.drawer-close')!),session:box(el.querySelector('.session')!),project:box(el.querySelector('.project-toggle')!)};
  });measurements.push(stats);
  if(phase==='after'){
   const trigger=drawer.getByRole('button',{name:'More options for Current conversation',exact:true});await trigger.scrollIntoViewIfNeeded();await settle();
   await trigger.evaluate(el=>{const scroll=el.closest('.navigation-scroll')!;scroll.scrollTop+=el.getBoundingClientRect().bottom-(innerHeight-94);});await settle();
   await options('More options for Current conversation','Options for session Current conversation');await screenshot(`menu-${width}-edge-options`);await page.keyboard.press('Escape');
  }
  await options('More options for Current conversation','Options for session Current conversation');await screenshot(`menu-${width}-session-options`);await page.keyboard.press('Escape');
  await options(/^More options for Deck workspace /,'Options for Deck workspace');await screenshot(`menu-${width}-project-options`);await page.keyboard.press('Escape');
  if(phase==='before')await drawer.getByRole('button',{name:'Deck menu',exact:true}).click();
  await screenshot(`menu-${width}-secondary`);
  await drawer.getByRole(phase==='before'?'menuitem':'button',{name:'Install Deck',exact:true}).click();const install=page.getByRole('dialog',{name:'Install Deck',exact:true});await install.waitFor();await screenshot(`menu-${width}-install`);
  await page.goBack();await drawer.waitFor();await page.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});
  if(phase==='after'){
   assert(stats.navigation.width>=width-100,'project navigation uses drawer width');
   assert(stats.footer.y>=stats.scroll.bottom-1,'secondary actions follow navigation vertically');
   assert(stats.session.height>=44&&stats.project.height>=44&&stats.close.height>=44,'comfortable touch rows');
   assert(stats.scrollWidth<=stats.clientWidth+1,'no navigation horizontal overflow');
   await open();const scroll=drawer.locator('.navigation-scroll');await scroll.evaluate(el=>el.scrollTop=el.scrollHeight);
   const emptyProject=drawer.getByRole('button',{name:/^Sessions in Archived experiments /});const entryBefore=await page.evaluate(()=>history.state.deck.key);if(await emptyProject.getAttribute('aria-expanded')!=='true')await emptyProject.click();await drawer.getByText('No sessions yet.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>history.state.deck.key),entryBefore,'project expansion stays in the same drawer entry');await screenshot(`menu-${width}-bottom-empty`);
   const foot=await drawer.locator('.deck-menu').boundingBox();assert(foot&&foot.y+foot.height<=844,'secondary actions stay reachable');
   await close();await page.getByRole('button',{name:'Open sessions',exact:true}).evaluate(el=>{if(el!==document.activeElement)throw Error('Drawer opener focus was not restored');});
  }
  checks.push(`visual-menu-states-${width}`);
 }
 // Desktop keeps its existing sidebar/menu composition.
 await page.setViewportSize({width:1440,height:1000});await selectTheme(page,'light');
 await page.getByRole('navigation',{name:'Sessions',exact:true}).waitFor();await screenshot('desktop-1440');checks.push('desktop-visual');
 const sidebar=page.getByRole('navigation',{name:'Sessions',exact:true});assert.equal(Math.round((await sidebar.boundingBox())!.width),224);
 await sidebar.getByRole('button',{name:'Deck menu',exact:true}).click();await sidebar.getByRole('menuitem',{name:'Install Deck',exact:true}).click();
 await page.getByRole('dialog',{name:'Install Deck',exact:true}).waitFor();await screenshot('desktop-install-1440');await page.keyboard.press('Escape');
 await sidebar.getByRole('button',{name:'Deck menu',exact:true}).evaluate(el=>{if(el!==document.activeElement)throw Error('Desktop menu focus was not restored');});checks.push('desktop-menu-install-focus');
 if(phase==='after'){
  await page.setViewportSize({width:390,height:844});await selectTheme(page,'dark');await open();await drawer.locator('.navigation-scroll').evaluate(el=>el.scrollTop=0);await settle();await screenshot('menu-390-dark');await close();
  await open();const current=drawer.getByRole('button',{name:'Current conversation',exact:true});await current.scrollIntoViewIfNeeded();await settle();await current.click();await drawer.waitFor({state:'hidden'});
  await open();assert.equal(await drawer.getByRole('button',{name:'Current conversation',exact:true}).getAttribute('aria-current'),'page');await screenshot('menu-390-selected');await close();checks.push('dark-theme-and-current-session');
 }
 assert.equal(driver.turns.length,0,'inspection must not run a native turn');assert.deepEqual(errors,[]);
 writeFileSync(join(evidence,'browser.json'),JSON.stringify({phase,measurements,checks,errors},null,2));console.log(JSON.stringify({evidence,measurements,checks}));
}catch(error){await screenshot('failure').catch(()=>{});throw error;}
finally{await browser.close();await host.close();await manager.close();rmSync(root,{recursive:true,force:true});}

