/** Protects lifecycle and session changes from older API replies, even if abort is ignored. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mutant = process.env.INBOX_RACE_MUTANT === '1';
const build = await Bun.build({entrypoints:['./apps/web/src/prompt-inbox-race-harness.tsx'], target:'browser', plugins: mutant ? [{name:'disable-stale-guards',setup(builder){
 builder.onLoad({filter:/prompt-queue\.tsx$/}, async ({path}) => ({contents:(await readFile(path,'utf8')).replaceAll('!controller.signal.aborted&&version===request.current','true'),loader:'tsx'}));
}}] : []});
if (!build.success) throw new Error(String(build.logs));
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();
 await page.setContent('<div id="root"></div>');
 await page.addScriptTag({content:await build.outputs[0]!.text()});
 const count=async (n:number)=>page.waitForFunction(n=>(window as any).requestCount?.()===n,n);
 const change=async (id:string,kind:string,seq:number)=>page.evaluate(({id,kind,seq})=>(window as any).change(id,[{v:1,sessionId:id,seq,kind,data:{},source:{},ts:'2026-01-01T00:00:00Z'}]),{id,kind,seq});
 const resolve=async(index:number,text:string,seq:number)=>page.evaluate(({index,text,seq})=>(window as any).resolveRequest(index,{seq,paused:false,queued:[{promptId:text,text}]}),{index,text,seq});
 const expectText=async(text:string)=>page.waitForFunction(text=>JSON.parse(document.querySelector('output')!.textContent!).queued[0]?.text===text,text);
 await count(1);
 await change('first','session.reopened',2); await count(2);
 await resolve(1,'new same session',2); await expectText('new same session');
 await resolve(0,'old same session',1);
 await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
 if (process.env.INBOX_RACE_CASE !== 'switch') assert.equal(await page.locator('output').textContent().then(s=>JSON.parse(s!).queued[0]?.text),'new same session','older lifecycle response must not overwrite newer response');
 await change('first','session.released',3); await count(3);
 await change('second','session.reopened',4); await count(4);
 await resolve(3,'new session',4); await expectText('new session');
 await resolve(2,'old session',3);
 await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
 assert.equal(await page.locator('output').textContent().then(s=>JSON.parse(s!).queued[0]?.text),'new session','previous session response must not overwrite current session');
 console.log('PASS: same-session lifecycle and session-switch stale replies ignored');
} finally { await browser.close(); }
