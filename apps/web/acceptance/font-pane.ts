import assert from 'node:assert/strict';
/** Regression: first task reply after an upward gesture in an empty transcript.
 * Builds fresh production assets;
 * uses a temporary EventLog and fake service, never a native runner or real prompt.
 * DECK_TEST_CHROME=/path/to/chrome bun apps/web/acceptance/empty-transcript.ts
 */
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
const count = 160;
for (let i = 0; i < count; i++)
    log.append({ kind: 'message.completed', source: { taskId: 'lead', memberId: 'lead' }, data: { role: i % 2 ? 'assistant' : 'user', text: `Synthetic message ${i}\n\n**Markdown** with a table\n\n| Key | Value |\n| --- | --- |\n| index | ${i} |\n\n` + 'Synthetic content with [reference](https://example.com). '.repeat(i % 5 + 1) } });
const other = EventLog.open({ dir: join(paths.sessionsDir, 't', 'events'), sessionId: 't' });
other.append({ kind: 'message.completed', data: { text: 'Other synthetic session' } });
const session = { sessionId: 's', projectId: 'p', title: 'Synthetic history', state: 'idle', lastSeq: log.lastSeq, generation: 0, members: { lead: { runnerId: 'synthetic', modelId: 'test' } } };
const host = new WebService({ paths, assets: await buildWebAssets(), config: { port: 0, trustedProxy: null, allowedOrigins: [], allowFunnel: false }, service: { openLog: id => id === 's' ? log : id === 't' ? other : undefined, hasRunningWork: () => false, execute: async () => ({ ok: true }), query: (name) => ({ ok: true, data: name === 'projects.list' ? { projects: [{ projectId: 'p', name: 'Synthetic', path: '/tmp/synthetic', available: true }] } : name === 'sessions.list' || name === 'sessions.status' ? { sessions: [session, { ...session, sessionId: 't', title: 'Other session' }] } : name === 'session.readiness' ? { status: 'ready', generation: 0 } : name === 'prompts.list' ? { seq: log.lastSeq, paused: false, queued: [] } : {} }) } });
host.enable();
const browser = await chromium.launch({ executablePath: process.env.DECK_TEST_CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:1440,height:900}});
const requests:string[]=[]; page.on('request',request=>requests.push(request.url()));
try {
 await page.goto(host.status().url!);
 await page.getByRole('button',{name:'Deck menu'}).click();
 await page.getByRole('menuitem',{name:/Font/}).click();
 for (const [label,family] of [['Inter','Deck Inter'],['Geist','Deck Geist'],['JetBrains Mono','Deck JetBrains Mono'],['Fira Code','Deck Fira Code'],['Nunito Sans','Deck Nunito Sans'],['Space Grotesk','Deck Space Grotesk'],['Source Serif 4','Deck Source Serif 4'],['Lora','Deck Lora'],['IBM Plex Mono','Deck IBM Plex Mono']]) {
  await page.getByRole('radio',{name:label,exact:true}).check();
  assert(await page.evaluate(async name=>{await document.fonts.load(`16px "${name}"`, "Español: acción, año, pingüino");return document.fonts.check(`16px "${name}"`, "Español: acción, año, pingüino");},family));
  assert(requests.some(url=>url.includes('/fonts/'+({'Inter':'inter','Geist':'geist','JetBrains Mono':'jetbrains-mono','Fira Code':'fira-code','Nunito Sans':'nunito-sans','Space Grotesk':'space-grotesk','Source Serif 4':'source-serif-4','Lora':'lora','IBM Plex Mono':'ibm-plex-mono'} as Record<string,string>)[label]+'.woff2')));
 }
 await page.reload();
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.font),'ibm-plex-mono');
 await page.getByRole('button',{name:'Deck menu'}).click(); await page.getByRole('menuitem',{name:/Font/}).click();
 assert(await page.getByRole('radio',{name:'IBM Plex Mono'}).isChecked());
 await page.getByRole('radio',{name:'Fira Code',exact:true}).check();
 await page.getByRole('button',{name:'Close font picker'}).click();
 assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')), 'Deck menu');
 const divider=page.getByRole('separator',{name:'Resize conversation and workspace'});
 await divider.focus(); await page.keyboard.press('ArrowRight');
 assert.equal(await divider.getAttribute('aria-valuenow'),'52');
 const box=await divider.boundingBox(); assert(box); await page.mouse.move(box.x+6,box.y+100);await page.mouse.down();await page.mouse.move(box.x+80,box.y+100);await page.mouse.up();
 const ratio=await divider.getAttribute('aria-valuenow'); assert(Number(ratio)>52);
 await page.reload(); assert.equal(await divider.getAttribute('aria-valuenow'),ratio); assert.equal(await page.evaluate(()=>document.documentElement.dataset.font),'fira-code');
 await page.getByRole('button',{name:'Deck menu'}).click(); await page.getByRole('menuitem',{name:/Font/}).click();
 assert(await page.getByRole('radio',{name:'Fira Code'}).isChecked()); await page.getByRole('button',{name:'Close font picker'}).click();
 for (const width of [1001,1100,1280]) for (const collapsed of [false,true]) for (const key of ['Home','End']) {
  await page.setViewportSize({width,height:900});
  const toggle=page.getByRole('button',{name:collapsed?'Collapse sidebar':'Expand sidebar'});
  if (await toggle.count()) await toggle.click();
  await divider.focus(); await page.keyboard.press(key);
  const geometry=await page.evaluate(()=>{const panes=document.querySelector('.panes')!, chat=document.querySelector('.chat-pane')!, divider=document.querySelector('.pane-divider')!, nav=document.querySelector('.view-nav')!, tab=document.querySelector('.workspace-tabs')!; const p=panes.getBoundingClientRect(), c=chat.getBoundingClientRect(), d=divider.getBoundingClientRect(), n=nav.getBoundingClientRect(), t=tab.getBoundingClientRect(), w=document.querySelector('.workspace-pane')!.getBoundingClientRect(); return {paneRight:p.right, chatRight:c.right, dividerCenter:(d.left+d.right)/2, workspaceRight:w.right, workspaceWidth:w.width, navSplit:t.left, navRight:n.right, overflow:document.documentElement.scrollWidth-innerWidth};});
  assert(Math.abs(geometry.chatRight-geometry.dividerCenter)<1, JSON.stringify({width,collapsed,key,geometry}));
  assert(Math.abs(geometry.chatRight-geometry.navSplit)<1, JSON.stringify({width,collapsed,key,geometry}));
  assert(geometry.workspaceWidth>=279 && geometry.workspaceRight<=geometry.paneRight+1 && geometry.overflow<=1 && geometry.paneRight<=width+1 && geometry.navRight<=width+1, JSON.stringify({width,collapsed,key,geometry}));
 }
 await page.setViewportSize({width:1440,height:900}); await divider.focus(); await page.keyboard.press('End');
 await page.setViewportSize({width:1001,height:900}); await page.setViewportSize({width:1440,height:900});
 assert.equal(await divider.getAttribute('aria-valuenow'),'75');
 await divider.focus(); await page.keyboard.press('Home');

 await page.getByRole('button',{name:'Chat',exact:true}).click(); assert.equal(await divider.count(),0);
 await page.getByRole('button',{name:'Both',exact:true}).click(); assert.equal(await divider.getAttribute('aria-valuenow'),'25');
 await page.screenshot({path:'/tmp/deck-font-pane-desktop.png'});
 await page.setViewportSize({width:390,height:844}); assert.equal(await divider.count(),0);
 await page.getByRole('button',{name:'Open sessions'}).click(); await page.getByRole('button',{name:/Font/}).click(); assert(await page.getByRole('radio',{name:'Fira Code'}).isChecked());
 for (const width of [320,390,1440]) {
  await page.setViewportSize({width,height:width === 1440 ? 900 : 480});
  await page.getByRole('radio',{name:'IBM Plex Mono'}).check();
  assert(await page.getByRole('radio',{name:'IBM Plex Mono'}).isChecked());
  await page.getByRole('button',{name:'Close font picker'}).scrollIntoViewIfNeeded();
  assert(await page.getByRole('button',{name:'Close font picker'}).isVisible());
  await page.screenshot({path:`/tmp/deck-font-picker-${width}.png`});
  const rows=await page.locator('.font-dialog label').evaluateAll(labels=>labels.map(label=>{const input=label.querySelector('input')!.getBoundingClientRect(), text=label.querySelector('span')!.getBoundingClientRect(), row=label.getBoundingClientRect();return {input:{left:input.left,right:input.right,top:input.top,bottom:input.bottom,width:input.width,height:input.height},text:{left:text.left,top:text.top,bottom:text.bottom},height:row.height,direction:getComputedStyle(label).flexDirection};}));
  for (const row of rows) assert(row.direction==='row' && row.input.right<=row.text.left && row.input.top<row.text.bottom && row.input.bottom>row.text.top && row.input.width>=10 && row.input.width<=24 && row.input.height>=10 && row.input.height<=24 && row.height>=44, JSON.stringify({width,row}));
 }
 assert(requests.every(url=>new URL(url).origin===new URL(host.status().url!).origin));
 console.log('font and pane browser acceptance passed');
} finally { await browser.close(); await host.disable(); log.close(); other.close(); rmSync(root,{recursive:true,force:true}); }
