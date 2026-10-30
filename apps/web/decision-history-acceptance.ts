/** Focused hydrated source check; no daemon or generated assets. */
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import fixture from './acceptance/decision-history.html';
const server=Bun.serve({hostname:'127.0.0.1',port:0,routes:{'/*':fixture},development:{hmr:false,console:false}});
const browser=await chromium.launch({headless:true,executablePath:process.env.DECK_TEST_CHROME,args:['--no-sandbox']});
try{
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:844}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.port}`);
  const prompt=page.getByRole('textbox',{name:'Message'}),history=page.getByRole('button',{name:'Decision history',exact:true}),panel=page.getByRole('dialog',{name:'Decision history',exact:true});
  await history.waitFor();assert.equal(await page.locator('main .decisions-panel').count(),0);
  const before=await prompt.boundingBox();await history.focus();await page.keyboard.press('Enter');await panel.waitFor();assert.deepEqual(await prompt.boundingBox(),before);
  assert(await panel.getByRole('link',{name:/View origin/}).isVisible());await panel.getByRole('link',{name:/View origin/}).click();assert(await page.getByRole('status').isVisible());
  await page.keyboard.press('Escape');await panel.waitFor({state:'detached'});assert(await history.evaluate(el=>el===document.activeElement));assert.equal(await prompt.inputValue(),'Draft');
  await history.click();await panel.waitFor();await page.getByRole('button',{name:'Switch session'}).evaluate(el=>(el as HTMLButtonElement).click());await panel.waitFor({state:'detached'});assert.equal(await history.count(),0);
  await page.getByRole('button',{name:'Switch session'}).click();await history.waitFor();assert.equal(await panel.count(),0);
  await page.getByRole('button',{name:'Ask question'}).click();await history.click();await panel.waitFor();console.log(JSON.stringify({width,historyHeading:await panel.locator('.decisions-toggle').innerText(),historyRows:await panel.locator('.decision-row').count()}));await page.screenshot({path:`/tmp/deck-history-mixed-${width}.png`});await page.keyboard.press('Escape');await page.getByRole('button',{name:'Decisions: 1 open'}).click();await page.getByRole('button',{name:'Defer Choose scope',exact:true}).click();await page.getByRole('button',{name:'Reopen Choose scope',exact:true}).click();await page.getByRole('button',{name:'Reply to Choose scope',exact:true}).click();assert(await prompt.evaluate(el=>el===document.activeElement));assert(await page.getByRole('button',{name:'Clear reply target'}).isVisible());await page.getByRole('button',{name:'Clear reply target'}).click();
  await page.getByRole('button',{name:'Cancel decision: Choose scope',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await page.locator('main .decisions-panel').count(),0);assert(await prompt.evaluate(el=>el===document.activeElement));await page.getByRole('button',{name:'Search long history'}).click();
  const origin=page.getByRole('article',{name:'Decision origin'}),resume=origin.getByRole('button',{name:'Continue searching history'});
  await resume.waitFor();await page.screenshot({path:`/tmp/deck-origin-paused-${width}.png`});
  await resume.focus();await page.keyboard.press('Enter');await origin.getByText('Exact original report',{exact:true}).waitFor();
  assert(await origin.evaluate(el=>el===document.activeElement));assert.equal(await prompt.inputValue(),'Draft');
  await page.screenshot({path:`/tmp/deck-origin-resumed-${width}.png`});
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: history access, keyboard/focus, session switch, draft/layout, pending/deferred/selection actions (390/1280px)');
}finally{await browser.close();server.stop(true);}
