/** Production-composition acceptance with isolated EventLog/WebService and fake inference.
 * Protects live-only entrances, identity reconciliation, focus/scroll and disposal.
 * DECK_TEST_CHROME=/snap/bin/chromium bun apps/web/acceptance/user-message-motion.ts
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { buildWebAssets } from '../../../scripts/generate-web-assets';
import { WebService } from '../../../packages/session-host/src/web-service';
import { EventLog } from '../../../packages/session-host/src/event-log';
import { ensureStateLayout, resolveStatePaths } from '../../../packages/session-host/src/paths';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = mkdtempSync(join(tmpdir(), 'deck-chat-bench-'));
const paths = resolveStatePaths({ env: { XDG_STATE_HOME: root } });
ensureStateLayout(paths);
const log = EventLog.open({ dir: join(paths.sessionsDir, 's', 'events'), sessionId: 's' });
log.append({ kind: 'session.created' });
log.append({ kind: 'session.state', data: { state: 'idle' } });
log.append({ kind: 'task.created', source: { taskId: 'lead', memberId: 'lead' }, data: { taskId: 'lead', runnerId: 'synthetic', state: 'completed' } });
const count = 4;
for (let i = 0; i < count; i++)
    log.append({ kind: 'message.completed', source: { taskId: 'lead', memberId: 'lead' }, data: { role: i % 2 ? 'assistant' : 'user', text: `Synthetic message ${i}\n\n**Markdown** with a table\n\n| Key | Value |\n| --- | --- |\n| index | ${i} |\n\n` + 'Synthetic content with [reference](https://example.com). '.repeat(i % 5 + 1) } });
const other = EventLog.open({ dir: join(paths.sessionsDir, 't', 'events'), sessionId: 't' });
other.append({ kind: 'message.completed', data: { text: 'Other synthetic session' } });
const session = { sessionId: 's', projectId: 'p', title: 'Synthetic history', state: 'idle', lastSeq: log.lastSeq, generation: 0, members: { lead: { runnerId: 'synthetic', modelId: 'test' } } };
const host = new WebService({ paths, assets: await buildWebAssets(), config: { port: 0, trustedProxy: null, allowedOrigins: [], allowFunnel: false }, service: { openLog: id => id === 's' ? log : id === 't' ? other : undefined, hasRunningWork: () => false, execute: async () => ({ ok: true }), query: (name) => ({ ok: true, data: name === 'projects.list' ? { projects: [{ projectId: 'p', name: 'Synthetic', path: '/tmp/synthetic', available: true }] } : name === 'sessions.list' || name === 'sessions.status' ? { sessions: [session, { ...session, sessionId: 't', title: 'Other session' }] } : name === 'session.readiness' ? { status: 'ready', generation: 0 } : name === 'decisions.list' ? {decisions:[]} : name === 'replies.list' ? {replies:[]} : name === 'prompts.list' ? { seq: log.lastSeq, paused: false, queued: [] } : {} }) } });
host.enable();
const browser = await chromium.launch({ executablePath: process.env.DECK_TEST_CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.addInitScript(() => {
    const WS = window.WebSocket;
    (window as any).__chatSockets = [];
    window.WebSocket = class extends WS {
        constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); (window as any).__chatSockets.push(this); }
    };
});
const errors: string[] = [];
page.on('pageerror', e => {errors.push(e.message);console.log('PAGE ERROR',e.message,e.stack);});
try {
 mkdirSync('/tmp/deck-user-message-frames',{recursive:true});
 await page.addInitScript(() => {
   (window as any).entrances=[];
   new MutationObserver(records=>{for(const record of records){const node=record.target as HTMLElement;if(node.matches?.('.message') && node.style.opacity && Number(node.style.opacity)<0.99)(window as any).entrances.push({text:node.textContent,opacity:node.style.opacity,y:node.style.transform});}}).observe(document,{subtree:true,attributes:true,attributeFilter:['style']});
 });
 await page.route('**/replies?*',route=>route.fulfill({json:{ok:true,replies:[]}}));
 await page.goto(host.status().url!);
 await page.getByRole('button',{name:'Synthetic history',exact:true}).click();
 await page.locator('#prompt').waitFor();await page.waitForTimeout(800);
 const samples=()=>page.evaluate(()=>(window as any).entrances);
 assert.equal((await samples()).length,0,'history must not animate');

 await page.locator('#prompt').focus();
 for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);
   const text=`New user ${width}`;
   log.append({kind:'message.completed',source:{taskId:'lead',memberId:'lead'},data:{role:'user',text}});
   await page.waitForFunction(text=>(window as any).entrances.some((s:any)=>s.text.includes(text)),text);
   await page.screenshot({path:`/tmp/deck-user-message-frames/${width}-enter.png`});
   await page.waitForTimeout(350);
   await page.screenshot({path:`/tmp/deck-user-message-frames/${width}-settled.png`});
   assert(await page.locator('#prompt').evaluate(e=>document.activeElement===e),'focus retained');
   assert.equal(await page.locator('.message.user').last().evaluate(e=>(e as HTMLElement).style.opacity),'');
   const gap=await page.locator('#conversation').evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight);
   assert(gap<10,`following retained: ${gap}`);
 }
 log.append({kind:'message.completed',source:{taskId:'lead'},data:{role:'assistant',text:'Agent stays still'}});
 await page.getByText('Agent stays still',{exact:true}).waitFor();await page.waitForTimeout(350);
 assert(!(await samples()).some((s:any)=>s.text.includes('Agent stays still')));
 await page.emulateMedia({reducedMotion:'reduce'});
 log.append({kind:'message.completed',source:{taskId:'lead'},data:{role:'user',text:'Reduced stays still'}});
 await page.getByText('Reduced stays still',{exact:true}).waitFor();await page.waitForTimeout(100);
 assert(!(await samples()).some((s:any)=>s.text.includes('Reduced stays still')));
 await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'Other session',exact:true}).click();await page.waitForTimeout(300);
 const before=(await samples()).length;
 await page.getByRole('button',{name:'Synthetic history',exact:true}).click();await page.waitForTimeout(700);
 assert.equal((await samples()).length,before,'session history must not replay');
 // Re-delivery updates the same authoritative history identity, never a new entrance.
 const stable=await page.locator('.message.user').filter({hasText:'New user 390'}).evaluate(e=>({id:Number(e.closest('[data-history-id]')!.getAttribute('data-history-id'))}));
 const pageData=await page.evaluate(async()=>await(await fetch('/api/sessions/s/history')).json());
 const row=pageData.messages.find((r:any)=>r.historyId===stable.id);
 const cursor=log.lastSeq+1;
 await page.evaluate(({row,cursor})=>{
   const event={...row,seq:cursor};
   const sockets=(window as any).__chatSockets as WebSocket[];
   sockets.at(-1)!.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'event',event,message:{...row,seq:cursor}})}));
 },{row,cursor});
 await page.waitForTimeout(100);assert.equal((await samples()).length,before,'same identity reconciliation stays still');
 // New insertion followed by session navigation disposes the still-running tween.
 const next={...row,historyId:cursor+1,seq:cursor+1,data:{...row.data,text:'Interrupted entrance'}};
 await page.evaluate(next=>{((window as any).__chatSockets as WebSocket[]).at(-1)!.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'event',event:next,message:next})}));},next);
 await page.getByText('Interrupted entrance',{exact:true}).waitFor();
 await page.evaluate(()=>{(window as any).interruptedNode=Array.from(document.querySelectorAll('.message.user')).find(e=>e.textContent?.includes('Interrupted entrance'));});
 await page.getByRole('button',{name:'Other session',exact:true}).click();
 await page.waitForFunction(()=>!(window as any).interruptedNode.isConnected);
 assert.equal(await page.evaluate(()=>(window as any).interruptedNode.style.opacity),'','interrupted tween cleared on session change');
 assert.equal(await page.evaluate(()=>(window as any).interruptedNode.style.transform),'');
 assert.deepEqual(errors,[]);
 console.log('PASS production bundle: history, live desktop/mobile frames, focus/scroll, agent exclusion, reduced motion, session switch, same-ID reconciliation and interrupted cleanup');
 console.log(JSON.stringify((await samples()).filter((_:any,i:number)=>i%8===0)));
} finally {await browser.close();await host.close();log.close();other.close();rmSync(root,{recursive:true,force:true});}
