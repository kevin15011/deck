import { selectTheme } from './acceptance-theme';
/** Opt-in real streaming/browser regression; native effects are deterministic FakeDriver events. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '@playwright/test';
import type {CrossRunnerConfig} from '../../packages/core/src/config/deck-config';
import type {SessionCommandBody} from '../../packages/core/src/session/commands';
import {SessionManager} from '../../packages/session-host/src/session-manager';
import {ApprovalBroker} from '../../packages/session-host/src/approval-broker';
import {CredentialRegistry} from '../../packages/session-host/src/credentials';
import {Supervisor} from '../../packages/session-host/src/supervisor';
import {FakeDriver} from '../../packages/session-host/src/testing/fake-driver';
import {WebService} from '../../packages/session-host/src/web-service';
import {ensureStateLayout,resolveStatePaths} from '../../packages/session-host/src/paths';
import {WEB_ASSETS} from '../cli/src/runtime/web-assets.generated';

const phase=process.env.DECK_STREAM_PHASE??'after',evidence=join('/tmp/deck-streaming-evidence',phase);mkdirSync(evidence,{recursive:true});
const root=realpathSync(mkdtempSync('/tmp/deck-stream-')),home=join(root,'home'),project=join(home,'project');mkdirSync(project,{recursive:true});
const paths=resolveStatePaths({env:{XDG_STATE_HOME:join(root,'state')}});ensureStateLayout(paths);
const driver=new FakeDriver();driver.onStart=turn=>turn.init();
const credentials=new CredentialRegistry({socketPath:paths.socket.path});let manager!:SessionManager;
const config:CrossRunnerConfig={enabled:true,members:{lead:{runnerId:'claude',modelId:'fixture'}},executionBudget:{lead:2,delegated:4},approvals:{claude:'relay',codex:'runner-default',opencode:'relay'},maxConcurrentTasks:4,claudeTosAcknowledgedAt:null,web:{port:0,trustedProxy:null,allowedOrigins:[],allowFunnel:false}};
manager=new SessionManager({paths,credentials,broker:new ApprovalBroker({sink:{emit:(id,draft)=>manager.openLog(id)?.append(draft)}}),supervisor:new Supervisor({anchorCommand:['unused']}),drivers:{get:id=>id==='claude'?driver:undefined,list:()=>[driver]},config:()=>config,sessionMcpCommand:['/not-launched/deck'],homeDir:home});
const host=new WebService({paths,assets:WEB_ASSETS,config:config.web,service:manager});host.enable();
const browser=await chromium.launch({executablePath:process.env.DECK_TEST_CHROME??join(homedir(),'Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),headless:true});
const command=async(body:SessionCommandBody,sessionId?:string)=>{const r=await manager.execute({sessionId,clientId:'streaming-browser',command:{v:1,commandId:randomUUID(),...body} as never});assert.equal(r.ok,true,JSON.stringify(r));return(r as any).data;};
const wait=async(test:()=>boolean|Promise<boolean>,label:string)=>{for(let i=0;i<240;i++){if(await test())return;await Bun.sleep(25);}throw Error('Timed out: '+label);};
const results:any[]=[];
try{
 const projectId=(await command({type:'project.register',path:project,name:'Streaming fixture'})).project.projectId;
 for(const width of (process.env.DECK_STREAM_WIDTHS??'390,320,1440').split(',').map(Number))for(const reducedMotion of (process.env.DECK_STREAM_MOTION?[process.env.DECK_STREAM_MOTION]:['no-preference','reduce']) as ('no-preference'|'reduce')[]){
  const name=`${width}-${reducedMotion}`,context=await browser.newContext({viewport:{width,height:width===1440?1000:844},reducedMotion,recordVideo:{dir:join(evidence,'video'),size:{width,height:width===1440?1000:844}}});
  const page=await context.newPage();page.setDefaultTimeout(8000);const video=page.video(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{Object.defineProperty(navigator.clipboard,'writeText',{value:async()=>{}});window.addEventListener('beforeinstallprompt',e=>{if(e.isTrusted){e.preventDefault();e.stopImmediatePropagation();}},true);});
  try{
   const sessionId=(await command({type:'session.create',projectId,title:'Stream '+name})).sessionId;
   await command({type:'prompt.send',text:'Seed historical reading fixture'},sessionId);const seed=driver.turns.at(-1)!;
   seed.say(Array.from({length:28},(_,i)=>`Historical paragraph ${i+1}. This completed passage should remain still and selectable while the Lead writes a new response.`).join('\n\n'));seed.finish();await wait(()=>!manager.hasRunningWork(),'seed completion');
   await page.goto(`${host.status().url}/?session=${sessionId}`);await page.locator('.app-header').waitFor();
   await wait(async()=>{const input=page.getByLabel('Message the lead');if(await input.count()&&await input.isEnabled())return true;const prepare=page.locator('.composer-gate').getByRole('button',{name:'Prepare session',exact:true});if(await prepare.isVisible()&&await prepare.isEnabled())await prepare.click();return false;},'composer');
   await selectTheme(page,width===390?'cyberpunk':width===320?'dark':'light');await Bun.sleep(850);
   await page.getByLabel('Message the lead').fill('Draft retained during streaming');
   await page.locator('#conversation').evaluate(el=>el.scrollTop=el.scrollHeight);await Bun.sleep(50);
   await command({type:'prompt.send',text:'Write a deterministic streamed response'},sessionId);const turn=driver.turns.at(-1)!;
   let text='Streaming introduction stays readable.\n\n```ts\nconst stable = true;\n```\n\n| Item | State |\n| --- | --- |\n| Stream | Active |\n\n[Documentation](https://example.com/docs)\n\nGrowing tail: ';
   turn.emit('message.delta',{text});await Bun.sleep(50);const latest=page.getByRole('button',{name:'Jump to latest ↓',exact:true});if(await latest.isVisible())await latest.click();
   await page.locator('.history-row').last().getByText('Streaming introduction stays readable.',{exact:true}).waitFor({state:'attached'});await Bun.sleep(350);
   const historyId=Number(await page.locator('.history-row').last().getAttribute('data-history-id'));
   await page.locator('.history-row').last().getByRole('button',{name:'Copy code',exact:true}).click();await page.locator('.history-row').last().getByRole('button',{name:'Copied',exact:true}).waitFor();
   await page.locator('#conversation').evaluate(el=>el.scrollTop=el.scrollHeight);await Bun.sleep(50);
   // Measure actual node continuity, frame opacity and selection, rather than inferring from renders.
   await page.evaluate(id=>{
    const w=window as any,root=document.getElementById('conversation')!,selector=`[data-history-id="${id}"] article`,ids=new WeakMap<Node,number>();let serial=0;
    const key=(node:Node|null|undefined)=>node?(ids.get(node)??(ids.set(node,++serial),serial)):0;
    const state=w.__streamProbe={samples:[] as any[],phase:'pinned',stopped:false,removedArticles:0};
    const observer=new MutationObserver(records=>{for(const r of records)for(const n of r.removedNodes)if(n instanceof Element){state.removedArticles+=Number(n.matches('article.message'))+n.querySelectorAll('article.message').length;}});
    observer.observe(root,{childList:true,subtree:true});const began=performance.now();
    function sample(){
     const article=root.querySelector<HTMLElement>(selector),pre=article?.querySelector('.code-block'),table=article?.querySelector('table'),link=article?.querySelector('a'),selection=getSelection();
     state.samples.push({t:performance.now()-began,phase:state.phase,article:key(article),pre:key(pre),table:key(table),link:key(link),opacity:article?Number(getComputedStyle(article).opacity):0,top:article?.getBoundingClientRect().top,scrollTop:root.scrollTop,bottom:root.scrollHeight-root.scrollTop-root.clientHeight,selected:selection?.toString(),selectionNode:key(selection?.anchorNode),copy:article?.querySelector('.code-toolbar button')?.textContent});
     if(!state.stopped&&state.samples.length<1200)requestAnimationFrame(sample);else observer.disconnect();
    }
    const p=root.querySelector(selector+' .markdown p')!,range=document.createRange();range.selectNodeContents(p);getSelection()?.removeAllRanges();getSelection()?.addRange(range);
    sample();
   },historyId);
   const chunks=[...Array.from({length:8},(_,n)=>`Readable chunk ${n+1}. `),'\n\n## Follow-up\n\n- ','First item\n- Second item','\n\n```sh\n','echo streaming','\n```\n\n','| Detail | Value |\n','| --- | --- |\n','| Renderer | Stable |\n'];
   for(const chunk of chunks){text+=chunk;turn.emit('message.delta',{text:chunk});await Bun.sleep(100);}
   await page.screenshot({path:join(evidence,`${name}-stream.png`),fullPage:true});
   // Read an older passage using a real scroll gesture while the stream continues below it.
   await page.evaluate(()=>(window as any).__streamProbe.phase='scrolling');await page.locator('#conversation').hover();await page.mouse.wheel(0,-650);await Bun.sleep(300);
   const anchor=await page.evaluate(()=>{
    const root=document.getElementById('conversation')!,top=root.getBoundingClientRect().top;
    const p=[...root.querySelectorAll<HTMLElement>('article.message p')].find(p=>p.getBoundingClientRect().top>=top&&p.getBoundingClientRect().bottom<root.getBoundingClientRect().bottom)!;
    p.dataset.streamAnchor='true';const range=document.createRange();range.selectNodeContents(p);getSelection()?.removeAllRanges();getSelection()?.addRange(range);(window as any).__streamProbe.phase='older';
    return{offset:p.getBoundingClientRect().top-top,selected:getSelection()?.toString(),scrollTop:root.scrollTop};
   });
   for(let n=0;n<16;n++){const chunk=`\n\nAdditional paragraph ${n+1} keeps updating below the reader without taking over the viewport.`;text+=chunk;turn.emit('message.delta',{text:chunk});await Bun.sleep(100);}
   const background=(await command({type:'session.create',projectId,title:'Independent '+name})).sessionId;
   await command({type:'prompt.send',text:'Background result'},background);const other=driver.turns.at(-1)!;other.say('Independent background result');other.finish();
   turn.say(text);turn.finish();await wait(()=>!manager.hasRunningWork(),'completion');await Bun.sleep(400);
   const older=await page.evaluate(()=>{const root=document.getElementById('conversation')!,p=root.querySelector<HTMLElement>('[data-stream-anchor]');return{offset:p?p.getBoundingClientRect().top-root.getBoundingClientRect().top:undefined,selected:getSelection()?.toString(),scrollTop:root.scrollTop};});
   const trace=await page.evaluate(()=>{const p=(window as any).__streamProbe;p.stopped=true;return p;});
   const pinned=trace.samples.filter((s:any)=>s.phase==='pinned'),old=trace.samples.filter((s:any)=>s.phase==='older');
   const metrics={articleNodes:new Set(trace.samples.map((s:any)=>s.article)).size,codeNodes:new Set(trace.samples.map((s:any)=>s.pre)).size,tableNodes:new Set(trace.samples.map((s:any)=>s.table)).size,linkNodes:new Set(trace.samples.map((s:any)=>s.link)).size,minPinnedOpacity:Math.min(...pinned.map((s:any)=>s.opacity)),removedArticles:trace.removedArticles,copyRetained:pinned.every((s:any)=>s.copy==='Copied'),streamSelectionRetained:pinned.every((s:any)=>s.selected==='Streaming introduction stays readable.'),olderAnchorDrift:older.offset===undefined?null:Math.abs(older.offset-anchor.offset),olderSelectionRetained:older.selected===anchor.selected,maxPinnedBottomGap:Math.max(...pinned.map((s:any)=>Math.abs(s.bottom)))};
   writeFileSync(join(evidence,name+'-trace.json'),JSON.stringify({metrics,anchor,older,pinnedFrames:pinned.length,olderFrames:old.length,trace},null,2));
   await page.screenshot({path:join(evidence,`${name}-older.png`),fullPage:true});
   // Offscreen/background outcomes stay unread. Only actual focused display clears this reply.
   const replies=()=>page.evaluate(async()=>await(await fetch('/api/replies')).json());await wait(async()=>(await replies()).total===2,'offscreen unread outcomes');
   await page.getByRole('button',{name:'Jump to latest ↓',exact:true}).click();await page.bringToFront();await wait(async()=>(await replies()).total===1,'visible exact receipt');
   assert.equal(await page.getByLabel('Message the lead').inputValue(),'Draft retained during streaming');assert.deepEqual(errors,[]);
   const result={name,width,reducedMotion,metrics,errors,offscreenUnread:2,afterVisibleUnread:1};results.push(result);console.log(JSON.stringify(result));
   if(process.env.DECK_STREAM_ASSERT==='1'){
    assert.equal(metrics.articleNodes,1,'one message node across deltas and completion');assert.equal(metrics.codeNodes,1,'code block is not recreated');assert.equal(metrics.tableNodes,1,'table is not recreated');assert.equal(metrics.linkNodes,1,'link is not recreated');
    assert.equal(metrics.removedArticles,0,'stream updates do not replace messages');assert.equal(metrics.copyRetained,true);assert.equal(metrics.streamSelectionRetained,true);assert.equal(metrics.olderSelectionRetained,true);
    assert(metrics.minPinnedOpacity>=.99,'stream never repeats its entrance fade');assert(metrics.olderAnchorDrift!==null&&metrics.olderAnchorDrift<2,'older reading position remains still');assert(metrics.maxPinnedBottomGap<2,'pinned bottom remains at the growing tail');
   }
  }catch(error){await page.screenshot({path:join(evidence,name+'-failure.png'),fullPage:true}).catch(()=>{});writeFileSync(join(evidence,name+'-failure.txt'),await page.locator('body').innerText().catch(()=>''));throw error;}
  finally{await context.close();if(video)await video.saveAs(join(evidence,name+'.webm'));}
 }
}finally{writeFileSync(join(evidence,'results.json'),JSON.stringify(results,null,2));await browser.close();await host.close();await manager.close();rmSync(root,{recursive:true,force:true});}
