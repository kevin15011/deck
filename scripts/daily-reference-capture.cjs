// Original Deck1 components in an isolated public synthetic fixture; never shipped or written to Deck1.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),http=require('http'),{spawnSync}=require('child_process'),assert=require('assert/strict');
const repo=path.resolve(__dirname,'..'),out=path.join(repo,'target/daily52/reference'),source='/home/kevin15011/deck/apps/web/src';fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'entry.tsx'),`
import React from '/home/kevin15011/deck/apps/web/node_modules/react/index.js';
import {createRoot} from '/home/kevin15011/deck/apps/web/node_modules/react-dom/client.js';
import {Subagents} from '${source}/workspace';
import {ContextWindowIndicator,projectContextWindows} from '${source}/context-window';
import {QuotaSectionView} from '${source}/quota';
import {SecondaryInfoProvider} from '${source}/secondary-info';
import '${source}/style.css';
const events:any[]=[],tasks:any={};
for(const [taskId,memberId,tokens,state] of [['lead','lead',34794,'completed'],['alpha','investigate',70000,'completed'],['beta','quality',100000,'failed']]){
 const source={taskId,memberId,runnerId:'codex',nativeSessionId:'thread-'+taskId};
 const add=(kind:string,data:any)=>events.push({v:1,sessionId:'daily',seq:events.length+1,ts:'2026-11-12T16:00:00Z',kind,source,data});
 add('task.created',{attempt:1,state:'running',modelId:'gpt-6.1-sol'});add('turn.started',{attempt:1,nativeTurnId:'turn'});
 add('usage',{attempt:1,context:{basis:'codex-last-total',tokens,capacity:258400,nativeThreadId:source.nativeSessionId,nativeTurnId:'turn',modelId:'gpt-6.1-sol'}});
 add('message.completed',{attempt:1,role:'assistant',text:'Live '+taskId+' conversation'});add('task.result',{attempt:1,summary:'Live '+taskId+' conversation'});
 if(taskId!=='lead')tasks[taskId]={memberId,runnerId:'codex',modelId:'gpt-6.1-sol',attempt:1,state};
}
const view:any={events,tasks,approvals:{},questions:{}},contexts=projectContextWindows(events,'daily');
const state:any={runners:{claude:{refreshAfter:0,refreshing:false},codex:{refreshAfter:0,refreshing:false,snapshot:{runnerId:'codex',updatedAt:Date.now(),plan:'pro',windows:[{id:'five-hour',usedPercent:42.2,resetsAt:1900000000000},{id:'seven-day',usedPercent:19,resetsAt:1901000000000}]}}}};
createRoot(document.getElementById('app')!).render(<SecondaryInfoProvider scopeKey="daily"><div className="workbench"><nav className="sidebar"><div className="project-navigation"><h2>Projects</h2><p>Daily workspace</p></div><QuotaSectionView collapsed={false} onToggle={()=>{}} state={state} now={Date.now()} loading={false} message="" onRefresh={()=>{}}/></nav><div className="app-body"><header className="app-header"><h1>Daily workspace</h1></header><div className="panes"><main className="chat-pane"><div className="conversation"><p>Connected reply</p></div><div className="conversation-feedback"><div className="conversation-float-stack"><div className="lead-progress"><ContextWindowIndicator observation={contexts.get()} owner="Lead"/></div></div></div><div className="composer-wrap"><textarea id="prompt" defaultValue="Draft retained after retry"/></div></main><aside className="workspace-pane"><div className="workspace-tabs">Activity · Subagents · Git</div><div className="workspace-panel"><Subagents view={view} sessionId="daily" contexts={contexts} visible/></div></aside></div></div></div></SecondaryInfoProvider>);
`);
const build=spawnSync('bun',['build',path.join(out,'entry.tsx'),'--target','browser','--outdir',out],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
const server=http.createServer((req,res)=>{const file=req.url==='/'?'index.html':req.url.slice(1);if(file==='index.html'){res.setHeader('Content-Type','text/html');res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/entry.css"><div id="app"></div><script src="/entry.js"></script>');return;}const p=path.join(out,file);if(!p.startsWith(out)||!fs.existsSync(p)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'image/png');res.end(fs.readFileSync(p));});
let browser;(async()=>{try{await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||'/home/kevin15011/.cache/ms-playwright/chromium-1237/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.task-card').first().waitFor();await page.screenshot({path:path.join(out,'desktop-cards.png')});await page.locator('.task-card').first().getByRole('button',{name:'Open full view'}).click();await page.screenshot({path:path.join(out,'desktop-detail.png')});await page.setViewportSize({width:390,height:844});await page.locator('.chat-pane').evaluate(node=>node.hidden=true);await page.screenshot({path:path.join(out,'mobile-detail.png')});}finally{await browser?.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
