/** Protects visible sidebar content after real pointer/keyboard reorders.
 * Oracle: reported disappearance regression; rendered text must retain ink pixels.
 * Hit testing alone cannot detect a pointer-transparent SVG covering the row.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';
import fixture from './acceptance/selection-motion.html';
const server=Bun.serve({hostname:'127.0.0.1',port:0,routes:{'/*':fixture},development:{hmr:false,console:false}});
const browser=await chromium.launch({executablePath:'/snap/bin/chromium',headless:true});
const phase=process.env.DECK_REORDER_PHASE ?? 'green', out=`/tmp/deck-reorder-${phase}`;
await mkdir(out,{recursive:true});
const results:unknown[]=[];
async function paint(page:Page,name:string){
    const label=page.locator('.session.selected strong');
    const png=await label.screenshot();
    const ink=await page.evaluate(async data=>{
        const image=new Image(); image.src=`data:image/png;base64,${data}`; await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
        const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);
        const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]!>150&&pixels[i+1]!>150&&pixels[i+2]!>150)count++;
        return count;
    },png.toString('base64'));
    await page.screenshot({path:`${out}/${name}.png`});
    const transforms=await page.locator('.session-row').evaluateAll(rows=>rows.map(r=>({id:r.getAttribute('data-session-id'),transform:getComputedStyle(r).transform})));
    results.push({name,ink,transforms});console.log(JSON.stringify(results.at(-1)));
    assert(ink>35,`${name}: selected label must paint visible ink, got ${ink}`);
    await page.getByRole('button',{name:`More options for ${await label.textContent()}`,exact:true}).click();
    await page.getByRole('menuitem',{name:'Rename session',exact:true}).waitFor({state:'visible'});
    await page.keyboard.press('Escape');
}
async function drag(page:Page,from:string,to:string,cancel=false){
    const a=await page.getByRole('button',{name:`Reorder session ${from}`,exact:true}).boundingBox();
    const b=await page.getByRole('button',{name:`Reorder session ${to}`,exact:true}).boundingBox();
    assert(a&&b);await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
    await page.mouse.move(a.x+a.width/2,b.y+b.height/2,{steps:12});await page.waitForTimeout(100);
    if(cancel)await page.keyboard.press('Escape');await page.mouse.up();await page.waitForTimeout(500);
}
try{
 for(const width of [1440,390])for(const reducedMotion of ['no-preference','reduce'] as const){
    const page=await browser.newPage({viewport:{width,height:900},reducedMotion});
    await page.goto(`http://127.0.0.1:${server.port}`);await page.locator('.session-selection-plane').waitFor({state:'attached'});await page.waitForTimeout(100);
    const prefix=`${width}-${reducedMotion}`;
    await paint(page,`${prefix}-initial`);
    await drag(page,'First','Last');
    assert.deepEqual(await page.locator('.session-row').evaluateAll(rows=>rows.map(r=>r.getAttribute('data-session-id'))),['Middle','Last','First']);
    await paint(page,`${prefix}-selected-drop`);
    await drag(page,'Middle','First');await paint(page,`${prefix}-nonselected-drop`);
    const order=await page.locator('.session-row').evaluateAll(rows=>rows.map(r=>r.getAttribute('data-session-id')));
    await drag(page,'First','Last',true);assert.deepEqual(await page.locator('.session-row').evaluateAll(rows=>rows.map(r=>r.getAttribute('data-session-id'))),order);
    await paint(page,`${prefix}-cancel`);
    const grip=page.getByRole('button',{name:'Reorder session First',exact:true});await grip.focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowUp');await page.keyboard.press('Space');
    await page.getByRole('button',{name:'Last',exact:true}).click();await page.getByRole('button',{name:'First',exact:true}).click();await page.waitForTimeout(500);
    await paint(page,`${prefix}-keyboard-rapid-select`);await page.close();
 }
}finally{await Bun.write(`${out}/results.json`,JSON.stringify(results,null,2));await browser.close();server.stop(true);}
