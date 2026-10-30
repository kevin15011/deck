/** Protects selection interruption, immediate reduced motion, scroll geometry and lifecycle cleanup.
 * Oracle: approved sidebar brief. Fails if retargeting jumps, reduced motion still moves,
 * or a disposed controller keeps painting/responding. New behavior; browser baseline had no moving plane.
 */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import fixture from './acceptance/selection-motion.html';
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, routes: {'/*': fixture}, development: {hmr:false,console:false} });
const browser = await chromium.launch({executablePath:process.env.DECK_TEST_CHROME ?? '/snap/bin/chromium',headless:true});
try {
    const page = await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'no-preference'});
    await page.goto(`http://127.0.0.1:${server.port}`);
    const plane = page.locator('.session-selection-plane path'); await plane.waitFor({state:'attached'});
    await page.waitForTimeout(60);
    await page.getByRole('button',{name:'More options for First',exact:true}).click();
    await page.getByRole('menuitem',{name:'Rename session',exact:true}).click({timeout:1200});
    assert.equal(await page.getByRole('menuitem',{name:'Rename session',exact:true}).count(),0);
    const start = await plane.getAttribute('d');
    await page.getByRole('button',{name:'Last',exact:true}).click();
    await page.waitForTimeout(90); const middle = await plane.getAttribute('d'); assert.notEqual(middle,start);
    const reversal = await page.evaluate(async () => {
        const f=(window as any).selectionFixture, path=document.querySelector('.session-selection-plane path')!;
        const before=path.getAttribute('d'); f.select('First'); await new Promise(requestAnimationFrame);
        return {before,after:path.getAttribute('d')};
    });
    // First frame may advance slightly; it must never reset to the original destination.
    assert.notEqual(reversal.after,start);
    const y=(path:string|null)=>Number(path!.split(',')[1]!.split('H')[0]);
    assert(Math.abs(y(reversal.after)-y(reversal.before))<20,'Reverse starts from live presentation');
    await page.waitForTimeout(420); assert.equal(await plane.getAttribute('d'),start);
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.getByRole('button',{name:'Last',exact:true}).click();
    const settled=await plane.getAttribute('d'); assert.notEqual(settled,start);
    await page.waitForTimeout(90); assert.equal(await plane.getAttribute('d'),settled);
    await page.evaluate(()=>(window as any).selectionFixture.collapse(true));
    await page.waitForFunction(()=>!document.querySelector('.session-selection-plane'));
    await page.evaluate(()=>(window as any).selectionFixture.collapse(false));
    await plane.waitFor({state:'attached'});
    await page.evaluate(()=>(window as any).selectionFixture.expand(false));
    await page.waitForFunction(()=>document.querySelector<SVGElement>('.session-selection-plane')!.style.visibility==='hidden');
    await page.evaluate(()=>(window as any).selectionFixture.expand(true));
    await page.waitForFunction(()=>document.querySelector<SVGElement>('.session-selection-plane')!.style.visibility==='visible');
    const scrolled=await page.evaluate(async()=>{
        const scroll=document.querySelector<HTMLElement>('.navigation-scroll')!;
        scroll.style.cssText='max-height:90px;flex:none'; scroll.scrollTop=40;
        await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
        const row=document.querySelector('.session.selected')!.closest('.session-row')!.getBoundingClientRect();
        const owner=document.querySelector('.sidebar')!.getBoundingClientRect();
        const path=document.querySelector('.session-selection-plane path')!.getAttribute('d')!;
        return {scrollTop:scroll.scrollTop,expected:row.top-owner.top,actual:Number(path.split(',')[1]!.split('H')[0])};
    });
    assert(scrolled.scrollTop>0); assert(Math.abs(scrolled.expected-scrolled.actual)<1,'Plane tracks scroll geometry');
    await page.emulateMedia({reducedMotion:'no-preference'});
    // Exercise the production controller's disposal during an active tween. Observe actual writes,
    // including stale ResizeObserver/media/scroll callbacks, rather than private tween bookkeeping.
    const cleanup=await page.evaluate(async()=>{
        const f=(window as any).selectionFixture, root=document.querySelector('.project-navigation') as HTMLElement;
        const oldSvg=document.querySelector('.session-selection-plane')!, oldPath=oldSvg.firstElementChild!;
        let oldWrites=0; const oldSet=oldPath.setAttribute.bind(oldPath);
        oldPath.setAttribute=(...args:[string,string])=>{oldWrites++;oldSet(...args);};
        f.select('First'); await new Promise(requestAnimationFrame); f.dispose(); const oldAtDispose=oldWrites;
        const owner=document.createElement('nav'); owner.className='sidebar'; owner.style.cssText='width:224px;height:300px';
        owner.append(root); document.body.append(owner);
        const controller=f.createSelectionMotion(root), svg=owner.querySelector('.session-selection-plane')!, path=svg.firstElementChild!;
        let writes=0; const original=path.setAttribute.bind(path); path.setAttribute=(...args:[string,string])=>{writes++;original(...args);};
        root.querySelector('.selected')?.classList.remove('selected'); root.querySelectorAll('.session')[2]!.classList.add('selected');
        controller.update(); await new Promise(resolve=>setTimeout(resolve,45)); controller.dispose(); const atDispose=writes;
        root.querySelector('.navigation-scroll')!.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('resize'));
        await new Promise(resolve=>setTimeout(resolve,450)); owner.remove();
        return {atDispose,writes,removed:!svg.isConnected,oldAtDispose,oldWrites,oldRemoved:!oldSvg.isConnected};
    });
    assert(cleanup.atDispose>0,'Disposal exercised during a moving selection');
    assert.equal(cleanup.writes,cleanup.atDispose); assert(cleanup.removed);
    assert.equal(cleanup.oldWrites,cleanup.oldAtDispose); assert(cleanup.oldRemoved);
    console.log(JSON.stringify({ok:true,cleanup}));
} finally {await browser.close();server.stop(true);}
