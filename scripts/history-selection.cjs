// Regression: latest navigation owns selection after delayed activation success/failure. All data,
// native transport, and browser identity belong exclusively to this disposable fixture.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),crypto=require('crypto'),{spawn}=require('child_process'),{chromium}=require('playwright');
const binary=path.resolve(process.argv[2]||'dist/deck2'),out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/history-selection');fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-adoption-')),source=path.join(root,'original'),project=path.join(root,'project'),state=path.join(root,'state'),native=path.join(root,'native'),sid='original-codex-session',thread='12345678-1234-1234-1234-123456789abc';let host,browser;
const wait=ms=>new Promise(r=>setTimeout(r,ms)),digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function dir(p){fs.mkdirSync(p,{recursive:true,mode:0o700});}function write(p,v){dir(path.dirname(p));fs.writeFileSync(p,typeof v==='string'?v:JSON.stringify(v),{mode:0o600});}
const pid='project-'+digest(project).slice(0,24),baseSession=path.join(source,'sessions',sid),member={runnerId:'codex',modelId:'gpt-6.1-sol'};
const result={passed:false,binary:digest(fs.readFileSync(binary)),checks:[]},started=performance.now();
(async()=>{try{
 dir(project);write(path.join(project,'fixture.txt'),'Disposable fixture.');write(path.join(source,'projects.json'),{v:1,projects:[{projectId:pid,path:project,name:'Original project',createdAt:'2026-01-01Z'}],future:{preserved:true}});write(path.join(baseSession,'session.json'),{v:1,sessionId:sid,projectRoot:project,projectId:pid,title:'Original Codex conversation',createdAt:'2026-01-01T00:00:00Z',members:{lead:member},approvals:'relay',future:{preserved:true}});
 const other=path.join(root,'other-project'),otherPid='project-'+digest(other).slice(0,24);dir(other);
 write(path.join(source,'projects.json'),{v:1,projects:[{projectId:pid,path:project,name:'Original project',createdAt:'2026-01-01Z'},{projectId:otherPid,path:other,name:'Other project',createdAt:'2026-01-01Z'}]});
 const targets=[{id:'unsupported',title:'Unsupported conversation',project,pid,runner:'opencode'},{id:'other-project',title:'Other project conversation',project:other,pid:otherPid,runner:'codex'}];
 for(const t of targets){const base=path.join(source,'sessions',t.id);write(path.join(base,'session.json'),{v:1,sessionId:t.id,projectRoot:t.project,projectId:t.pid,title:t.title,createdAt:'2026-01-01T00:00:00Z',members:{lead:{runnerId:t.runner,modelId:member.modelId}},approvals:'relay'});write(path.join(base,'events/000001.jsonl'),JSON.stringify({v:1,sessionId:t.id,seq:1,ts:'2026-01-01T00:00:00Z',kind:'message.completed',source:{taskId:'lead',memberId:'lead',runnerId:t.runner},data:{role:'user',text:'Retain transcript '+t.id}})+'\n');}
 const events=[['session.created',{projectRoot:project,approvals:'relay'}],['task.created',{taskId:'lead',memberId:'lead',runnerId:'codex',modelId:member.modelId}],['task.state',{taskId:'lead',state:'running',nativeSessionId:thread}],['message.completed',{role:'user',text:'Original question preserved'}],['message.completed',{role:'assistant',text:'Original native answer preserved'}],['task.state',{taskId:'lead',state:'completed',nativeSessionId:thread}],['approval.resolved',{decision:'allow',by:'historical-grant'}],['prompt.queued',{promptId:'old-prompt',text:'NEVER REPLAY THIS HISTORICAL INPUT'}],['future.opaque',{preserve:[1,2,3]}]].map(([kind,data],i)=>({v:1,sessionId:sid,seq:i+1,ts:'2026-01-01T00:00:00Z',kind,source:{taskId:'lead',memberId:'lead',runnerId:'codex',attempt:1},data}));
 const raw=events.map(JSON.stringify).join('\n')+'\n';write(path.join(baseSession,'events/000001.jsonl'),raw);
 write(path.join(native,'sessions/2026/01/01','rollout-fixture-'+thread+'.jsonl'),JSON.stringify({type:'session_meta',payload:{id:thread,cwd:project}})+'\n');
 const fake=path.join(root,'fake-codex');fs.copyFileSync(path.join(__dirname,'../crates/host/tests/fake_session_native.py'),fake);fs.chmodSync(fake,0o700);write(path.join(root,'original-thread'),thread);
 const env={...process.env,HOME:path.join(root,'home'),CODEX_HOME:native};dir(env.HOME);
 async function start(){host=spawn(binary,['serve','--foreground','--project',project,'--state-dir',state,'--history-root',source,'--artifact-store',path.join(root,'tools'),'--no-open','--codex',fake],{stdio:['ignore','pipe','pipe'],env});let log='';host.stdout.on('data',b=>log+=b);host.stderr.on('data',b=>log+=b);for(let i=0;i<400;i++){if(fs.existsSync(path.join(state,'launcher.json'))){const l=JSON.parse(fs.readFileSync(path.join(state,'launcher.json')));try{const r=await fetch('http://'+l.host+'/launch',{method:'POST',body:l.admin});if(r.ok){fs.writeFileSync(path.join(out,'host.log'),log);return {base:'http://'+l.host,link:await r.json()};}}catch{}}if(host.exitCode!==null)throw Error(log);await wait(25);}throw Error('Host startup deadline: '+log);}
 const launch=await start();browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||chromium.executablePath(),headless:true,args:['--no-sandbox']});
 // Real packaged assets, adoption, navigation and activation endpoint. Only response
 // delivery/failure is controlled at the network edge; no handler extraction.
 for(const t of targets)for(const outcome of ['success','failure']){
  const context=await browser.newContext({viewport:{width:1365,height:900},reducedMotion:outcome==='failure'?'reduce':'no-preference'}),page=await context.newPage();
  const auth=await fetch(launch.base+'/launch',{method:'POST',body:JSON.parse(fs.readFileSync(path.join(state,'launcher.json'))).admin});await page.goto((await auth.json()).url);
  await page.getByRole('button',{name:'Original Codex conversation',exact:false}).first().waitFor();
  let release,arrived,finished;const gate=new Promise(r=>release=r),held=new Promise(r=>arrived=r),done=new Promise(r=>finished=r);
  await page.route('**/api/history/sessions/'+sid+'/activate',async route=>{const response=outcome==='success'?await route.fetch():undefined;arrived();await gate;if(response)await route.fulfill({response});else await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'STALE_ACTIVATION_FAILURE'})});finished();});
  await page.getByRole('button',{name:'Original Codex conversation',exact:false}).first().click();await held;
  if(t.id==='other-project')await page.getByRole('button',{name:'Other project',exact:false}).filter({has:page.locator('.project-name')}).first().click();
  const target=page.getByRole('button',{name:t.title,exact:false}).first();
  if(outcome==='failure'){await target.focus();await page.keyboard.press('Enter');}else await target.click();
  await page.getByRole('heading',{name:t.title,exact:true}).waitFor();await page.getByText('Retain transcript '+t.id,{exact:true}).waitFor();
  const delivered=page.waitForResponse(r=>r.url().endsWith('/'+sid+'/activate'));
  // The application awaits a workspace read after successful activation. Wait
  // for that read before observing the settled render, then two paint frames.
  const workspaceRead=outcome==='success'?page.waitForResponse(r=>r.url().endsWith('/api/workspace')&&r.request().method()==='GET'):undefined;
  release();await done;await delivered;if(workspaceRead)await workspaceRead;
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const observed={target:t.id,outcome,title:await page.getByRole('heading',{name:t.title,exact:true}).isVisible(),transcript:await page.getByText('Retain transcript '+t.id,{exact:true}).isVisible(),composer:await page.locator('#prompt:visible').count(),staleError:(await page.locator('body').innerText()).includes('STALE_ACTIVATION_FAILURE')};
  const w=await(await page.request.get(launch.base+'/api/workspace')).json();observed.receipts=w.receipts.length;observed.dispatched=fs.existsSync(path.join(root,'dispatch-count'));observed.passed=observed.title&&observed.transcript&&!observed.composer&&!observed.staleError&&!observed.receipts&&!observed.dispatched;
  result.checks.push(observed);await page.screenshot({path:path.join(out,t.id+'-'+outcome+'.png')});await context.close();
 }
 assert(result.checks.every(c=>c.passed),'Latest navigation must survive all older activation outcomes: '+JSON.stringify(result.checks));
 result.passed=true;
}finally{if(browser)await browser.close();if(host){host.kill('SIGINT');await Promise.race([new Promise(r=>host.once('exit',r)),wait(4000)]);if(host.exitCode===null)throw Error('Host did not stop');}result.seconds=(performance.now()-started)/1000;fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
