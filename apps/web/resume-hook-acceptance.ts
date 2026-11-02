import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const baseline = process.env.DECK_TEST_BASELINE_CHAT;
const old = baseline ? Bun.spawnSync(['git', 'show', 'HEAD:apps/web/src/chat-history.ts']).stdout.toString() : '';
const entry = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useChatHistory} from './chat-history';
const w = window as any;
w.requests=[]; w.sockets=[]; w.errors=[]; w.events=[]; w.hidden=false;
Object.defineProperty(document, 'visibilityState', {get:()=>w.hidden?'hidden':'visible'});
class FakeSocket {
 static OPEN=1; static CONNECTING=0; readyState=0; onopen:any; onclose:any; onmessage:any; onerror:any;
 constructor(public url:string){w.sockets.push(this)}
 open(){this.readyState=1;this.onopen?.({})} close(){this.readyState=3}
}
w.WebSocket=FakeSocket;
const api = (_url:string, options:any) => new Promise(resolve=>w.requests.push({resolve,signal:options.signal}));
function App(){
 const [id,setId]=useState('a'); const [mounted,setMounted]=useState(true); const [draft,setDraft]=useState('draft');
 w.setId=setId;w.unmount=()=>setMounted(false);
 return <><input id="draft" value={draft} onChange={e=>setDraft(e.target.value)}/>{mounted&&<Session id={id}/>}</>;
}
function Session({id}:{id:string}){
 const h=useChatHistory({api,sessionId:id,enabled:true,revision:0,onEvent:e=>w.events.push(e),beforeChange:()=>{},isFollowing:()=>false,onHydrated:()=>{},onView:()=>{},onConnection:s=>w.connection=s,onError:s=>w.errors.push(s)});
 w.chatHistory=h;
 return <div id="rows" style={{height:160,overflow:'auto'}}>{h.messages.map(m=><div data-row={m.historyId} style={{height:32}} key={m.historyId}>{m.historyId}</div>)}</div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
`;
const dir = mkdtempSync(join(import.meta.dir, 'src/.resume-fixture-'));
const fixture = join(dir, 'entry.tsx');
writeFileSync(fixture, entry.replace("'./chat-history'", "'../chat-history'"));
const build = await Bun.build({entrypoints:[fixture], target:'browser', plugins:[{name:'fixture',setup(b){if(baseline)b.onLoad({filter:/\/apps\/web\/src\/chat-history\.ts$/},()=>({contents:old,loader:'ts'}));}}]}).finally(() => rmSync(dir, {recursive:true, force:true}));
if(!build.success) throw new Error(JSON.stringify(build.logs));
const js=await build.outputs[0]!.text();
const server=Bun.serve({port:0,fetch(req){return new URL(req.url).pathname==='/app.js'?new Response(js,{headers:{'content-type':'text/javascript'}}):new Response('<div id="root"></div><script type="module" src="/app.js"></script>',{headers:{'content-type':'text/html'}})}});
const browser=await chromium.launch({executablePath:process.env.DECK_TEST_CHROME??'/snap/bin/chromium',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage(); page.setDefaultTimeout(3000);
 await page.goto(`http://localhost:${server.port}`);
 await page.waitForFunction(()=> (window as any).requests?.length===1);
 await page.evaluate(()=>{const w=window as any;w.requests[0].resolve({seq:1,events:[],messages:Array.from({length:40},(_,i)=>({historyId:i+1,seq:1}))});});
 await page.waitForFunction(()=> (window as any).sockets.length===1);
 await page.evaluate(()=> (window as any).sockets[0].open());
 await page.locator('#draft').fill('unfinished');
 await page.locator('#rows').evaluate(el=>{el.scrollTop=333});
 const anchor = () => page.locator('#rows').evaluate(el=>{const rect=el.getBoundingClientRect();const row=[...el.children].find(child=>child.getBoundingClientRect().bottom>rect.top)!;return {scrollTop:el.scrollTop,row:row.getAttribute('data-row'),offset:row.getBoundingClientRect().top-rect.top}});
 const before = await anchor();
 assert.ok(before.scrollTop > 0);
 await page.evaluate(()=>{const w=window as any;w.hidden=true;document.dispatchEvent(new Event('visibilitychange'));w.hidden=false;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('online'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
 await page.waitForFunction(()=> (window as any).requests.length===2);
 await page.evaluate(()=>{const w=window as any;w.sockets[0].onmessage?.({data:JSON.stringify({type:'event',event:{sessionId:'a',seq:2}})});w.sockets[0].onclose?.()});
 assert.deepEqual(await page.evaluate(()=> (window as any).events),[]);
 await page.evaluate(()=>{const w=window as any;w.requests[1].resolve({seq:2,events:[],messages:[{historyId:1,seq:2}]});});
 await page.waitForFunction(()=> (window as any).requests.length===3);
 await page.evaluate(()=> (window as any).requests[2].resolve({seq:2,events:[],messages:[{historyId:1,seq:2}]}));
 await page.waitForFunction(()=> (window as any).sockets.length===2);
 assert.equal(await page.locator('#draft').inputValue(),'unfinished');
 assert.deepEqual(await anchor(),before);
 assert.equal(await page.locator('#rows > div').count(),40);
 assert.deepEqual(await page.evaluate(()=>[(window as any).requests.length,(window as any).sockets.length]),[3,2]);
 await page.evaluate(()=>{const w=window as any;w.sockets[1].open();w.setId('b')});
 await page.waitForFunction(()=> (window as any).requests.length===4);
 await page.evaluate(()=>{const w=window as any;w.sockets[1].onclose?.();w.requests[3].resolve({seq:0,events:[],messages:[]})});
 await page.waitForFunction(()=> (window as any).sockets.length===3);
 await page.evaluate(()=> (window as any).unmount());
 await page.evaluate(()=>{const w=window as any;w.sockets[2].onclose?.();w.sockets[2].onmessage?.({data:JSON.stringify({type:'event',event:{sessionId:'b',seq:10}})});window.dispatchEvent(new Event('online'))});
 await page.waitForTimeout(50);
 assert.deepEqual(await page.evaluate(()=>[(window as any).requests.length,(window as any).sockets.length]),[4,3]);
 assert.equal(await page.locator('#draft').inputValue(),'unfinished');
 // An in-flight hydration is aborted and its late response cannot create a socket.
 await page.reload();
 await page.waitForFunction(()=> (window as any).requests?.length===1);
 await page.evaluate(()=>{const w=window as any;w.hidden=true;document.dispatchEvent(new Event('visibilitychange'));w.hidden=false;document.dispatchEvent(new Event('visibilitychange'));w.requests[0].resolve({seq:99,events:[],messages:[]})});
 await page.waitForFunction(()=> (window as any).requests.length===2);
 assert.equal(await page.evaluate(()=> (window as any).requests[0].signal.aborted),true);
 assert.equal(await page.evaluate(()=> (window as any).sockets.length),0);
 await page.evaluate(()=> (window as any).requests[1].resolve({seq:1,events:[],messages:[]}));
 await page.waitForFunction(()=> (window as any).sockets.length===1);
 // CONNECTING sockets also require replacement after a persisted restore.
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
 // The pageshow above belongs to the same resume and is coalesced; a new pagehide starts a new cycle.
 await page.evaluate(()=>{const w=window as any;window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));w.sockets[0].onmessage?.({data:JSON.stringify({type:'event',event:{sessionId:'a',seq:2}})});w.sockets[0].onclose?.()});
 assert.deepEqual(await page.evaluate(()=> (window as any).events),[]);
 await page.waitForFunction(()=> (window as any).requests.length===3);
 assert.equal(await page.evaluate(()=> (window as any).sockets[0].readyState),3);
 await page.evaluate(()=> (window as any).requests[2].resolve({seq:2,events:[],messages:[]}));
 await page.waitForFunction(()=> (window as any).sockets.length===2);
 await page.evaluate(()=>{const w=window as any;w.sockets[1].open();window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'))});
 await page.waitForTimeout(50);
 assert.equal(await page.evaluate(()=> (window as any).requests.length),3);
 console.log('existing lifecycle scenarios passed');
 // Resolve an obsolete page before the deferred reconnect gets a chance to run.
 await page.reload();
 await page.waitForFunction(()=> (window as any).requests?.length===1);
 await page.evaluate(()=> (window as any).requests[0].resolve({seq:1,events:[],messages:[{historyId:1,seq:1}],before:1,after:1}));
 await page.waitForFunction(()=> (window as any).sockets.length===1);
 await page.evaluate(()=> (window as any).sockets[0].open());
 await page.evaluate(async()=>{const w=window as any;w.chatHistory.around(99);w.chatHistory.latest();w.hidden=true;document.dispatchEvent(new Event('visibilitychange'));w.hidden=false;document.dispatchEvent(new Event('visibilitychange'));w.raceAborted=w.requests[1].signal.aborted;w.requests[1].resolve({seq:2,events:[],messages:[{historyId:99,seq:2}],before:99,after:99});await Promise.resolve();await Promise.resolve();});
 assert.equal(await page.evaluate(()=> (window as any).raceAborted),true);
 await page.waitForFunction(()=> (window as any).requests.length>=3);
 assert.deepEqual(await page.evaluate(()=>{const w=window as any;return {ids:w.chatHistory.messages.map((m:any)=>m.historyId),before:w.chatHistory.before,after:w.chatHistory.after,loading:w.chatHistory.loading,requests:w.requests.length}}),{ids:[1],before:1,after:1,loading:false,requests:3});
 console.log('resume hook acceptance passed');
} finally {await browser.close();server.stop(true)}
