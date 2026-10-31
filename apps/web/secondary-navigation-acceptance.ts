/** Focused real-history P011 regressions; source fixture, no services/providers. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '@playwright/test';
import fixture from './acceptance/secondary-info.html';
const evidence='/tmp/deck-p011-p2-browser';mkdirSync(evidence,{recursive:true});
const server=Bun.serve({hostname:'127.0.0.1',port:0,routes:{'/*':fixture},development:{hmr:false,console:false}});
const browser=await chromium.launch({headless:true,executablePath:process.env.DECK_TEST_CHROME??join(homedir(),'.cache/ms-playwright/chromium-1237/chrome-linux64/chrome'),args:['--no-sandbox']});
const checks:unknown[]=[],errors:string[]=[];
try {
 for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:844},hasTouch:width<1000,reducedMotion:'reduce'});page.setDefaultTimeout(5000);
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))errors.push('Unexpected API request');});
  const ready=()=>page.waitForFunction(()=>!!(window as any).fixture);
  const state=()=>page.evaluate(()=>(window as any).fixture.state());
  const session=async(value:string)=>{await page.waitForFunction(s=>(window as any).fixture.state().session===s,value);};
  const fresh=async()=>{await page.goto(`http://127.0.0.1:${server.port}/?session=prior`);await ready();await page.evaluate(()=>(window as any).fixture.navigate('s'));await session('s');};
  const panel=page.locator('.secondary-info-panel');
  const lead=page.getByRole('button',{name:'Lead context details: ≈55% · 148k / 258k',exact:true});
  console.log(width,'session navigation');await fresh();await lead.click();await panel.waitFor();await page.evaluate(()=>(window as any).fixture.navigate('other'));await session('other');await panel.waitFor({state:'detached'});
  await page.goBack();await session('s');const generation=(await state()).generation;
  await page.goBack();await session('prior');assert.equal((await state()).generation,generation+1,'Second Back leaves s, rather than visiting an inert duplicate');
  await page.goForward();await session('s');await page.goForward();await session('other');assert.equal((await state()).secondary,undefined);
  console.log(width,'normal Back/Forward and reload');await fresh();const before=(await state()).generation;await lead.click();await panel.waitFor();await page.goBack();await panel.waitFor({state:'detached'});assert.equal((await state()).generation,before);await page.goForward();await panel.waitFor();assert.equal((await state()).generation,before);
  await page.reload();await ready();await panel.waitFor();await page.goBack();await panel.waitFor({state:'detached'});assert.equal((await state()).generation,0,'Reloaded secondary dismissal is presentation only');
  console.log(width,'task dismissal');await fresh();const card=page.locator('.task-card').getByRole('button',{name:/Apply Deep context details:/});await card.click();await panel.waitFor();const taskGeneration=(await state()).generation;
  await page.evaluate(()=>(window as any).fixture.setRemoved(true));await panel.waitFor({state:'detached'});await page.waitForFunction(()=>!history.state?.deckSecondary);assert.equal((await state()).generation,taskGeneration);
  await page.goBack();await session('prior');await page.goForward();await session('s');const forwardGeneration=(await state()).generation;
  await page.goForward();await page.waitForFunction(()=>!history.state?.deckSecondary);assert.equal((await state()).generation,forwardGeneration);assert.equal((await state()).secondary,undefined);
  console.log(width,'racing navigation');await fresh();await lead.click();await panel.waitFor();await page.evaluate(()=>(window as any).fixture.race());await session('latest');await page.goBack();await session('s');await page.goBack();await session('prior');
  console.log(width,'replace navigation');await fresh();await lead.click();await panel.waitFor();await page.evaluate(()=>(window as any).fixture.navigate('other','replace'));await session('other');await page.goBack();await session('prior');await page.goForward();await session('other');const replacedGeneration=(await state()).generation;
  await page.goForward();await page.waitForFunction(()=>!history.state?.deckSecondary);assert.equal((await state()).session,'other');assert.equal((await state()).generation,replacedGeneration);
  await fresh();await lead.click();await panel.waitFor();const url=page.url();await page.evaluate(()=>{history.replaceState({foreign:true},'',location.href);(window as any).fixture.setOtherOpen(true);});await panel.waitFor({state:'detached'});assert.equal(page.url(),url);assert.equal(await page.evaluate(()=>history.state.foreign),true);
  await page.screenshot({path:`${evidence}/${width}-navigation.png`,fullPage:true});checks.push({width,sessionBackWithoutDuplicate:true,normalBackForward:true,reload:true,taskDismissal:true,dismissedForwardSkipped:true,fastNavigation:true,replace:true,foreignBoundary:true});await page.close();
 }
 assert.equal(errors.length,0,errors.join('\n'));writeFileSync(`${evidence}/checks.json`,JSON.stringify({checks,errors},null,2));console.log(JSON.stringify(checks));
}catch(error){writeFileSync(`${evidence}/failure.txt`,String(error)+'\n'+errors.join('\n'));throw error;}
finally{await browser.close();await server.stop(true);}
