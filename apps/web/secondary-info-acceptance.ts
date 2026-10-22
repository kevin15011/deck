/** Hydrated source fixture in an ephemeral local server. No production asset
 * generation, installed daemon, backend, native runner or provider inference.
 * DECK_TEST_CHROME=/path/to/chrome bun apps/web/secondary-info-acceptance.ts */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '@playwright/test';
import fixture from './acceptance/secondary-info.html';

const evidence='/tmp/deck-secondary-info-browser';mkdirSync(evidence,{recursive:true});
const server=Bun.serve({hostname:'127.0.0.1',port:0,routes:{'/*':fixture},development:{hmr:false,console:false}});
const browser=await chromium.launch({headless:true,executablePath:process.env.DECK_TEST_CHROME??join(homedir(),'.cache/ms-playwright/chromium-1237/chrome-linux64/chrome'),args:['--no-sandbox']});
const checks:unknown[]=[],errors:string[]=[];
try {
 for(const width of [320,390,1280]) {
  const page=await browser.newPage({viewport:{width,height:844},reducedMotion:'reduce',hasTouch:width<1000});page.setDefaultTimeout(8000);
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))errors.push('Unexpected API request '+r.url());});
  const wait=async(fn:()=>Promise<boolean>,label:string)=>{for(let n=0;n<100;n++){if(await fn())return;await page.waitForTimeout(20);}throw Error(label);};
  await page.goto(`http://127.0.0.1:${server.port}/?session=s`);await page.getByRole('button',{name:'Lead context details: ≈55% · 148k / 258k',exact:true}).waitFor();
  await page.evaluate(()=>{document.querySelector('#conversation')!.scrollTop=240;});
  const snapshot=()=>page.evaluate(()=>{
   const boxes=Object.fromEntries(['.composer','#conversation','.task-card'].map(s=>{const r=document.querySelector(s)?.getBoundingClientRect();return[s,r?{x:r.x,y:r.y,width:r.width,height:r.height}:null];}));
   return{boxes,scroll:[scrollX,scrollY,document.querySelector('#conversation')!.scrollTop,document.querySelector('.fixture-cards')!.scrollTop],draft:(document.querySelector('textarea') as HTMLTextAreaElement).value};
  });
  const stable=(a:unknown,b:unknown,label:string)=>assert.deepEqual(b,a,`${width}: ${label}`);
  const panel=page.locator('.secondary-info-panel');
  const bounds=async()=>{const b=await panel.boundingBox();assert(b);assert(b.x>=7&&b.y>=7&&b.x+b.width<=width-7&&b.y+b.height<=837,'Panel stays inside viewport');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));};
  const close=async(trigger:ReturnType<typeof page.getByRole>)=>{await page.keyboard.press('Escape');await panel.waitFor({state:'detached'});assert(await trigger.evaluate(el=>el===document.activeElement),'Focus returns to trigger');};
  const lead=page.getByRole('button',{name:'Lead context details: ≈55% · 148k / 258k',exact:true}),mcp=page.locator('.app-header').getByRole('button',{name:'MCP servers',exact:true});
  await lead.scrollIntoViewIfNeeded();const baseline=await snapshot(),generation=await page.evaluate(()=>(window as any).fixture.generation());
  await page.screenshot({path:`${evidence}/${width}-before.png`,fullPage:true});
  if(width<1000)await lead.tap();else await lead.click();await panel.waitFor();await bounds();stable(baseline,await snapshot(),'context opens without displacement or scroll');
  assert((await panel.innerText()).includes('148,000'));assert((await panel.innerText()).includes('258,400'));assert((await panel.innerText()).includes('≈55%'));assert((await panel.innerText()).includes('12,000-token baseline'));assert((await panel.innerText()).includes('Last observed'));assert(!(await panel.innerText()).includes('Unavailable'));
  await page.screenshot({path:`${evidence}/${width}-context-open.png`,fullPage:true});
  if(width<1000){assert.equal(await panel.getAttribute('aria-modal'),'true');for(let n=0;n<4;n++)await page.keyboard.press('Tab');assert(await panel.evaluate(el=>el.contains(document.activeElement)));await mcp.evaluate(el=>(el as HTMLElement).focus());assert(await panel.evaluate(el=>el.contains(document.activeElement)),'Mobile background is inert');await page.mouse.move(2,2);await page.mouse.wheel(0,240);await page.waitForTimeout(50);stable(baseline,await snapshot(),'modal backdrop cannot scroll the workspace');}
  await close(lead);stable(baseline,await snapshot(),'context closes without displacement or scroll');await page.screenshot({path:`${evidence}/${width}-after-context-close.png`,fullPage:true});assert.equal(await page.evaluate(()=>(window as any).fixture.generation()),generation,'Opening/Back does not resolve the session again');
  await mcp.click();await panel.waitFor();await bounds();const content=await panel.innerText();for(const s of ['Lead · codex','investigate · opencode','Configured','Active','Unavailable','Conflicting','Connection unavailable','Reserved for Deck'])assert(content.includes(s),s);
  stable(baseline,await snapshot(),'long MCP groups do not push composer, conversation or cards');
  const body=panel.locator('.secondary-info-body');assert(await body.evaluate(el=>el.scrollHeight>el.clientHeight&&el.scrollWidth<=el.clientWidth));await page.screenshot({path:`${evidence}/${width}-mcp-open.png`,fullPage:true});await body.evaluate(el=>{el.scrollTop=400;});assert(await body.evaluate(el=>el.scrollTop>0));stable(baseline,await snapshot(),'internal scrolling stays internal');
  await page.screenshot({path:`${evidence}/${width}-mcp-scrolled.png`,fullPage:true});await close(mcp);await page.screenshot({path:`${evidence}/${width}-after-mcp-close.png`,fullPage:true});
  // Native browser Back/Forward closes/reopens only this presentation surface.
  const historyLength=await page.evaluate(()=>history.length);await lead.click();await panel.waitFor();await page.goBack();await panel.waitFor({state:'detached'});stable(baseline,await snapshot(),'Back preserves workspace');await page.goForward();await panel.waitFor();assert.equal(await page.evaluate(()=>history.length),historyLength);await close(lead);
  if(width===1280){await lead.click();await panel.waitFor();const length=await page.evaluate(()=>history.length);await mcp.click();await panel.waitFor();assert.equal(await panel.count(),1);assert((await panel.innerText()).includes('Availability'));assert.equal(await page.evaluate(()=>history.length),length);await close(mcp);}
  // Outside dismissal consumes the underlying action rather than cancelling work.
  await lead.click();await panel.waitFor();if(width===1280){const cancel=await page.locator('#lead-cancel').boundingBox();assert(cancel);await page.mouse.click(cancel.x+cancel.width/2,cancel.y+cancel.height/2);}else await page.touchscreen.tap(2,2);
  await panel.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>(window as any).fixture.cancels()),0);stable(baseline,await snapshot(),'outside dismissal is inert');
  await page.evaluate(()=>(window as any).fixture.setAvailable(false));const missing=page.getByRole('button',{name:'Lead context details: unavailable',exact:true});await missing.waitFor();const missingBefore=await snapshot();await missing.click();await panel.waitFor();stable(missingBefore,await snapshot(),'unavailable context does not displace controls');assert((await panel.innerText()).includes('Not reported yet'));assert(!(await panel.innerText()).includes('0 tokens'));await page.screenshot({path:`${evidence}/${width}-context-unavailable.png`,fullPage:true});await close(missing);stable(missingBefore,await snapshot(),'unavailable context closes without displacement');
  await page.evaluate(()=>(window as any).fixture.setAvailable(true));await lead.waitFor();
  // Actual hydrated summaries for every native basis and partial/legacy data.
  for(const [measurement,label,expected] of [
   [{basis:'claude-last-request-input',tokens:3868,capacity:1000000,modelId:'claude-haiku-5-5'},'≈0% · 3.87k / 1m','3,868'],
   [{basis:'opencode-assistant-context',tokens:215,capacity:1000,modelId:'p/m'},'≈22% · 215 / 1k','215'],
   [{basis:'codex-last-total',tokens:null,capacity:258400,modelId:'fixture-model'},'258k max','258,400'],
   [{basis:'codex-last-total',tokens:148000,capacity:null,modelId:'fixture-model'},'148k used','148,000'],
   [{basis:'claude-aggregate-input',tokens:99999,capacity:200000,modelId:'legacy'},'200k max','200,000'],
  ] as const){
   await page.evaluate(m=>(window as any).fixture.setMeasurement(m),measurement);
   const trigger=page.getByRole('button',{name:`Lead context details: ${label}`,exact:true});await trigger.waitFor();
   const before=await snapshot();await trigger.click();await panel.waitFor();await bounds();stable(before,await snapshot(),'native/partial summary opens without layout shift');
   assert((await panel.innerText()).includes(expected));
   if(!label.includes('%')){assert(!(await panel.innerText()).includes('%'));assert.equal(await panel.getByRole('progressbar').count(),0);}
   await close(trigger);stable(before,await snapshot(),'native/partial summary closes without layout shift');
  }
  await page.evaluate(()=>(window as any).fixture.setMeasurement({basis:'codex-last-total',tokens:148000,capacity:258400,modelId:`fixture-${'long-model-id-'.repeat(12)}`}));
  await lead.waitFor();await lead.click();await panel.waitFor();await bounds();assert(await panel.locator('.secondary-info-body').evaluate(el=>el.scrollWidth<=el.clientWidth));await close(lead);
  await page.evaluate(()=>(window as any).fixture.setMeasurement({basis:'codex-last-total',tokens:148000,capacity:258400,modelId:'fixture-model'}));await lead.waitFor();
  // Both the list and full detail use the identical mounted React surface.
  const cardContext=page.locator('.task-card').getByRole('button',{name:'Apply Deep context details: ≈55% · 148k / 258k',exact:true});await cardContext.scrollIntoViewIfNeeded();const cardsBefore=await snapshot();await cardContext.click();await panel.waitFor();await bounds();stable(cardsBefore,await snapshot(),'task list remains stationary');await close(cardContext);
  await page.getByRole('button',{name:'Open full view',exact:true}).click();const detailContext=page.locator('.detail-card').getByRole('button',{name:'Apply Deep context details: ≈55% · 148k / 258k',exact:true});await detailContext.waitFor();const detailBefore=await snapshot();await detailContext.click();await panel.waitFor();stable(detailBefore,await snapshot(),'task detail remains stationary');await close(detailContext);
  await detailContext.click();await panel.waitFor();await page.evaluate(()=>(window as any).fixture.setRemoved(true));await panel.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>(window as any).fixture.active()),undefined);await wait(async()=>await page.locator('#conversation').evaluate(el=>el===document.activeElement),'Removed task returns focus to conversation');
  await lead.click();await panel.waitFor();await page.evaluate(()=>(window as any).fixture.setOtherOpen(true));await panel.waitFor({state:'detached'});await page.getByRole('dialog',{name:'Existing dialog',exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Existing dialog',exact:true}).waitFor({state:'hidden'});
  await lead.click();await panel.waitFor();await page.evaluate(()=>(window as any).fixture.session());await panel.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>(window as any).fixture.active()),undefined);
  if(width===1280){await lead.click();await panel.waitFor();await page.setViewportSize({width:390,height:844});await wait(async()=>await panel.getAttribute('aria-modal')==='true','Resize becomes a modal sheet');await page.keyboard.press('Escape');await panel.waitFor({state:'detached'});await page.setViewportSize({width:1280,height:844});}
  // A viewport-edge trigger must reposition instead of clipping or overflowing.
  const edge=page.locator('.fixture-edge').getByRole('button',{name:'MCP servers',exact:true});await edge.click();await panel.waitFor();await bounds();await close(edge);
  await page.screenshot({path:`${evidence}/${width}-after.png`,fullPage:true});assert.equal(errors.length,0,errors.join('\n'));
  checks.push({width,stableLayout:true,stableScroll:true,keyboard:true,outsideDismissal:true,focusReturn:true,backForward:true,exclusive:true,sessionAndTaskDismissal:true,existingDialog:true,viewportEdges:true,internalScroll:true});console.log(JSON.stringify(checks.at(-1)));await page.close();
 }
 writeFileSync(`${evidence}/checks.json`,JSON.stringify({checks,errors},null,2));
}catch(e){writeFileSync(`${evidence}/failure.txt`,String(e)+'\n'+errors.join('\n'));throw e;}
finally{await browser.close();await server.stop(true);}
