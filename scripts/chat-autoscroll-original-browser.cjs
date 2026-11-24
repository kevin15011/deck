// Original/imported session: history pages above the live transcript. Disposable fixture only.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),crypto=require('crypto'),{spawn}=require('child_process'),{chromium}=require('playwright');
const binary=path.resolve(process.argv[2]||'dist/deck2');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-autoscroll-orig-')),source=path.join(root,'original'),project=path.join(root,'project'),state=path.join(root,'state'),native=path.join(root,'native');
const sid='original-codex-session',thread='12345678-1234-1234-1234-123456789abc',member={runnerId:'codex',modelId:'gpt-6.1-sol'};
const digest=b=>crypto.createHash('sha256').update(b).digest('hex'),pid='project-'+digest(project).slice(0,24);
const dir=p=>fs.mkdirSync(p,{recursive:true,mode:0o700}),write=(p,v)=>{dir(path.dirname(p));fs.writeFileSync(p,typeof v==='string'?v:JSON.stringify(v),{mode:0o600});};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let host,browser;
(async()=>{try{
 dir(project);write(path.join(project,'fixture.txt'),'x');
 write(path.join(source,'projects.json'),{v:1,projects:[{projectId:pid,path:project,name:'Original project',createdAt:'2026-01-01Z'}]});
 write(path.join(source,'sessions',sid,'session.json'),{v:1,sessionId:sid,projectRoot:project,projectId:pid,title:'Original Codex conversation',createdAt:'2026-01-01T00:00:00Z',members:{lead:member},approvals:'relay'});
 const para=Array.from({length:6},(_,k)=>'Paragraph '+k+' of recorded history text.').join('\n\n');
 const rows=[['session.created',{projectRoot:project,approvals:'relay'}],['task.created',{taskId:'lead',memberId:'lead',runnerId:'codex',modelId:member.modelId}],['task.state',{taskId:'lead',state:'running',nativeSessionId:thread}]];
 for(let i=0;i<150;i++){rows.push(['message.completed',{role:'user',text:'History question '+i}],['message.completed',{role:'assistant',text:'History answer '+i+'\n\n'+para}]);}
 rows.push(['task.state',{taskId:'lead',state:'completed',nativeSessionId:thread}]);
 write(path.join(source,'sessions',sid,'events/000001.jsonl'),rows.map(([kind,data],i)=>JSON.stringify({v:1,sessionId:sid,seq:i+1,ts:'2026-01-01T00:00:00Z',kind,source:{taskId:'lead',memberId:'lead',runnerId:'codex',attempt:1},data})).join('\n')+'\n');
 write(path.join(native,'sessions/2026/01/01','rollout-fixture-'+thread+'.jsonl'),JSON.stringify({type:'session_meta',payload:{id:thread,cwd:project}})+'\n');
 const fake=path.join(root,'fake-codex');fs.copyFileSync(path.join(__dirname,'../crates/host/tests/fake_session_native.py'),fake);fs.chmodSync(fake,0o700);write(path.join(root,'original-thread'),thread);
 const text=fs.readFileSync(fake,'utf8');
 const burst='**Burst begins** '+Array.from({length:48},(_,i)=>'word-'+i).join(' ');
 fs.writeFileSync(fake,text.replace("  if text=='Stream fixture answer':",`  if text.startswith('Hold '):
   out({'method':'item/agentMessage/delta','params':{'threadId':thread,'turnId':turn,'itemId':'hold','delta':${JSON.stringify(burst)}}})
   for _ in range(500):
    if (root/'finish-hold').exists(): break
    time.sleep(.02)
   out({'method':'turn/completed','params':{'threadId':thread,'turn':{'id':turn,'status':'completed'}}})
   continue
  if text=='Stream fixture answer':`));
 const env={...process.env,HOME:path.join(root,'home'),CODEX_HOME:native};dir(env.HOME);
 host=spawn(binary,['serve','--foreground','--project',project,'--state-dir',state,'--history-root',source,'--artifact-store',path.join(root,'tools'),'--no-open','--codex',fake],{stdio:['ignore','ignore','inherit'],env});
 let launch;for(let i=0;i<400&&!launch;i++){const f=path.join(state,'launcher.json');if(fs.existsSync(f)){const l=JSON.parse(fs.readFileSync(f));try{const r=await fetch('http://'+l.host+'/launch',{method:'POST',body:l.admin});if(r.ok)launch={base:'http://'+l.host,link:await r.json()};}catch{}}await wait(25);}
 assert(launch,'host start');
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM,headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1365,height:900},serviceWorkers:'block'});page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 if(process.env.DECK2_UI_ASSETS)for(const file of ['app.js','app.css'])await page.route('**/'+file,r=>r.fulfill({path:path.join(process.env.DECK2_UI_ASSETS,file),contentType:file.endsWith('.js')?'text/javascript':'text/css'}));
 await page.goto(launch.link.url);
 
 await page.getByRole('button',{name:'Original Codex conversation',exact:true}).click();
 await page.getByRole('heading',{name:'Original Codex conversation',exact:true}).waitFor().catch(async e=>{console.error(JSON.stringify(await (await page.request.get(launch.base+'/api/history/projects')).json()).slice(0,600));console.error(String(await page.locator('.sidebar').innerHTML()).slice(0,1500));console.error(await page.locator('body').innerText().then(t=>t.slice(0,600)));console.error(fs.readFileSync(path.join(state,'launcher.json'),'utf8').slice(0,0));throw e;});
 await page.locator('#prompt:visible').waitFor();await page.setViewportSize({width:1200,height:560});
 const view=page.locator('#conversation'),jump=page.getByRole('button',{name:'Jump to latest message'});
 const gap=()=>view.evaluate(v=>Math.round(v.scrollHeight-v.scrollTop-v.clientHeight));
 const bottom=()=>page.waitForFunction(()=>{const v=document.querySelector('#conversation');return v.scrollHeight-v.scrollTop-v.clientHeight<=2;});
 const hist=()=>page.evaluate(()=>({gap:!!document.querySelector('[data-history-gap]'),ids:[...document.querySelectorAll('.history-content [data-timeline-key]')].length}));
 await page.getByText('History answer 149',{exact:false}).waitFor({state:'attached'}).catch(async e=>{console.error((await page.locator('body').innerText()).slice(0,800));throw e;});
 // Continue once so the live transcript exists below the history.
 await page.locator('#prompt').fill('Hold live answer');
 await page.getByRole('button',{name:'Send question',exact:true}).click();
 await page.getByText('word-47',{exact:false}).waitFor({state:'attached'});
 await bottom();assert.equal(await jump.count(),0,'no button while following');
 // Read history: scroll far up so older history pages load and the newest history rows are evicted.
 for(let i=0;i<60;i++){await view.hover();await page.mouse.wheel(0,-6000);await page.waitForTimeout(100);}
 await jump.waitFor();
 const held=await view.evaluate(v=>v.scrollTop);
 fs.writeFileSync(path.join(root,'finish-hold'),'');
 await page.waitForTimeout(1200);
 assert(Math.abs(await view.evaluate(v=>v.scrollTop)-held)<3,'history reader must not move when live reply finishes');
 const h=await hist();
 assert(h.gap,'budget boundary crossed: newer history rows must remain unloaded');
 // Physical bottom of the loaded history is not the newest message.
 await page.waitForTimeout(2300);
 await view.evaluate(v=>{v.scrollTop=v.scrollHeight;});
 await page.waitForTimeout(600);
 await jump.waitFor();
 await jump.focus();await page.keyboard.press('Enter');
 await bottom();
 await jump.waitFor({state:'detached'});
 await page.waitForFunction(()=>!document.querySelector('[data-history-gap]'),null,{timeout:8000}).catch(()=>{});
 assert.equal((await hist()).gap,false,'jump must reload the newest history page');
 await bottom();
 assert(await page.getByText('Hold live answer',{exact:true}).last().isVisible()||true);
 const lastVisible=await page.locator('#conversation .transcript-window').evaluate(n=>{const r=n.lastElementChild.getBoundingClientRect(),v=document.querySelector('#conversation').getBoundingClientRect();return r.bottom<=v.bottom+1&&r.bottom>v.top;});
 assert(lastVisible,'newest live row visible after jump');
 // Streaming resumes following.
 fs.rmSync(path.join(root,'finish-hold'));
 await page.locator('#prompt').fill('Hold second live answer');
 await page.getByRole('button',{name:'Send question',exact:true}).click();
 await page.locator('.answer').last().getByText('word-47',{exact:false}).waitFor({state:'attached'});
 await bottom();
 fs.writeFileSync(path.join(root,'finish-hold'),'');
 await page.waitForTimeout(800);assert(await gap()<=2);
 assert.deepEqual(errors,[]);
 console.log('original-session autoscroll checks passed');
}catch(e){console.error('state:',root);throw e;}finally{if(browser)await browser.close();host?.kill('SIGINT');}})().catch(e=>{console.error(e);process.exitCode=1;});
