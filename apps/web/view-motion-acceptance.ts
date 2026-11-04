/** Protects immediate semantics, preserved state, interruptible motion and unmount cleanup.
 * Oracle: approved motion brief; fails if a closing disclosure vanishes immediately,
 * hidden controls remain focusable, reversal snaps, state resets or detached nodes keep tweening.
 * New interaction coverage, baseline: existing views switched without scoped animation.
 */
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from '@playwright/test';
import fixture from './acceptance/view-motion.html';
const server=Bun.serve({hostname:'127.0.0.1',port:0,routes:{'/*':fixture},development:{hmr:false,console:false}});
const browser=await chromium.launch({executablePath:process.env.DECK_TEST_CHROME??'/snap/bin/chromium',headless:true});
mkdirSync('/tmp/deck-motion-frames',{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}); const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.port}`);await page.locator('.moving-active-indicator').first().waitFor({state:'attached'});
 // Interrupt a newly visible ancestor with a tab change before its entrance settles.
 await page.getByRole('button',{name:'chat',exact:true}).click();await page.waitForTimeout(420);
 await page.getByRole('button',{name:'both',exact:true}).click();
 await page.getByRole('tab',{name:'Subagents',exact:true}).click();await page.waitForTimeout(450);
 const ancestor=await page.locator('.workspace-pane').evaluate(e=>({opacity:Number(getComputedStyle(e).opacity),transform:getComputedStyle(e).transform}));
 assert.equal(ancestor.opacity,1,`Interrupted ancestor must settle: ${JSON.stringify(ancestor)}`);
 await page.getByRole('tab',{name:'Activity',exact:true}).click();await page.waitForTimeout(420);
 if(process.env.DECK_VIEW_ONLY==='1'){
  await page.getByRole('button',{name:'chat',exact:true}).click();await page.waitForTimeout(420);
  await page.getByRole('button',{name:'both',exact:true}).click();await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.workspace-pane')!).opacity==='1',null,{timeout:1000});
  await page.getByRole('tab',{name:'Activity',exact:true}).focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab',{name:'Subagents',exact:true}).getAttribute('aria-selected'),'true');
  console.log('PASS interrupted ancestor, live reduced motion, immediate keyboard');process.exitCode=0;
 } else {
 await page.locator('textarea').fill('draft retained');
 await page.locator('.workspace-panel:not([hidden])').evaluate(e=>e.scrollTop=100);
 assert.equal(await page.locator('.workspace-panel:not([hidden])').evaluate(e=>e.scrollTop),100,'Fixture must actually overflow');
 await page.getByRole('button',{name:'Usage',exact:true}).click();await page.waitForTimeout(100);
 const opening=await page.locator('.usage-body').evaluate(e=>({h:e.getBoundingClientRect().height,hidden:(e as HTMLElement).hidden,inert:(e as HTMLElement).inert}));assert(!opening.hidden&&!opening.inert&&opening.h>0);
 await page.screenshot({path:'/tmp/deck-motion-frames/usage-opening.png'});
 await page.waitForTimeout(400);const full=await page.locator('.usage-body').evaluate(e=>e.getBoundingClientRect().height);
 assert(opening.h<full-1, `Opening must animate from collapsed height: ${opening.h} < ${full}`);
 await page.getByRole('button',{name:'Usage',exact:true}).click();await page.waitForTimeout(60);
 const closing=await page.locator('.usage-body').evaluate(e=>({h:e.getBoundingClientRect().height,hidden:(e as HTMLElement).hidden,inert:(e as HTMLElement).inert}));assert(closing.inert&&!closing.hidden&&closing.h>0&&closing.h<full);
 await page.getByRole('button',{name:'Usage',exact:true}).click();await page.waitForTimeout(420);assert.equal(await page.locator('.usage-body').evaluate(e=>e.getBoundingClientRect().height),full);
 // Reverse an opening before it settles, then reopen a closing disclosure.
 await page.getByRole('button',{name:'Usage',exact:true}).click();await page.waitForTimeout(420);
 await page.getByRole('button',{name:'Usage',exact:true}).click();await page.waitForTimeout(35);
 const early=await page.locator('.usage-body').evaluate(e=>e.getBoundingClientRect().height);assert(early>0&&early<full);
 await page.getByRole('button',{name:'Usage',exact:true}).click();await page.waitForTimeout(35);
 const reversed=await page.locator('.usage-body').evaluate(e=>e.getBoundingClientRect().height);assert(reversed<early);
 await page.getByRole('button',{name:'Usage',exact:true}).click();await page.waitForTimeout(420);
 assert.equal(await page.locator('.usage-body').evaluate(e=>e.getBoundingClientRect().height),full);
 const indicator=page.locator('.workspace-tabs .moving-active-indicator');const first=await indicator.evaluate(e=>e.getBoundingClientRect().x);
 await page.getByRole('tab',{name:'Subagents',exact:true}).click();await page.waitForTimeout(70);const mid=await indicator.evaluate(e=>e.getBoundingClientRect().x);assert(mid>first);
 await page.screenshot({path:'/tmp/deck-motion-frames/tab-moving.png'});
 await page.getByRole('tab',{name:'Activity',exact:true}).click();await page.waitForTimeout(420);assert.equal(await page.locator('.workspace-panel:not([hidden])').evaluate(e=>e.scrollTop),100);assert(Math.abs((await indicator.evaluate(e=>e.getBoundingClientRect().x))-first)<1);
 await page.getByRole('button',{name:'workspace',exact:true}).click();assert.equal(await page.locator('textarea').inputValue(),'draft retained');assert(await page.locator('.chat-pane').evaluate(e=>(e as HTMLElement).hidden&&(e as HTMLElement).inert));
 assert(await page.locator('.chat-pane').evaluate(e=>e.hasAttribute('data-view-exiting')),'Closing view keeps only its noninteractive exit paint');
 await page.waitForTimeout(70);assert(await page.locator('.workspace-pane').evaluate(e=>Number(getComputedStyle(e).opacity)<1));await page.screenshot({path:'/tmp/deck-motion-frames/view-moving.png'});
 await page.getByRole('button',{name:'chat',exact:true}).click();await page.getByRole('button',{name:'both',exact:true}).click();await page.waitForTimeout(420);
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('tab',{name:'Subagents',exact:true}).click();assert.equal(await page.locator('.workspace-panel:not([hidden])').evaluate(e=>getComputedStyle(e).opacity),'1');
 await page.getByRole('button',{name:'Usage',exact:true}).click();assert(await page.locator('.usage-body').evaluate(e=>(e as HTMLElement).hidden));
 await page.emulateMedia({reducedMotion:'no-preference'});await page.getByRole('button',{name:'Usage',exact:true}).click();await page.getByRole('tab',{name:'Activity',exact:true}).click();
 const cleanup=await page.evaluate(async()=>{const f=(window as any).fixture,nodes=Array.from(document.querySelectorAll('.moving-active-indicator,.usage-body,.workspace-panel,.workspace-pane,.chat-pane'));f.dispose();await new Promise(r=>setTimeout(r,450));return nodes.every(n=>f.gsap.getTweensOf(n).length===0);});assert(cleanup);assert.deepEqual(errors,[]);
 console.log('PASS view/disclosure/indicator reversal, reduced motion, state, semantics and unmount');
 }
}finally{await browser.close();server.stop(true);}
