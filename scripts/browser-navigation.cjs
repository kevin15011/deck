// Regression: latest navigation owns selection after delayed activation success/failure. All data,
// native transport, and browser identity belong exclusively to this disposable fixture.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),crypto=require('crypto'),{spawn}=require('child_process'),{chromium}=require('playwright');
const binary=path.resolve(process.argv[2]||'dist/deck2'),out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/browser-navigation');fs.mkdirSync(out,{recursive:true});
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
 // Distinct original sessions keep every activation case historical on receipt.
 for(const id of ['editor-activation','editor-activation-close','editor-activation-failure']){
  write(path.join(source,'sessions',id,'session.json'),{v:1,sessionId:id,projectRoot:project,projectId:pid,title:id,createdAt:'2026-01-01T00:00:00Z',members:{lead:member},approvals:'relay'});
  write(path.join(source,'sessions',id,'events/000001.jsonl'),events.map(e=>JSON.stringify({...e,sessionId:id})).join('\n')+'\n');
 }
 const fake=path.join(root,'fake-codex');fs.copyFileSync(path.join(__dirname,'../crates/host/tests/fake_session_native.py'),fake);fs.chmodSync(fake,0o700);write(path.join(root,'original-thread'),thread);
 const env={...process.env,HOME:path.join(root,'home'),CODEX_HOME:native};dir(env.HOME);
 async function start(){host=spawn(binary,['serve','--project',project,'--state-dir',state,'--history-root',source,'--artifact-store',path.join(root,'tools'),'--no-open','--codex',fake],{stdio:['ignore','pipe','pipe'],env});let log='';host.stdout.on('data',b=>log+=b);host.stderr.on('data',b=>log+=b);for(let i=0;i<400;i++){if(fs.existsSync(path.join(state,'launcher.json'))){const l=JSON.parse(fs.readFileSync(path.join(state,'launcher.json')));try{const r=await fetch('http://'+l.host+'/launch',{method:'POST',body:l.admin});if(r.ok){fs.writeFileSync(path.join(out,'host.log'),log);return {base:'http://'+l.host,link:await r.json()};}}catch{}}if(host.exitCode!==null)throw Error(log);await wait(25);}throw Error('Host startup deadline: '+log);}
 const launch=await start();browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||chromium.executablePath(),headless:true,args:['--no-sandbox']});
 async function open(){const context=await browser.newContext({viewport:{width:1365,height:900},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(5000);const auth=await fetch(launch.base+'/launch',{method:'POST',body:JSON.parse(fs.readFileSync(path.join(state,'launcher.json'))).admin});await page.goto((await auth.json()).url);await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));await page.evaluate(()=>navigator.serviceWorker.ready);return{context,page,worker:context.serviceWorkers()[0]};}
 async function message(worker,id){return worker.evaluate(async id=>{const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true}),channel=new MessageChannel();return new Promise(resolve=>{const timer=setTimeout(()=>{channel.port1.close();resolve(false);},1000);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data?.opened===true);};clients[0].postMessage({type:'deck.open-session',sessionId:id},[channel.port2]);});},id).catch(()=>false);}
 async function check(name,f){try{console.error('CHECK',name);await f();result.checks.push({name,passed:true});}catch(e){result.checks.push({name,passed:false,error:String(e)});}}
 const localA='local-session-alpha',localB='local-session-bravo';
 {const {context,page}=await open();for(const [id,title]of [[localA,'Local Alpha'],[localB,'Local Bravo']])assert.equal((await page.request.post(launch.base+'/api/sessions',{headers:{Origin:launch.base},data:{api:7,id,title}})).status(),200);await context.close();}
 for(const catalog of ['empty','unavailable'])await check('local deep link '+catalog,async()=>{const{context,page}=await open();try{await page.route('**/api/history/projects',r=>r.fulfill({status:catalog==='empty'?200:503,contentType:'application/json',body:catalog==='empty'?JSON.stringify({projects:[],issues:[],adopted:false}):JSON.stringify({message:'history unavailable'})}));await page.goto(launch.base+'/?session='+localB);await page.getByRole('heading',{name:'Local Bravo',exact:true}).waitFor();}finally{await context.close();}});
 for(const order of ['old-first','new-first','stale-failure','manual'])await check('latest worker intent '+order,async()=>{const{context,page,worker}=await open();let releaseA,releaseB,arriveA,arriveB;const gateA=new Promise(r=>releaseA=r),gateB=new Promise(r=>releaseB=r),arrivedA=new Promise(r=>arriveA=r),arrivedB=new Promise(r=>arriveB=r);try{
 await page.route('**/api/history/sessions/*?limit=1',async route=>{const old=route.request().url().includes('/unsupported?'),response=await route.fetch();(old?arriveA:arriveB)();await(old?gateA:gateB);if(old&&order==='stale-failure')await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'STALE_LOOKUP'})});else await route.fulfill({response});});
 const a=message(worker,'unsupported');await Promise.race([arrivedA,wait(5000).then(()=>{throw Error('old lookup did not arrive')})]);const b=message(worker,'other-project');await Promise.race([arrivedB,wait(5000).then(()=>{throw Error('new lookup did not arrive')})]);
 if(order==='manual'){await page.getByRole('button',{name:'Local Alpha',exact:false}).first().click();releaseA();releaseB();assert.equal(await a,false);assert.equal(await b,false);await page.getByRole('heading',{name:'Local Alpha',exact:true}).waitFor();}
 else{if(order==='new-first'){releaseB();assert.equal(await b,true);releaseA();}else{const delivered=page.waitForResponse(r=>r.url().includes('/unsupported?limit=1'));releaseA();await delivered;await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));releaseB();}assert.equal(await b,true);assert.equal(await a,false);await page.getByRole('heading',{name:'Other project conversation',exact:true}).waitFor();assert(!(await page.locator('body').innerText()).includes('STALE_LOOKUP'));}
 }finally{releaseA?.();releaseB?.();await context.close();}});
 for(const panel of ['Settings','Configuration'])await check('worker reveals conversation from '+panel,async()=>{const{context,page,worker}=await open();try{await page.getByRole('button',{name:panel,exact:true}).first().click();assert.equal(await message(worker,localB),true);await page.getByRole('heading',{name:'Local Bravo',exact:true}).waitFor();assert.equal(await page.locator('#prompt:visible').count(),1);}finally{await context.close();}});
 await check('busy navigation declines acknowledgment and retains input',async()=>{const{context,page,worker}=await open();let release,arrive;const gate=new Promise(r=>release=r),arrived=new Promise(r=>arrive=r);try{await page.getByRole('button',{name:'Local Alpha',exact:false}).first().click();await page.locator('#prompt').fill('KEEP PENDING INPUT');await page.route('**/api/commands',async r=>{arrive();await gate;await r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'FIXTURE_OFFLINE'})});});await page.getByRole('button',{name:'Send question',exact:true}).click();await Promise.race([arrived,wait(5000).then(()=>{throw Error('send did not arrive')})]);assert.equal(await message(worker,localB),false);await page.getByRole('heading',{name:'Local Alpha',exact:true}).waitFor();assert.equal(await page.locator('#prompt').inputValue(),'KEEP PENDING INPUT');release();}finally{release?.();await context.close();}});
 // Protect editor drafts and navigation ownership at both asynchronous boundaries.
 // Oracle: opening an editor cancels earlier intent permanently, even after close.
 for(const scenario of ['lookup-assignments','lookup-new','lookup-close','activation-new','activation-close','activation-failure'])await check('editor cancels '+scenario,async()=>{
  const{context,page,worker}=await open();let release,arrive;const gate=new Promise(r=>release=r),arrived=new Promise(r=>arrive=r);
  const activation=scenario.startsWith('activation'),closeEarly=scenario.endsWith('close'),assignments=scenario.endsWith('assignments');
  const id=activation?(closeEarly?'editor-activation-close':scenario.endsWith('failure')?'editor-activation-failure':'editor-activation'):assignments?sid:'unsupported';
  const endpoint=activation?'/api/history/sessions/'+id+'/activate':'/api/history/sessions/'+id+'?limit=1';
  try{
   // A real configured local session exposes the existing assignment editor.
   const editorId='editor-local-alpha';
   const w=await(await page.request.get(launch.base+'/api/workspace')).json();
   if(!w.sessions.some(s=>s.id===editorId))assert.equal((await page.request.post(launch.base+'/api/sessions',{headers:{Origin:launch.base},data:{api:7,id:editorId,title:'Editor Alpha',members:{lead:member},approvals:'relay'}})).status(),200);
   await page.reload();await page.getByRole('button',{name:'Editor Alpha',exact:false}).first().click();
   await page.getByRole('heading',{name:'Editor Alpha',exact:true}).waitFor();await page.locator('#prompt').fill('KEEP EDITOR INPUT');
   let requests=0;await page.route('**'+endpoint,async route=>{requests++;const response=await route.fetch();arrive();await gate;if(scenario.endsWith('failure'))await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'ABANDONED_ACTIVATION_FAILURE'})});else await route.fulfill({response});});
   const ack=message(worker,id);await Promise.race([arrived,wait(5000).then(()=>{throw Error('navigation boundary did not arrive')})]);
   // A historical view has legitimately opened before activation completes.
   // Its initial acknowledgment is valid; later activation must not change the
   // operational session behind the new-session editor.
   if(activation)assert.equal(await ack,true);
   const trigger=page.getByRole('button',{name:assignments?'Session assignments':'+ New conversation',exact:true}).first();
   await trigger.focus();await page.keyboard.press('Enter');
   const dialog=page.getByRole('dialog',{name:assignments?'Session assignments':'New session',exact:true});await dialog.waitFor();
   const field=assignments?dialog.getByLabel('Reasoning level for Lead',{exact:true}):dialog.getByLabel('Session name',{exact:true});
   if(assignments)await field.selectOption('high');else await field.fill('UNSAVED EDITOR TITLE');
   const expected=assignments?'high':'UNSAVED EDITOR TITLE';assert.equal(await field.inputValue(),expected);
   if(closeEarly){await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});}
   const delivered=page.waitForResponse(r=>r.url().endsWith(endpoint));
   const workspaceRead=activation&&!scenario.endsWith('failure')?page.waitForResponse(r=>r.url().endsWith('/api/workspace')&&r.request().method()==='GET'):undefined;
   release();await delivered;if(workspaceRead)await workspaceRead;
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   if(!activation)assert.equal(await ack,false,'editor must decline the older lookup acknowledgment');
   if(!closeEarly){assert.equal(await field.inputValue(),expected,'unsaved editor field retained');assert.equal(await dialog.isVisible(),true);await page.screenshot({path:path.join(out,scenario+'.png')});await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});}
   assert(!(await page.locator('body').innerText()).includes('ABANDONED_ACTIVATION_FAILURE'));
   // No stale activation may switch the underlying selected local session.
   assert.equal(await page.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.endsWith('.selected')).map(([,v])=>v).includes('editor-local-alpha')),true,'underlying operational session retained');
   if(activation)await page.getByRole('heading',{name:id,exact:true}).waitFor();else await page.getByRole('heading',{name:'Editor Alpha',exact:true}).waitFor();
   // Newer explicit navigation remains usable after keyboard close.
   await page.getByRole('button',{name:'Editor Alpha',exact:false}).first().click();await page.getByRole('heading',{name:'Editor Alpha',exact:true}).waitFor();assert.equal(await page.locator('#prompt').inputValue(),'KEEP EDITOR INPUT');
   await page.getByRole('button',{name:'Local Bravo',exact:false}).first().click();await page.getByRole('heading',{name:'Local Bravo',exact:true}).waitFor();
   assert.equal(requests,1);assert(!fs.existsSync(path.join(root,'dispatch-count')));
  }finally{release?.();await context.close();}
 });
 assert(result.checks.every(c=>c.passed),JSON.stringify(result.checks));result.passed=true;
}finally{if(browser)await browser.close();if(host){host.kill('SIGINT');await Promise.race([new Promise(r=>host.once('exit',r)),wait(4000)]);if(host.exitCode===null)throw Error('Host did not stop');}result.seconds=(performance.now()-started)/1000;fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
