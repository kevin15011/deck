/** Production-hook browser regression: bun run apps/web/drawer-motion-acceptance.ts */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
const started = performance.now();
const entry = join(import.meta.dir, `.drawer-fixture-${process.pid}.tsx`);
writeFileSync(entry, `import React,{useRef} from 'react';
import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {gsap} from './src/motion';import {useDrawerMotion} from './src/drawer-motion';
const root=createRoot(document.getElementById('root')!);
function Drawer({open}){const ref=useRef(null);useDrawerMotion(ref,open);return <dialog ref={ref}><button>Inside</button></dialog>}
window.renderDrawer=(open)=>flushSync(()=>root.render(<Drawer open={open}/>));
window.disposeDrawer=()=>flushSync(()=>root.render(null));
window.activeDrawerTweens=()=>gsap.getTweensOf(document.querySelector('dialog')??window.oldDrawer).filter(t=>t.isActive()).length;
gsap.globalTimeline.timeScale(.1);window.renderDrawer(false);`);
let browser; let server;
try {
 const build=await Bun.build({entrypoints:[entry],target:'browser'});assert(build.success,JSON.stringify(build.logs));
 const js=await build.outputs[0]!.text();
 server=Bun.serve({port:0,fetch:r=>new URL(r.url).pathname==='/fixture.js'?new Response(js,{headers:{'Content-Type':'text/javascript'}}):new Response('<button id="trigger">Open</button><div id="root"></div><script type="module" src="/fixture.js"></script>',{headers:{'Content-Type':'text/html'}})});
 browser=await chromium.launch({executablePath:process.env.DECK_TEST_CHROME??'/snap/bin/chromium',headless:true});
 const page=await browser.newPage();await page.goto(server.url.href);await page.waitForFunction(()=>!!(window as any).renderDrawer);
 const render=async(open:boolean)=>{await page.evaluate(o=>(window as any).renderDrawer(o),open);await page.waitForTimeout(30)};
 const state=()=>page.evaluate(()=>{const d=document.querySelector('dialog')!;return {open:d.open,transform:d.style.transform,active:(window as any).activeDrawerTweens(),focused:document.activeElement?.id,inside:d.contains(document.activeElement)}});
 const reduce=async()=>{await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(60)};
 await page.locator('#trigger').focus();await render(true);assert((await state()).active>0);
 await reduce();assert.deepEqual(await state(),{open:true,transform:'',active:0,focused:'',inside:true});
 await page.emulateMedia({reducedMotion:'no-preference'});await render(false);assert((await state()).active>0);
 await reduce();assert.deepEqual(await state(),{open:false,transform:'',active:0,focused:'trigger',inside:false});
 // Exit reversal must settle the latest open intent, never a captured stale close.
 await page.emulateMedia({reducedMotion:'no-preference'});await render(true);await render(false);await render(true);await reduce();
 assert.equal((await state()).open,true);assert.equal((await state()).active,0);await page.waitForTimeout(2000);assert.equal((await state()).open,true);
 await render(false);assert.equal((await state()).open,false);
 // Initial reduced motion and cleanup during an active exit.
 await render(true);assert.equal((await state()).active,0);assert.equal((await state()).transform,'');
 await page.emulateMedia({reducedMotion:'no-preference'});await render(false);
 await page.evaluate(()=>{(window as any).oldDrawer=document.querySelector('dialog');(window as any).disposeDrawer()});await reduce();
 assert.equal(await page.evaluate(()=>{const d=(window as any).oldDrawer;return (window as any).activeDrawerTweens?.()??0}),0);
 await render(true);assert.equal((await state()).open,true);await page.waitForTimeout(2000);assert.equal((await state()).open,true);
 console.log(JSON.stringify({ok:true,durationMs:Math.round(performance.now()-started),checks:['live entrance','live exit/native focus','reversal','initial reduced motion','unmount/remount']}));
} finally {await browser?.close();server?.stop(true);unlinkSync(entry)}
