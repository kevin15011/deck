/** Runs current source with synthetic HTTP/WebSocket data; never uses the Deck daemon. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { selectTheme } from './acceptance-theme';
import { THEMES } from './src/theme';

const build = await Bun.build({entrypoints:[`${import.meta.dir}/src/main.tsx`],target:'browser',minify:false});
assert(build.success, build.logs.map(String).join('\n'));
const assets = new Map(build.outputs.map(output=>[output.path.split('/').at(-1)!, output]));
const project = {projectId:'project',name:'Layout audit',path:'/tmp/deck-layout-fixture',available:true};
const sessions = ['one','two','unprepared'].map((sessionId,index)=>({sessionId,projectId:project.projectId,title:index===0?'First session':index===1?'Second session with a longer name':'Unprepared session',state:'idle',generation:0,preparationStatus:index===2?'unprepared':'ready',lastSeq:41,grants:index===0?[{grantId:'grant',kind:'exact',toolKey:'codex:Read',exactKey:'README.md',risk:'normal',createdAt:'2026-01-01T00:00:00Z'}]:[],members:index===0?{lead:{runnerId:'codex',modelId:'fixture-model'}}:{}}));
let historyRequests = 0, sockets = 0, offline = false, sent = 0, approvalVisible = false, summaryDelay = 0, inboxRequests = 0, pushEnabled=false;
let quotaRefreshes=0,claudeQuotaRefreshes=0;
let promptEffect: ((text:string)=>Promise<void>)|undefined;
const history = (sessionId:string) => {
    const events: any[] = [{v:1,sessionId,seq:1,ts:'2026-01-01T00:00:00Z',kind:'task.created',source:{taskId:'lead',memberId:'lead',runnerId:'codex',nativeSessionId:'fixture-thread'},data:{taskId:'lead',attempt:1,state:'idle',runnerId:'codex',modelId:'fixture-model'}}];
    events.push({v:1,sessionId,seq:41,ts:'2026-01-01T00:00:00Z',kind:'usage',source:{taskId:'lead',memberId:'lead',runnerId:'codex',nativeSessionId:'fixture-thread'},data:{attempt:1,context:{basis:'codex-last-total',tokens:273000,capacity:1000000,nativeThreadId:'fixture-thread',nativeTurnId:'fixture-turn'}}});
    if(approvalVisible)events.push({v:1,sessionId,seq:42,ts:'2026-01-01T00:00:00Z',source:{taskId:'lead',memberId:'lead'},kind:'approval.requested',data:{approvalId:'fixture-approval',tool:'Read',toolKey:'codex:Read',exactKey:'README.md',summary:'Read this file',risk:'normal',allowedScopes:['once','session'],grantKinds:['exact','tool']}});
    return {seq:approvalVisible?42:41,events,messages:Array.from({length:40},(_,i)=>({v:1,sessionId,seq:i+2,historyId:i+2,ts:'2026-01-01T00:00:00Z',kind:'message.completed',source:{taskId:'lead',memberId:'lead'},data:{role:'assistant',text:`Message ${i+1}. ${'Synthetic conversation content. '.repeat(12)}`}}))};
};
const server = Bun.serve({port:0,hostname:'127.0.0.1',fetch: async (request,server) => {
    const url=new URL(request.url),path=url.pathname;
    if(path.endsWith('/events')){if(offline)return new Response('Offline',{status:503});if(server.upgrade(request))return;return new Response(null,{status:400});}
    const asset=assets.get(path.slice(1));if(asset)return new Response(asset);
    if(path==='/')return new Response('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/main.css"></head><body><div id="root"></div><script type="module" src="/main.js"></script></body></html>',{headers:{'Content-Type':'text/html'}});
    const sessionId=path.split('/')[3]??'one';
    const json=(value:unknown)=>Response.json(value);
    if(path.endsWith('/history')){historyRequests++;await Bun.sleep(160);return json(history(sessionId));}
    if(path.endsWith('/summary')){if(summaryDelay)await Bun.sleep(summaryDelay);return json({ok:true,data:{session:sessions.find(s=>s.sessionId===sessionId)}});}
    if(path.endsWith('/readiness')){await Bun.sleep(160);return json({ok:true,data:{status:sessionId==='unprepared'?'unprepared':'ready',generation:0,personalMcpRunnerId:'codex',personalMcpAvailability:sessionId==='one'?[{id:'fixture-mcp',source:'user',status:'configured'}]:[]}});}
    const quotaState=()=>({runners:{claude:{refreshAfter:claudeQuotaRefreshes?Date.now()+60000:0,refreshing:false,snapshot:{runnerId:'claude',updatedAt:Date.now()-120000,windows:[{id:'five-hour',usedPercent:90,resetsAt:Date.now()+3600000},{id:'seven-day',usedPercent:49,resetsAt:Date.now()+86400000}],overageStatus:'rejected'}},codex:{refreshAfter:quotaRefreshes?Date.now()+60000:0,refreshing:false,snapshot:{runnerId:'codex',updatedAt:Date.now()-60000,plan:'pro',windows:[{id:'seven-day',usedPercent:7,resetsAt:Date.now()+86400000}]}}}});
    if(path==='/api/quota')return json({ok:true,...quotaState()});
    if(path==='/api/quota/claude/refresh'){claudeQuotaRefreshes++;return Response.json({ok:false,code:'quota-no-data',message:'No quota event arrived. Previous snapshot kept.'},{status:503});}
    if(path==='/api/quota/codex/refresh'){quotaRefreshes++;return json({ok:true,state:quotaState()});}
    if(path==='/api/push'){if(request.method==='DELETE')pushEnabled=false;if(request.method==='POST')pushEnabled=true;return json({enabled:pushEnabled,publicKey:'BAECAw',delivery:{eligible:1,sent:0,suppressed:0,failed:1,lastOutcome:'expired'}});}
    if(path==='/api/projects')return json({ok:true,data:{projects:[project]}});
    if(path==='/api/sessions'||path==='/api/sessions/status')return json({ok:true,data:{sessions}});
    if(path==='/api/replies'){inboxRequests++;return json({total:131,replies:[]});}
    if(path.endsWith('/replies'))return json({replies:[]});
    if(path.endsWith('/decisions'))return json({ok:true,data:{decisions:[]}});
    if(path.endsWith('/prompts'))return json({ok:true,data:{seq:1,paused:false,queued:[]}});
    if(path==='/api/models')return json({ok:true,data:{runners:[{runnerId:'codex',label:'Codex',available:true,models:[{modelId:'fixture',label:'Fixture',thinkingLevels:[]}]}]}});
    if(path==='/api/directories')return json({ok:true,data:{directories:[{name:'fixture',path:'/tmp/fixture'}]}});
    if(path==='/api/commands'){const body=await request.json() as any;if(body.command.type==='prompt.send'){sent++;await promptEffect?.(body.command.text);}return json({ok:true,data:{}});}
    return json({ok:true,data:{},changes:[],enabled:false});
},websocket:{open(){sockets++;},message(){}}});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
const context=await browser.newContext({viewport:{width:1440,height:1000},hasTouch:true});
await context.addInitScript(()=>{
    let subscription:any={options:{},toJSON:()=>({endpoint:'https://push.fixture/subscription'}),unsubscribe:async()=>{subscription=null;return true;}};
    (window as any).__permissionRequests=0;
    Object.defineProperty(Notification,'permission',{configurable:true,get:()=>'granted'});
    Notification.requestPermission=async()=>{(window as any).__permissionRequests++;return 'granted';};
    const registration={pushManager:{getSubscription:async()=>subscription,subscribe:async()=>{subscription={options:{},toJSON:()=>({endpoint:'https://push.fixture/subscription'}),unsubscribe:async()=>{subscription=null;return true;}};return subscription;}}};
    Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{addEventListener:()=>{},removeEventListener:()=>{},register:async()=>registration,ready:Promise.resolve(registration),getRegistration:async()=>registration}});
    const Native=WebSocket;(window as any).__sockets=[];window.WebSocket=class extends Native { constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);(window as any).__sockets.push(this);} };});
const page=await context.newPage();
const errors:string[]=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack);});
const checks:string[]=[];
async function check(name:string,run:()=>Promise<void>){if(process.env.DECK_LAYOUT_FILTER&&!name.includes(process.env.DECK_LAYOUT_FILTER))return;await run();checks.push(name);console.log(`PASS ${name}`);}
async function select(id:string){await page.goto('about:blank');await page.goto(`${server.url}?session=${id}`);await page.locator('#prompt').waitFor();await page.waitForTimeout(700);}
const rect = (selector:string)=>page.locator(selector).evaluate(element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
async function separate(selectors:string[]){
    const boxes=await Promise.all(selectors.map(rect));
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
        const a=boxes[i]!,b=boxes[j]!;
        assert(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,`${selectors[i]} overlaps ${selectors[j]}: ${JSON.stringify(boxes)}`);
    }
}
try{
    await select('one');
    await check('message copy source, hover, touch and stable geometry at 390 and 1440',async()=>{
        const userText='  Keep my exact spaces\n\n  <tags> & **literal markdown** 😀\n';
        const leadText='## Raw reply\n\n**Ready** [link](https://example.com)\n\n```ts\nconst x = 1;\n```\n';
        for(const width of [390,1440]){
            const copyContext=await browser.newContext({viewport:{width,height:844},hasTouch:width===390,permissions:['clipboard-read','clipboard-write']});
            try{
                const copyPage=await copyContext.newPage();
                await copyPage.route('**/history',async route=>{
                    const fixture=history('one');
                    fixture.messages[38].data={role:'user',text:userText};
                    fixture.messages[39].data={role:'assistant',text:leadText};
                    await route.fulfill({json:fixture});
                });
                await copyPage.goto(`${server.url}?session=one`);
                await copyPage.locator('#prompt').waitFor();
                await copyPage.locator('#conversation .message').last().waitFor();
                assert.equal(await copyPage.locator('#conversation .message-copy').count(),40);
                assert.equal(await copyPage.evaluate(()=>isSecureContext),true,'real clipboard tested on secure localhost');
                for(const [index,text] of [[38,userText],[39,leadText]] as const){
                    const message=copyPage.locator('#conversation .message').nth(index),button=message.getByRole('button',{name:'Copy message',exact:true});
                    await button.scrollIntoViewIfNeeded();await copyPage.mouse.move(0,0);await copyPage.locator('#prompt').focus();
                    const geometry=()=>message.evaluate(el=>[el,el.querySelector('.message-meta')!,el.querySelector('.markdown')!].map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
                    const before=await geometry();
                    assert.equal(await button.evaluate(el=>getComputedStyle(el).opacity),width===390?'1':'0');
                    if(width===1440){await message.hover();assert.equal(await button.evaluate(el=>getComputedStyle(el).opacity),'1');}
                    else {const bounds=await button.boundingBox();assert(bounds&&bounds.width>=44&&bounds.height>=44);}
                    assert.deepEqual(await geometry(),before,'hover reveal reserves its space');
                    await button.focus();assert.equal(await button.evaluate(el=>getComputedStyle(el).opacity),'1','keyboard focus reveals copy');
                    await button.click();
                    await message.getByRole('status').getByText('Copied',{exact:true}).waitFor();
                    assert.equal(await copyPage.evaluate(()=>navigator.clipboard.readText()),text,'clipboard gets source, including whitespace and markdown');
                    assert.equal(await button.locator('path').getAttribute('d'),'m3 8 3 3 7-7');
                    assert.deepEqual(await geometry(),before,'copy feedback does not shift layout');
                    await copyPage.waitForTimeout(1650);assert.equal(await message.getByRole('status').textContent(),'');
                }
                const lead=copyPage.locator('#conversation .message').last();
                await lead.getByRole('button',{name:'Copy code',exact:true}).click();
                assert.equal(await copyPage.evaluate(()=>navigator.clipboard.readText()),'const x = 1;','code blocks share the helper');
                await copyPage.screenshot({path:`/tmp/deck-message-copy-${width}.png`});
                // Exercise the LAN fallback in a real document, without Clipboard API.
                await copyPage.evaluate(()=>{(window as any).__copyClipboard=navigator.clipboard;Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});});
                const button=lead.getByRole('button',{name:'Copy message',exact:true});
                await button.click();await lead.getByRole('status').getByText('Copied',{exact:true}).waitFor();
                assert.equal(await copyPage.evaluate(()=>(window as any).__copyClipboard.readText()),leadText);
                assert.equal(await button.evaluate(el=>el===document.activeElement),true,'fallback restores focus');
                await copyPage.evaluate(()=>{document.execCommand=()=>false;});
                await button.click();await lead.getByRole('status').getByText('Copy failed',{exact:true}).waitFor();
                assert.equal(await copyPage.locator('textarea[aria-hidden="true"]').count(),0,'failed fallback cleans up');
                await copyPage.waitForTimeout(1650);assert.equal(await lead.getByRole('status').textContent(),'');
            }finally{await copyContext.close();}
        }
    });
    await check('quota dialog menus, bars, cooldown and dismissal at 390 and 1440',async()=>{
        for(const width of [390,1440]){
            await page.setViewportSize({width,height:844});await select('one');
            const open=async()=>{if(width<1000)await page.getByRole('button',{name:'Open sessions',exact:true}).click();else await page.getByRole('button',{name:'Deck menu',exact:true}).click();await page.getByRole(width<1000?'button':'menuitem',{name:'Quota usage',exact:true}).click();};
            const chat=await rect('#conversation');await open();
            const dialog=page.getByRole('dialog',{name:'Quota usage',exact:true});await dialog.waitFor();
            await page.getByRole('progressbar',{name:'Claude 5-hour usage',exact:true}).waitFor();
            assert.equal(await dialog.getByRole('progressbar').count(),3);
            assert.equal(await dialog.getByRole('progressbar',{name:'Codex 5-hour usage',exact:true}).count(),0);
            const bounds=await dialog.boundingBox();assert(bounds&&bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y>=0&&bounds.y+bounds.height<=844,'quota dialog fits viewport');
            const colors=await page.evaluate(themes=>{
                const root=document.documentElement,original=root.dataset.theme,result:{theme:string;runner:string;ratio:number;color:string}[]=[];
                const luminance=(rgb:string)=>{const c=rgb.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]!*.2126+c[1]!*.7152+c[2]!*.0722;};
                for(const theme of themes){root.dataset.theme=theme;for(const runner of ['claude','codex']){const bar=document.querySelector(`.quota-${runner} .quota-track`)!;const color=getComputedStyle(bar.firstElementChild!).backgroundColor,a=luminance(color),b=luminance(getComputedStyle(bar).backgroundColor);result.push({theme,runner,color,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)});}}
                root.dataset.theme=original;return result;
            },THEMES.map(theme=>theme.id));
            for(const value of colors)assert(value.ratio>=3,`${value.theme} ${value.runner} progress contrast ${value.ratio}`);
            assert.equal(colors.find(value=>value.theme==='dark'&&value.runner==='claude')!.color,'rgb(237, 119, 119)');
            assert.equal(colors.find(value=>value.theme==='light'&&value.runner==='codex')!.color,'rgb(29, 96, 196)');
            for(const button of await dialog.getByRole('button').all()){const box=await button.boundingBox();assert(box&&box.height>=(width<1000?44:40));}
            if(!quotaRefreshes){await dialog.getByRole('button',{name:'Refresh Codex quota',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.quota-codex button')?.textContent?.startsWith('Refresh in'));}
            assert.equal(quotaRefreshes,1,'opening dialog never refreshes runners automatically');
            if(!claudeQuotaRefreshes){await dialog.getByRole('button',{name:'Refresh Claude quota',exact:true}).click();await dialog.getByRole('status').getByText('No quota event arrived. Previous snapshot kept.',{exact:true}).waitFor();assert.equal(await dialog.getByRole('progressbar').count(),3);}
            assert.equal(claudeQuotaRefreshes,1,'no automatic Claude refresh or silent retry');
            const proof=process.env.DECK_QUOTA_EVIDENCE??'/tmp/deck-quota';mkdirSync(proof,{recursive:true});await page.screenshot({path:`${proof}/${width}.png`});
            await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
            assert.deepEqual(await rect('#conversation'),chat,'quota modal does not move the conversation');
            await open();await dialog.waitFor();await page.mouse.click(2,2);await dialog.waitFor({state:'hidden'});
            await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),width<1000?'Open sessions':'Deck menu');
        }
    });
    await check('composer floats over scroll-under conversation with measured multiline growth at 320, 390 and 1440',async()=>{
        for(const width of [320,390,1440]){
            await page.setViewportSize({width,height:844});await select('one');
            const viewport=page.locator('#conversation'),input=page.locator('#prompt');
            const bottom=()=>page.waitForFunction(()=>{const el=document.getElementById('conversation')!;return el.scrollHeight-el.scrollTop-el.clientHeight<2;},null,{timeout:3000});
            const pane=await rect('.chat-pane'),before=await rect('#conversation'),single=await rect('.composer');
            assert.equal(before.y+before.height,pane.y+pane.height,'conversation extends under the composer to the pane bottom');
            assert(single.y>before.y&&single.y+single.height<=before.y+before.height,'composer overlays the conversation');
            const last=()=>rect('.history-row:last-child');
            const visibleTail=async()=>{const row=await last(),box=await rect('.composer');assert(row.y+row.height<=box.y,`last message is covered at ${width}: ${JSON.stringify({row,box})}`);};
            // Establish explicit following through the same Jump action used by readers.
            await viewport.evaluate(el=>el.scrollTop=el.scrollHeight-el.clientHeight-200);
            await page.locator('.jump-latest').waitFor();await page.locator('.jump-latest').click();
            await bottom();await visibleTail();
            await input.fill('Line one\nLine two\nLine three\nLine four');await page.waitForTimeout(120);
            const multi=await rect('.composer');assert(multi.height>single.height,'composer grows to fit four lines');
            assert.deepEqual(await rect('#conversation'),before,'growth reserves scroll padding, not layout space');
            assert.equal(multi.y+multi.height,single.y+single.height,'composer bottom stays attached');
            await bottom();await visibleTail();
            const measured=await page.locator('.composer-dock').evaluate(el=>({height:el.getBoundingClientRect().height,padding:parseFloat(getComputedStyle(document.getElementById('conversation')!).paddingBottom)}));
            assert(measured.padding>=measured.height,'scroll padding includes measured composer and safe-area gap');
            await separate(['.composer','.chat-pane .context-window']);
            await input.fill('Line one\nLine two\nLine three\nLine four\nLine five\nLine six');await page.waitForTimeout(100);
            assert(Math.abs((await rect('.composer')).height-multi.height)<1,'input caps growth at four visible lines (subpixel line rounding)');
            await bottom();await visibleTail();
            await page.screenshot({path:`/tmp/deck-floating-composer-multiline-${width}.png`});
            // Scroll messages behind the box: it is an overlay, without an opaque surrounding band.
            await viewport.evaluate(el=>el.scrollTop-=110);await page.waitForTimeout(120);
            const underneath=await last();assert(underneath.y+underneath.height>multi.y,'history can scroll beneath the composer');
            const reading=await viewport.evaluate(el=>{el.scrollTop=el.scrollHeight-el.clientHeight-600;return el.scrollTop;});
            await page.waitForTimeout(120);await input.fill('Short draft');await page.waitForTimeout(120);
            assert(Math.abs(await viewport.evaluate(el=>el.scrollTop)-reading)<2,'shrinking preserves the reading position');
            await separate(['.composer','.jump-latest','.chat-pane .context-window']);
            await page.locator('.jump-latest').click();await bottom();await visibleTail();
            // Viewport contraction exercises the existing virtual-keyboard attachment.
            if(width<1000){
                await input.focus();await page.setViewportSize({width,height:520});await page.waitForTimeout(150);
                const keyboardBox=await rect('.composer');assert(keyboardBox.y+keyboardBox.height<=520,'composer stays above keyboard');
                await bottom();await visibleTail();
                await page.setViewportSize({width,height:844});await page.waitForTimeout(150);await bottom();
                assert.deepEqual(await rect('#conversation'),before,'keyboard dismissal restores geometry');
                assert((await rect('.composer-actions button:last-child')).height>=44);
            }
            await page.screenshot({path:`/tmp/deck-floating-composer-${width}.png`});
        }
        await page.setViewportSize({width:1440,height:1000});await select('one');
    });
    await check('unread reply control is removed',async()=>{
        assert.equal(await page.getByRole('button',{name:/unread repl/}).count(),0);
        assert.equal(inboxRequests,0,'removed inbox must not poll');
    });
    await check('context and Lead status float without reserving a row at 320, 390 and 1440',async()=>{
        for(const width of [320,390,1440]){
            await page.setViewportSize({width,height:844});await select('one');
            const pill=page.locator('.chat-pane .lead-progress .context-window');
            assert(await pill.evaluate(el=>!!el.closest('.conversation-feedback')),'context must live in the zero-height overlay');
            assert.equal((await rect('.conversation-feedback')).height,0);
            const geometry=()=>Promise.all(['#conversation','.composer'].map(rect));
            const before=await geometry();
            // Removing the entire status/context surface must free no layout space.
            await page.locator('.chat-pane .lead-progress').evaluate(el=>(el as HTMLElement).style.display='none');
            assert.deepEqual(await geometry(),before);
            await page.locator('.chat-pane .lead-progress').evaluate(el=>(el as HTMLElement).style.removeProperty('display'));
            if(width<=1000)assert((await pill.boundingBox())!.height>=44);
            await pill.click();await page.getByRole('dialog',{name:'Lead context',exact:true}).waitFor();
            await page.getByText('273,000',{exact:false}).last().waitFor();
            await page.keyboard.press('Escape');assert(await pill.evaluate(el=>document.activeElement===el));
            await page.locator('#conversation').evaluate(el=>el.scrollTop=200);await page.locator('.jump-latest').waitFor();
            await page.evaluate(()=>{
                const ws=(window as any).__sockets.findLast((ws:WebSocket)=>ws.url.includes('/sessions/one/events'));
                for(const event of [
                    {seq:42,kind:'turn.started',data:{}},
                    {seq:43,kind:'tool.started',data:{toolUseId:'long-tool',toolName:'Inspect the project and all current workspace changes'}},
                    {seq:44,kind:'usage',data:{attempt:1,context:{basis:'codex-last-total',tokens:999999,capacity:1000000,nativeThreadId:'fixture-thread',nativeTurnId:'fixture-turn'}}},
                ])ws.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'event',event:{v:1,sessionId:'one',ts:'2026-01-01T00:00:00Z',source:{taskId:'lead',memberId:'lead',runnerId:'codex',nativeSessionId:'fixture-thread'},...event}})}));
            });
            await page.locator('.chat-pane .lead-progress[data-phase=tool]').waitFor();await page.waitForTimeout(100);
            assert.deepEqual(await geometry(),before);
            await separate(['.chat-pane .lead-progress-status','.chat-pane .context-window','.jump-latest','.composer']);
            const contextBox=await pill.boundingBox(),stack=await rect('.conversation-float-stack');assert(contextBox);
            assert(Math.abs(contextBox.x+contextBox.width-(stack.x+stack.width))<1,'context aligns bottom-right');
            assert(contextBox.y>=0&&contextBox.x>=0&&contextBox.x+contextBox.width<=width);
            await page.screenshot({path:`/tmp/deck-floating-context-${width}.png`});
            if(width<=1000){
                await page.getByRole('tab',{name:'Activity',exact:true}).click();
                await page.locator('.mobile-progress .context-window').waitFor();assert(await page.locator('.chat-pane').isHidden());
                await page.getByRole('tab',{name:'Chat',exact:true}).click();await pill.waitFor();
            }
        }
    });
    await check('sending follows latest after tiny gestures and history reading at 390 and 1440',async()=>{
        for(const width of [390,1440]){
            for(const gesture of ['wheel','touch','ArrowUp'] as const){
                await page.setViewportSize({width,height:844});await select('one');
                let seq=41;
                const frame=(text:string,role='assistant')=>{
                    const event={v:1,sessionId:'one',seq:++seq,ts:'2026-01-01T00:00:00Z',kind:'message.completed',source:role==='user'?{}:{taskId:'lead',memberId:'lead'},data:{role,text,...(role==='user'?{promptId:`sent-${seq}`,handoff:'pending'}:{})}};
                    return {type:'event',event,message:{...event,historyId:seq}};
                };
                const emit=async(data:ReturnType<typeof frame>)=>page.evaluate(data=>{
                    (window as any).__sockets.findLast((ws:WebSocket)=>ws.url.includes('/sessions/one/events')).dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));
                },data);
                promptEffect=async text=>emit(frame(text,'user'));
                const viewport=page.locator('#conversation');
                const bottom=()=>page.waitForFunction(()=>{const el=document.getElementById('conversation')!;return el.scrollHeight-el.scrollTop-el.clientHeight<2;},null,{timeout:3000});
                const position=()=>viewport.evaluate(el=>{
                    const top=el.getBoundingClientRect().top,row=[...el.querySelectorAll<HTMLElement>('[data-history-id]')].find(row=>row.getBoundingClientRect().bottom>top)!;
                    return {id:row.dataset.historyId,offset:row.getBoundingClientRect().top-top,scroll:el.scrollTop};
                });
                // Establish a real reading anchor first, then return to the bottom.
                await viewport.evaluate(el=>el.scrollTop=el.scrollHeight-el.clientHeight-400);await page.locator('.jump-latest').waitFor();
                await viewport.evaluate(el=>el.scrollTop=el.scrollHeight);await page.locator('.jump-latest').waitFor({state:'hidden'});
                await page.locator('#prompt').fill(`Own send after ${gesture} at ${width}`);
                // Race an incoming frame with a 1px upward gesture, before the browser's scroll event.
                await page.evaluate(({gesture,data})=>{
                    const el=document.getElementById('conversation')!;
                    if(gesture==='wheel')el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-1}));
                    else if(gesture==='touch'){
                        const touch=(clientY:number)=>new Touch({identifier:1,target:el,clientX:100,clientY});
                        el.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[touch(200)]}));
                        el.dispatchEvent(new TouchEvent('touchmove',{bubbles:true,touches:[touch(201)]}));
                    }else el.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'ArrowUp'}));
                    el.scrollTop-=1;
                    (window as any).__sockets.findLast((ws:WebSocket)=>ws.url.includes('/sessions/one/events')).dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));
                },{gesture,data:frame('Incoming at the bottom')});
                await page.locator('#message-42').waitFor({timeout:3000});await bottom();
                await page.getByRole('button',{name:'Send prompt',exact:true}).click();await page.locator('#message-43').waitFor({timeout:3000});await bottom();
                assert.match(await page.locator('#message-43').innerText(),/Sending…/);
                // Incoming work must preserve the exact reading position, including row resizes.
                await viewport.evaluate(el=>el.scrollTop=el.scrollHeight-el.clientHeight-600);await page.locator('.jump-latest').waitFor();
                const before=await position();
                await emit(frame('Incoming while reading history'));
                const resized=frame('Resized first message. '.repeat(40));resized.message.historyId=2;await emit(resized);
                await page.waitForTimeout(150);
                const after=await position();assert.equal(after.id,before.id);assert(Math.abs(after.offset-before.offset)<2,`history anchor moved at ${width}/${gesture}: ${JSON.stringify({before,after})}`);
                await page.locator('#prompt').fill(`Own send from history at ${width}`);await page.getByRole('button',{name:'Send prompt',exact:true}).click();
                await page.getByText(`Own send from history at ${width}`,{exact:true}).waitFor({timeout:3000});await bottom();
                if(gesture==='wheel'){
                    // Retrying an older unconfirmed bubble also returns to latest; it never auto-sends.
                    const retry=frame('Earlier unconfirmed message','user');retry.message.historyId=20;retry.message.data.handoff='unknown';await emit(retry);
                    await page.getByRole('button',{name:'Send again',exact:true}).scrollIntoViewIfNeeded();
                    const sentBefore=sent;await page.getByRole('button',{name:'Send again',exact:true}).click();await bottom();assert.equal(sent,sentBefore);
                    assert.equal(await page.locator('#prompt').inputValue(),'Earlier unconfirmed message');
                    const next=seq+1;await page.getByRole('button',{name:'Send prompt',exact:true}).click();await page.locator(`#message-${next}`).waitFor({timeout:3000});await bottom();
                }
            }
        }
        promptEffect=undefined;sent=0;await page.setViewportSize({width:1440,height:1000});await select('one');
    });
    await check('floating controls and session chevron stay stable at 390, 320 and 1440',async()=>{
        for(const width of [390,320,1440]){
            await page.setViewportSize({width,height:844});await select('one');
            const geometry=()=>Promise.all(['.app-header','#conversation','.composer','.view-nav'].map(rect));
            await page.locator('#conversation').evaluate(el=>el.scrollTop=el.scrollHeight);
            await page.locator('.jump-latest').waitFor({state:'hidden'});
            const before=await geometry();
            assert.equal(await page.getByRole('button',{name:/unread repl/}).count(),0);
            assert.equal(await page.locator('.conversation-float-actions').count(),0,'no empty floating row at latest');
            assert.equal((await rect('.conversation-float-stack')).height,(await rect('.chat-pane .lead-progress')).height,'only the context pill floats at latest');
            await page.locator('#conversation').evaluate(el=>el.scrollTop=200);await page.locator('.jump-latest').waitFor();
            assert.match(await page.locator('.lead-progress .context-window').innerText(),/273k \/ 1m/);
            await separate(['.jump-latest','.lead-progress .context-window','.composer']);
            const gap=await page.locator('.conversation-float-stack').evaluate(el=>parseFloat(getComputedStyle(el).rowGap));
            assert.equal((await rect('.conversation-float-stack')).height,(await rect('.jump-latest')).height+(await rect('.chat-pane .lead-progress')).height+gap,'only Jump and context rows float');
            if(width<=1000){
                assert((await rect('.jump-latest')).height>=44);assert((await rect('.view-nav')).height<60);
                const session=page.locator('.session-compact-toggle'),closed=await session.boundingBox();assert(closed&&closed.height>=44);
                const chevron=page.locator('.session-compact-chevron');assert.equal(await chevron.evaluate(el=>getComputedStyle(el).transform),'none');
                await session.click();await page.locator('.session-controls-panel').waitFor();await page.waitForTimeout(200);
                assert.equal(await session.getAttribute('aria-expanded'),'true');assert.match(await chevron.evaluate(el=>getComputedStyle(el).transform),/^matrix\(-1, 0, 0, -1/);
                assert.deepEqual(await session.boundingBox(),closed);assert.deepEqual(await geometry(),before);
                await page.keyboard.press('Escape');assert.equal(await session.getAttribute('aria-expanded'),'false');
                await page.emulateMedia({reducedMotion:'reduce'});
                assert.equal(await chevron.evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
                await page.emulateMedia({reducedMotion:'no-preference'});
            }
            assert.deepEqual(await geometry(),before);await page.screenshot({path:`/tmp/deck-floating-controls-${width}.png`});
            await page.locator('.jump-latest').click();await page.locator('.jump-latest').waitFor({state:'hidden'});
            assert.equal(await page.locator('.conversation-float-actions').count(),0);assert.deepEqual(await geometry(),before);
            assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        }
        await page.setViewportSize({width:1440,height:1000});await select('one');
    });
    await check('focus and visibility return keep the healthy stream',async()=>{
        const requests=historyRequests,connections=sockets;
        await page.evaluate(()=>{window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pageshow'));window.dispatchEvent(new Event('online'));});
        await page.waitForTimeout(500);assert.equal(historyRequests,requests);assert.equal(sockets,connections);
    });
    await check('sidebar hover changes paint only',async()=>{
        const target=page.locator('.sidebar .session').first(),before=await target.boundingBox();await target.hover();await page.waitForTimeout(220);assert.deepEqual(await target.boundingBox(),before);
    });
    await check('notifications menu dialog preserves settings, attention and focus at 390, 320 and 1440',async()=>{
        for(const width of [390,320,1440]){
            pushEnabled=false;await page.setViewportSize({width,height:844});await select('one');
            const mobile=width<=1000,trigger=page.getByRole('button',{name:mobile?'Open sessions':'Deck menu',exact:true});
            assert.equal(await page.locator('.app-header [aria-label="Notifications"]').count(),0);
            await trigger.locator('.menu-attention').waitFor();
            if(!mobile){await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();assert(await trigger.locator('.menu-attention').isVisible());await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();}
            const requests=await page.evaluate(()=>(window as any).__permissionRequests);await trigger.click();
            const menu=mobile?page.locator('.session-drawer'):page.getByRole('menu',{name:'Deck',exact:true});
            const action=menu.getByRole(mobile?'button':'menuitem',{name:/Notifications/});assert.match(await action.innerText(),/Off/);
            await action.click();const dialog=page.getByRole('dialog',{name:'Notifications',exact:true});await dialog.waitFor();assert.equal(await menu.isVisible(),false);
            assert.match(await dialog.innerText(),/authorization expired/);assert.equal(await page.evaluate(()=>(window as any).__permissionRequests),requests);
            await dialog.getByRole('button',{name:'Enable notifications',exact:true}).click();await dialog.getByText('On for this browser',{exact:true}).waitFor();assert(pushEnabled);
            assert.equal(await page.evaluate(()=>(window as any).__permissionRequests),requests+1);await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert(await trigger.evaluate(el=>el===document.activeElement));assert.equal(await trigger.locator('.menu-attention').count(),0);
            await trigger.click();await menu.getByRole(mobile?'button':'menuitem',{name:/Notifications/}).click();await dialog.waitFor();await dialog.getByRole('button',{name:'Disable notifications',exact:true}).click();await dialog.getByText('Off for this browser',{exact:true}).waitFor();assert(!pushEnabled);
            const bounds=await dialog.boundingBox();assert(bounds&&bounds.x>=0&&bounds.x+bounds.width<=width);if(mobile)assert((await dialog.getByRole('button',{name:'Done',exact:true}).boundingBox())!.height>=44);
            await page.screenshot({path:`/tmp/deck-notifications-dialog-${width}.png`});await page.mouse.click(1,1);await dialog.waitFor({state:'hidden'});assert(await trigger.evaluate(el=>el===document.activeElement));
            await page.evaluate(()=>{Object.defineProperty(Notification,'permission',{configurable:true,get:()=>'denied'});window.dispatchEvent(new Event('focus'));});await trigger.locator('.menu-attention').waitFor();await trigger.click();await menu.getByRole(mobile?'button':'menuitem',{name:/Notifications/}).click();await dialog.getByText('Blocked in browser settings',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Done',exact:true}).click();await dialog.waitFor({state:'hidden'});
        }
        await page.setViewportSize({width:1440,height:1000});await select('one');
    });
    await check('outside dismissal preserves a Send click while summary requests are slow',async()=>{
        await page.locator('#prompt').fill('Send through outside dismissal');await page.getByRole('button',{name:'Deck menu',exact:true}).click();await page.getByRole('menu',{name:'Deck',exact:true}).waitFor();await page.waitForTimeout(400);summaryDelay=300;
        const button=await page.getByRole('button',{name:'Send prompt',exact:true}).boundingBox();assert(button);await page.mouse.move(button.x+button.width/2,button.y+button.height/2);await page.mouse.down();await page.waitForTimeout(60);await page.mouse.up();
        await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('#prompt')?.value==='',null,{timeout:3000});assert.equal(sent,1);sent=0;summaryDelay=0;
    });
    await check('permissions are an overlay and dismiss with pointerdown and Escape',async()=>{
        const toggle=page.locator('.session-permissions > summary'),before=await rect('#conversation');await toggle.click();await page.locator('.session-permissions-panel').waitFor();assert.deepEqual(await rect('#conversation'),before);
        await page.locator('.app-header h1').dispatchEvent('pointerdown');await page.locator('.session-permissions-panel').waitFor({state:'hidden'});await toggle.click();await page.keyboard.press('Escape');await page.locator('.session-permissions-panel').waitFor({state:'hidden'});assert(await toggle.evaluate(el=>el===document.activeElement));
    });
    await check('Deck theme choices and MCP share the menu surface',async()=>{
        const toggle=page.getByRole('button',{name:'Deck menu',exact:true});await toggle.click();const menu=page.getByRole('menu',{name:'Deck',exact:true});await menu.waitFor();
        const style=await menu.evaluate(el=>{const s=getComputedStyle(el);return {bg:s.backgroundColor,radius:s.borderRadius,shadow:s.boxShadow};});assert.equal(style.radius,'8px');
        const choice=menu.getByRole('menuitem',{name:/^Theme/});assert.equal(await choice.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),await page.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).fontSize)*.8));assert((await choice.boundingBox())!.height>=40);
        await page.locator('.app-header h1').dispatchEvent('pointerdown');await menu.waitFor({state:'hidden'});await toggle.click();await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
        await page.getByRole('button',{name:'MCP servers',exact:true}).click();const panel=page.getByRole('dialog',{name:'MCP servers',exact:true});await panel.waitFor();assert.deepEqual(await panel.evaluate(el=>{const s=getComputedStyle(el);return {bg:s.backgroundColor,radius:s.borderRadius,shadow:s.boxShadow};}),style);
        await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
    });
    await check('theme dialog search, keyboard, reveal and mobile focus return',async()=>{
        const picker=page.getByRole('dialog',{name:'Theme',exact:true});
        for(const width of [1440,768,390,320]){
            await page.setViewportSize({width,height:844});
            const mobile=width<=1000;
            const trigger=page.getByRole('button',{name:mobile?'Open sessions':'Deck menu',exact:true});
            await trigger.click();
            const container=mobile?page.locator('.session-drawer'):page.getByRole('menu',{name:'Deck',exact:true});
            await container.getByRole(mobile?'button':'menuitem',{name:/^Theme/}).click();
            await picker.waitFor();
            assert.equal(await container.isVisible(),false,'navigation closes before picker opens');
            const search=picker.getByRole('combobox',{name:'Search themes'});
            assert(await search.evaluate(el=>el===document.activeElement),'search autofocus');
            await search.fill('NOT A THEME');await picker.getByRole('status').getByText('No themes match').waitFor();
            assert.equal(await picker.getByRole('option').count(),0);
            await search.fill(' gÍthub dark ');assert.equal(await picker.getByRole('option').count(),1);
            await page.keyboard.press('Enter');
            await page.waitForFunction(()=>document.documentElement.dataset.theme==='github');
            await picker.getByRole('option',{name:'GitHub Dark',exact:true}).getAttribute('aria-selected').then(value=>assert.equal(value,'true'));
            assert(await picker.isVisible(),'selection keeps picker open');
            await search.fill('');await page.keyboard.press('End');
            assert.match((await search.getAttribute('aria-activedescendant'))!,new RegExp(`-${THEMES.at(-1)!.id}$`));
            await page.keyboard.press('Home');assert.match((await search.getAttribute('aria-activedescendant'))!,/-dark$/);
            await page.keyboard.press('ArrowDown');assert.match((await search.getAttribute('aria-activedescendant'))!,/-light$/);
            await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');
            await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
            // Inspect the actual root snapshot animation while the modal is in the top layer.
            if(width===1440){
                await page.waitForFunction(()=>document.getAnimations().some(a=>(a.effect as KeyframeEffect)?.pseudoElement==='::view-transition-new(root)'));
                await page.evaluate(()=>{for(const a of document.getAnimations())if((a.effect as KeyframeEffect)?.pseudoElement==='::view-transition-new(root)'){a.pause();a.currentTime=200;}});
                await page.screenshot({path:'/tmp/deck-theme-dialog-reveal.png'});
                await page.evaluate(()=>{for(const a of document.getAnimations())if(a.playState==='paused')a.play();});
            }
            await page.waitForTimeout(1100);
            const option=picker.getByRole('option').first();assert((await option.boundingBox())!.height>=(mobile?44:40));
            const bounds=await picker.boundingBox();assert(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width);
            assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
            await page.screenshot({path:`/tmp/deck-theme-dialog-${width}.png`});
            await picker.getByRole('option',{name:'Green',exact:true}).click();
            const list=picker.getByRole('listbox');assert(await list.evaluate(el=>el===document.activeElement));
            await page.keyboard.press('ArrowDown');assert.match((await list.getAttribute('aria-activedescendant'))!,/-eva01$/);
            await page.keyboard.press('Enter');await page.waitForFunction(()=>document.documentElement.dataset.theme==='eva01');
            // Native dialogs may put focus in browser chrome at the tab boundary, never in the inert app.
            for(let i=0;i<6;i++){await page.keyboard.press('Tab');assert(await picker.evaluate(el=>el.contains(document.activeElement)||document.activeElement===document.body),'background remains inert');}
            await search.fill('dárk');await page.keyboard.press('Escape');await picker.waitFor({state:'hidden'});
            assert(await trigger.evaluate(el=>el===document.activeElement),'focus returns to visible trigger');
            await selectTheme(page,'light');
            assert.equal(await page.evaluate(()=>localStorage.getItem('deck.theme')),'light');
            await selectTheme(page,'dark');
        }
        await page.setViewportSize({width:1440,height:1000});
    });
    await check('session switch reserves header controls and composer geometry',async()=>{
        const before=await Promise.all(['.app-header','.app-header h1','#conversation','.composer'].map(rect));
        await page.evaluate(()=>{(window as any).__samples=[];const start=performance.now();function sample(){(window as any).__samples.push(['.app-header','.app-header h1','#conversation','.composer'].map(selector=>{const r=document.querySelector(selector)?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null}));if(performance.now()-start<1200)requestAnimationFrame(sample);}sample();});
        await page.getByRole('button',{name:'Deck menu',exact:true}).click();await page.getByRole('menu',{name:'Deck',exact:true}).waitFor();
        await page.locator('.sidebar [data-session-id="two"] .session').click();await page.waitForTimeout(1300);
        const samples=await page.evaluate(()=>(window as any).__samples) as (typeof before|null[])[];
        for(const sample of samples)for(let i=0;i<before.length;i++){assert(sample[i],`missing box ${i}`);for(const axis of ['x','y','width','height'] as const){if(i===1&&axis==='width')continue;assert(Math.abs(sample[i]![axis]-before[i]![axis])<1.1,`box ${i} ${axis}: ${JSON.stringify(sample)} vs ${JSON.stringify(before)}`);}}
        assert.equal(await page.locator('.app-header h1').innerText(),'Second session with a longer name');
        assert.equal(await page.getByRole('button',{name:'Reconnect',exact:true}).count(),0);
    });
    await check('session geometry remains stable at laptop and mobile widths',async()=>{
        for(const width of [1100,390,320]){
            await page.setViewportSize({width,height:844});await select('one');
            if(width<=1000)await page.getByRole('button',{name:'Open sessions',exact:true}).click();
            const before=await Promise.all(['.app-header','.app-header h1','#conversation','.composer'].map(rect));
            await page.evaluate(()=>{(window as any).__samples=[];const start=performance.now();function sample(){(window as any).__samples.push(['.app-header','.app-header h1','#conversation','.composer'].map(selector=>{const r=document.querySelector(selector)?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null}));if(performance.now()-start<1200)requestAnimationFrame(sample);}sample();});
            await page.locator(width<=1000?'.session-drawer [data-session-id="two"] .session':'.sidebar [data-session-id="two"] .session').click();await page.waitForTimeout(1300);
            const samples=await page.evaluate(()=>(window as any).__samples) as (typeof before|null[])[];
            for(const sample of samples)for(let i=0;i<before.length;i++){assert(sample[i],`missing box ${i} at ${width}`);for(const axis of ['x','y','width','height'] as const)assert(Math.abs(sample[i]![axis]-before[i]![axis])<1.1,`width ${width}, box ${i} ${axis}: ${JSON.stringify(sample)} vs ${JSON.stringify(before)}`);}
        }
    });
    await page.setViewportSize({width:1440,height:844});
    await check('one tap Jump to latest works at desktop and mobile edges',async()=>{
        for(const width of [1440,390,320]){
            await page.setViewportSize({width,height:844});await page.locator('#conversation').evaluate(el=>el.scrollTop=200);await page.locator('.jump-latest').waitFor();await page.waitForTimeout(350);
            if(width===1440)await selectTheme(page,'green');
            const box=await page.locator('.jump-latest').boundingBox();assert(box);const requests=historyRequests;
            await page.touchscreen.tap(box.x+box.width-3,box.y+box.height/2);await page.waitForTimeout(600);assert(historyRequests>requests,`tap was swallowed at ${width}`);await page.locator('.jump-latest').waitFor({state:'hidden'});
        }
    });
    await page.setViewportSize({width:1440,height:1000});
    await check('folder suggestions overlay and dismiss without moving submit',async()=>{
        await page.locator('.sidebar').getByRole('button',{name:'Add project',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Add project',exact:true});await dialog.waitFor();await page.waitForTimeout(350);
        const submit=dialog.getByRole('button',{name:'Add project',exact:true}),before=await submit.boundingBox();await dialog.getByLabel('Show folders',{exact:true}).click();await page.locator('.directory-options [role="option"]').waitFor();assert.deepEqual(await submit.boundingBox(),before);
        await dialog.getByRole('heading').dispatchEvent('pointerdown');assert.equal(await dialog.getByRole('combobox').getAttribute('aria-expanded'),'false');await dialog.getByLabel('Show folders',{exact:true}).click();await page.keyboard.press('Escape');assert.equal(await dialog.getByRole('combobox').getAttribute('aria-expanded'),'false');assert(await dialog.isVisible());await page.keyboard.press('Escape');
    });
    await check('disconnect keeps draft and shows reconnect only after a send attempt',async()=>{
        for(const width of [390,320,1440]){
            approvalVisible=true;await page.setViewportSize({width,height:844});await select('one');
            await page.locator('#conversation').evaluate(el=>el.scrollTop=200);await page.locator('.jump-latest').waitFor();
            const draft='Keep this draft\nLine two\nLine three\nLine four';
            await page.locator('#prompt').fill(draft);offline=true;
            await page.evaluate(()=>{for(const socket of (window as any).__sockets??[])socket.close();});
            await page.waitForTimeout(100);const before=await rect('.composer');assert.equal(await page.getByRole('button',{name:'Reconnect',exact:true}).count(),0);assert.equal(await page.locator('#prompt').inputValue(),draft);
            const previous=sent;
            await page.getByRole('button',{name:'Send prompt',exact:true}).click();await page.locator('.composer-reconnect').waitFor();assert.equal(sent,previous);assert.deepEqual(await rect('.composer'),before);
            // All floating surfaces can coexist, including a pending request
            // received just before the transport disconnected.
            await page.locator('.conversation-float-stack .approvals.pending').waitFor();
            await separate(['.approvals.pending','.jump-latest','.chat-pane .lead-progress-status','.lead-progress .context-window','.composer','.composer-reconnect']);
            assert((await rect('.approvals.pending')).y>=0,'combined floating stack stays in viewport');
            await page.screenshot({path:`/tmp/deck-floating-reconnect-${width}.png`});
            await page.waitForTimeout(1700);assert.match(await page.locator('.connection-label').innerText(),/Reconnecting|Disconnected/);assert.deepEqual(await rect('.composer'),before);
            offline=false;await page.getByRole('button',{name:'Reconnect',exact:true}).click();await page.locator('.composer-reconnect').waitFor({state:'hidden'});assert.equal(await page.locator('#prompt').inputValue(),draft);
            await page.getByRole('button',{name:'Send prompt',exact:true}).click();await page.waitForFunction(()=>document.querySelector<HTMLTextAreaElement>('#prompt')?.value==='');assert.equal(sent,previous+1);
        }
        approvalVisible=false;await page.setViewportSize({width:1440,height:1000});

    });
    await check('floating approvals stack without shifting or covering controls at 390, 320 and 1440',async()=>{
        for(const width of [390,320,1440]){
            await page.setViewportSize({width,height:844});approvalVisible=false;await select('one');
            await page.locator('#conversation').evaluate(el=>el.scrollTop=200);await page.locator('.jump-latest').waitFor();
            const geometry=()=>Promise.all(['.app-header','#conversation','.composer','.view-nav'].map(rect));
            await page.locator('#prompt').fill('Keep typing');const before=await geometry();
            await page.evaluate(()=>{const ws=(window as any).__sockets.findLast((ws:WebSocket)=>ws.url.includes('/sessions/one/events'));for(let i=0;i<2;i++)ws.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'event',event:{v:1,sessionId:'one',seq:42+i,ts:'2026-01-01T00:00:00Z',source:{taskId:'lead',memberId:'lead'},kind:'approval.requested',data:{approvalId:`live-${i}`,tool:i?'Write':'Read',toolKey:'codex:Read',exactKey:'README.md',summary:'Review this file action',risk:'high',allowedScopes:['once','session'],grantKinds:['exact','tool']}}})}));});
            await page.getByText('Approval needed · 1 of 2',{exact:true}).waitFor();
            assert.deepEqual(await geometry(),before);assert(await page.locator('#prompt').evaluate(el=>document.activeElement===el),'typing focus is preserved');
            await separate(['.approvals.pending','.jump-latest','.lead-progress .context-window','.composer']);
            const bounds=await rect('.approvals.pending');assert(bounds.y>=0&&bounds.x>=0&&bounds.x+bounds.width<=width);
            await page.getByRole('button',{name:'Next request',exact:true}).click();await page.getByText('Approval needed · 2 of 2',{exact:true}).waitFor();
            assert.equal(await page.locator('.approval').count(),1);await page.getByRole('button',{name:'Previous request',exact:true}).click();await page.waitForTimeout(400);
            if(width<=1000)for(const selector of ['.approval-actions > button','.approval-scope-menu > summary'])for(const button of await page.locator(selector).all())assert((await button.boundingBox())!.height>=44,JSON.stringify(await button.evaluate(el=>({html:el.outerHTML,height:el.getBoundingClientRect().height,min:getComputedStyle(el).minHeight,box:getComputedStyle(el).boxSizing}))))
            await page.screenshot({path:`/tmp/deck-floating-approval-${width}.png`});
            if(width<=1000){await page.getByRole('tab',{name:'Activity',exact:true}).click();await page.locator('.mobile-approval-overlay .approvals.pending').waitFor();assert((await rect('.mobile-approval-overlay')).y>0);await page.getByRole('tab',{name:'Chat',exact:true}).click();await page.locator('.conversation-float-stack .approvals.pending').waitFor();}

            await page.evaluate(()=>{for(let i=0;i<2;i++)(window as any).__sockets.findLast((ws:WebSocket)=>ws.url.includes('/sessions/one/events')).dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'event',event:{v:1,sessionId:'one',seq:44+i,ts:'2026-01-01T00:00:00Z',source:{},kind:'approval.resolved',data:{approvalId:`live-${i}`,decision:'deny'}}})}));});
            await page.locator('.approvals.pending').waitFor({state:'hidden'});assert.deepEqual(await geometry(),before);
        }
        await page.setViewportSize({width:1440,height:1000});await select('one');
    });
    await check('approval scope menu overlays the bounded panel and dismisses consistently',async()=>{
        approvalVisible=true;await select('one');const toggle=page.locator('.approval-scope-menu > summary'),before=await rect('#conversation');await toggle.click();await page.locator('.approval-scope-choices').waitFor();assert.deepEqual(await rect('#conversation'),before);
        const box=await page.locator('.approval-scope-choices').boundingBox();assert(box&&box.y>=8&&box.y+box.height<=1000);await page.locator('.app-header h1').dispatchEvent('pointerdown');await page.locator('.approval-scope-choices').waitFor({state:'hidden'});
        await toggle.click();await page.setViewportSize({width:1400,height:1000});await page.locator('.approval-scope-choices').waitFor({state:'hidden'});
        await page.setViewportSize({width:1440,height:1000});await toggle.click();await page.keyboard.press('Escape');await page.locator('.approval-scope-choices').waitFor({state:'hidden'});approvalVisible=false;
    });
    await check('Prepare session remains separate from transport reconnect',async()=>{
        await page.goto(`${server.url}?session=unprepared`);await page.getByRole('button',{name:'Prepare session',exact:true}).last().waitFor();await page.waitForTimeout(600);assert.equal(await page.locator('.composer').count(),0);assert.equal(await page.getByRole('button',{name:'Reconnect',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Prepare session',exact:true}).last().isEnabled(),true);
    });
    if(process.env.DECK_LAYOUT_EVIDENCE){
        const evidence=process.env.DECK_LAYOUT_EVIDENCE;mkdirSync(evidence,{recursive:true});
        await select('one');
        for(const width of [1440,390,320]){await page.setViewportSize({width,height:844});await page.waitForTimeout(350);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${evidence}/layout-${width}.png`});}
    }
    assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,errors}));
}catch(error){console.error({geometry:await page.evaluate(()=>{const el=document.getElementById('conversation');return {url:location.href,scrollTop:el?.scrollTop,scrollHeight:el?.scrollHeight,clientHeight:el?.clientHeight,jump:document.querySelector('.jump-latest')?.getBoundingClientRect().toJSON(),dock:document.querySelector('.composer-dock')?.getBoundingClientRect().toJSON()};}),errors,body:(await page.locator('body').innerText()).slice(0,1400)});throw error;}finally{await browser.close();server.stop(true);}
