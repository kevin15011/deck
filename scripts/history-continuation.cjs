// Standalone original-format adoption plus supported Codex continuation. All data,
// native transport, and browser identity belong exclusively to this disposable fixture.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),crypto=require('crypto'),{spawn}=require('child_process'),{chromium}=require('playwright');
const binary=path.resolve(process.argv[2]||'dist/deck2'),out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/history-continuation');fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-adoption-')),source=path.join(root,'original'),project=path.join(root,'project'),state=path.join(root,'state'),native=path.join(root,'native'),sid='original-codex-session',thread='12345678-1234-1234-1234-123456789abc';let host,browser,page;
const safeError=e=>String(e).replace(/deck2_\d+=[0-9a-f]+/g,'deck2_fixture=<redacted>');
const wait=ms=>new Promise(r=>setTimeout(r,ms)),digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function dir(p){fs.mkdirSync(p,{recursive:true,mode:0o700});}function write(p,v){dir(path.dirname(p));fs.writeFileSync(p,typeof v==='string'?v:JSON.stringify(v),{mode:0o600});}
const pid='project-'+digest(project).slice(0,24),baseSession=path.join(source,'sessions',sid),member={runnerId:'codex',modelId:'gpt-6.1-sol'};
const result={passed:false,interrupted:process.env.DECK2_HISTORY_INTERRUPTED==='1',conflict:process.env.DECK2_HISTORY_CONFLICT||null,binary:digest(fs.readFileSync(binary)),checks:[]},started=performance.now();
(async()=>{try{
 dir(project);if(process.env.DECK2_HISTORY_OTHER_PROJECT==='1')dir(path.join(root,'initial-project'));write(path.join(project,'fixture.txt'),'Disposable fixture.');write(path.join(source,'projects.json'),{v:1,projects:[{projectId:pid,path:project,name:'Original project',createdAt:'2026-01-01Z'}],future:{preserved:true}});write(path.join(baseSession,'session.json'),{v:1,sessionId:sid,projectRoot:project,projectId:pid,title:'Original Codex conversation',createdAt:'2026-01-01T00:00:00Z',members:{lead:member},approvals:'relay',future:{preserved:true}});
 const events=[['session.created',{projectRoot:project,approvals:'relay'}],['task.created',{taskId:'lead',memberId:'lead',runnerId:'codex',modelId:member.modelId}],['task.state',{taskId:'lead',state:'running',nativeSessionId:thread}],['message.completed',{role:'user',text:'Original question preserved'}],['message.completed',{role:'assistant',text:'Original native answer preserved'}],['task.state',{taskId:'lead',state:'completed',nativeSessionId:thread}],['approval.resolved',{decision:'allow',by:'historical-grant'}],['prompt.queued',{promptId:'old-prompt',text:'NEVER REPLAY THIS HISTORICAL INPUT'}],['future.opaque',{preserve:[1,2,3]}]].map(([kind,data],i)=>({v:1,sessionId:sid,seq:i+1,ts:'2026-01-01T00:00:00Z',kind,source:{taskId:'lead',memberId:'lead',runnerId:'codex',attempt:1},data}));
 if(process.env.DECK2_HISTORY_INTERRUPTED==='1'){
  events[5].data.state='running';
  // Positive previous-boot containment, never a live/user process.
  const boot=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),oldBoot=boot==='00000000-0000-0000-0000-000000000001'?'00000000-0000-0000-0000-000000000002':'00000000-0000-0000-0000-000000000001';
  write(path.join(baseSession,'tasks/lead/lease.json'),{v:1,taskId:'lead',nonce:'isolated-recovery-fixture',state:'live',daemon:{pid:1},anchor:{pid:1,platform:'linux',boot:oldBoot,starttime:'1'},group:1,createdAt:'2026-01-01Z'});
  for(const [kind,data] of [['approval.requested',{approvalId:'old-approval',command:'NEVER APPROVE HISTORICAL WORK'}],['question.requested',{questionId:'old-question',questions:[{id:'q',question:'Never replay this question'}]}],['prompt.handoff',{promptId:'old-prompt',state:'sending'}]])events.push({v:1,sessionId:sid,seq:events.length+1,ts:'2026-01-01T00:00:00Z',kind,source:{taskId:'lead',memberId:'lead',runnerId:'codex',attempt:1},data});
 }
 const raw=events.map(JSON.stringify).join('\n')+'\n';write(path.join(baseSession,'events/000001.jsonl'),raw);
 write(path.join(native,'sessions/2026/01/01','rollout-fixture-'+thread+'.jsonl'),JSON.stringify({type:'session_meta',payload:{id:thread,cwd:project}})+'\n');

 const multi=process.env.DECK2_HISTORY_OTHER_PROJECT==='1',projectA=path.join(root,'initial-project'),sidA='original-project-a',threadA='22345678-1234-1234-1234-123456789abc',pidA='project-'+digest(projectA).slice(0,24);
 if(multi){
  write(path.join(source,'projects.json'),{v:1,projects:[{projectId:pid,path:project,name:'Original project',createdAt:'2026-01-01Z'},{projectId:pidA,path:projectA,name:'Other original project',createdAt:'2026-01-01Z'}]});
  write(path.join(source,'sessions',sidA,'session.json'),{v:1,sessionId:sidA,projectRoot:projectA,projectId:pidA,title:'Other original conversation',createdAt:'2026-01-01Z',members:{lead:member,quality:member},approvals:'relay'});
  write(path.join(source,'sessions',sidA,'events/000001.jsonl'),events.map(e=>JSON.stringify({...e,sessionId:sidA,data:{...e.data,...(e.kind==='task.state'?{state:'completed'}:{}),...(e.data.projectRoot?{projectRoot:projectA}:{}),...(e.data.nativeSessionId?{nativeSessionId:threadA}:{})}})).join('\n')+'\n');
  write(path.join(native,'sessions/2026/01/01','rollout-fixture-'+threadA+'.jsonl'),JSON.stringify({type:'session_meta',payload:{id:threadA,cwd:projectA}})+'\n');
  const {execFileSync}=require('child_process');for(const [dir,value] of [[projectA,'A'],[project,'B']]){write(path.join(dir,'same.txt'),value+' base\n');execFileSync('/usr/bin/git',['init','-q'],{cwd:dir});execFileSync('/usr/bin/git',['add','same.txt'],{cwd:dir});execFileSync('/usr/bin/git',['-c','user.name=Fixture','-c','user.email=f@example.invalid','commit','-qm','base'],{cwd:dir});write(path.join(dir,'same.txt'),value+' changed\n');}
 }
 const fake=path.join(root,'fake-codex');fs.copyFileSync(path.join(__dirname,'../crates/host/tests/fake_session_native.py'),fake);fs.chmodSync(fake,0o700);write(path.join(root,'original-thread'),thread);
 if(process.env.DECK2_HISTORY_CONFLICT && process.env.DECK2_HISTORY_CONFLICT!=='admission-source'){
  const mutation=process.env.DECK2_HISTORY_CONFLICT==='source'
   ? `  changed=root/'original/sessions/${sid}/events/000001.jsonl'\n  with changed.open('a') as f:f.write(json.dumps({'v':1,'sessionId':'${sid}','seq':${events.length+1},'ts':'2026-01-01Z','kind':'future.changed','source':{},'data':{}})+'\\n')\n`
   : process.env.DECK2_HISTORY_CONFLICT==='owner'
   ? `  changed=root/'original/daemon/daemon.lock'\n  holder=json.loads(changed.read_text());holder['nonce']='fixture-competing-owner';changed.write_text(json.dumps(holder))\n`
   : process.env.DECK2_HISTORY_CONFLICT==='root-missing' ? `  pathlib.Path(p['cwd']).rename(root/'displaced-project')\n`
   : process.env.DECK2_HISTORY_CONFLICT==='root-replaced' ? `  pathlib.Path(p['cwd']).rename(root/'displaced-project');pathlib.Path(p['cwd']).mkdir()\n`
   : `  (root/'original/sessions/${sid}/tasks/lead/lease.json').unlink()\n`;
  const before=fs.readFileSync(fake,'utf8');assert(before.includes(" elif m in ['thread/start','thread/resume']:\n"));fs.writeFileSync(fake,before.replace(" elif m in ['thread/start','thread/resume']:\n"," elif m in ['thread/start','thread/resume']:\n"+mutation));
 }


 if(multi){let code=fs.readFileSync(fake,'utf8');code=code.replace(" elif m=='config/read':result"," elif m=='config/read':\n  with (root/'project-config-reads').open('a') as f:f.write(json.dumps({'cwd':p['cwd'],'value':(pathlib.Path(p['cwd'])/'same.txt').read_text()})+'\\n')\n  result");code=code.replace(" elif m in ['thread/start','thread/resume']:\n"," elif m in ['thread/start','thread/resume']:\n  thread=p.get('threadId',thread)\n");code=code.replace("'threadId':p.get('threadId')","'threadId':p.get('threadId'),'cwd':p['cwd']");code=code.replace("  if 'Waiting-policy' in text:\n","  if 'Project73 delegate A' in text and not member:\n   delegated=tool('deck_delegate',{'agent':'quality','task':'Waiting-policy hold childproject'})\n   (root/'project-child').write_text(delegated['taskId'])\n  if 'Waiting-policy' in text:\n");fs.writeFileSync(fake,code);}
 const fakeSource=fs.readFileSync(fake,'utf8');assert(fakeSource.includes(" elif m=='turn/start':\n"));fs.writeFileSync(fake,fakeSource.replace(" elif m=='turn/start':\n"," elif m=='turn/start':\n  (root/'turn-input.json').write_text(json.dumps(p))\n"));
 const env={...process.env,HOME:path.join(root,'home'),CODEX_HOME:native};dir(env.HOME);
 async function start(){host=spawn(binary,['serve','--foreground','--project',process.env.DECK2_HISTORY_OTHER_PROJECT==='1'?path.join(root,'initial-project'):project,'--state-dir',state,'--history-root',source,'--artifact-store',path.join(root,'tools'),'--no-open','--codex',fake],{stdio:['ignore','pipe','pipe'],env});let log='';host.stdout.on('data',b=>log+=b);host.stderr.on('data',b=>log+=b);for(let i=0;i<400;i++){if(fs.existsSync(path.join(state,'launcher.json'))){const l=JSON.parse(fs.readFileSync(path.join(state,'launcher.json')));try{const r=await fetch('http://'+l.host+'/launch',{method:'POST',body:l.admin});if(r.ok){fs.writeFileSync(path.join(out,'host.log'),log);return {base:'http://'+l.host,link:await r.json()};}}catch{}}if(host.exitCode!==null)throw Error(log);await wait(25);}throw Error('Host startup deadline: '+log);}
 let launch=await start();browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||chromium.executablePath(),headless:true,args:['--no-sandbox']});page=await browser.newPage({viewport:{width:1365,height:900}});page.on('response',async response=>{if(response.url().endsWith('/activate')){try{result.activation={status:response.status(),body:await response.json()};}catch{}}});await page.goto(launch.link.url);await page.getByRole('button',{name:'Original Codex conversation',exact:false}).first().click();await page.locator('#prompt:visible').waitFor({timeout:10000});await page.getByText('Original question preserved',{exact:true}).waitFor();await page.getByText('Original native answer preserved',{exact:true}).waitFor();
 let w=await(await page.request.get(launch.base+'/api/workspace')).json();const adopted=w.sessions.find(s=>s.id===sid);assert.equal(adopted.native.thread,thread);assert.equal(adopted.original.task,'lead');assert.equal(adopted.original.attempt,1);assert.equal(w.receipts.length,0,'historical queue must not create a receipt');
 if(process.env.DECK2_HISTORY_INTERRUPTED==='1'){
  const h=await(await page.request.get(launch.base+'/api/history/sessions/'+sid)).json();assert.equal(h.recovery.tasks.lead.state,'interrupted');assert.equal(h.recovery.tasks.lead.reason,'process-containment-settled');result.checks.push('interrupted original work activates only after positive previous-boot containment');
 }assert(!fs.existsSync(path.join(root,'dispatch-count')));
 if(process.env.DECK2_HISTORY_CONFLICT==='admission-source')fs.appendFileSync(path.join(baseSession,'events/000001.jsonl'),JSON.stringify({v:1,sessionId:sid,seq:events.length+1,ts:'2026-01-01Z',kind:'future.changed',source:{},data:{}})+'\n');
 await page.locator('#prompt').fill('Continue this original Codex conversation once.');await page.getByRole('button',{name:'Send question',exact:true}).click();
 if(process.env.DECK2_HISTORY_CONFLICT==='admission-source'){
  await page.getByText('Original history: original source changed; continuation withheld',{exact:false}).first().waitFor();w=await(await page.request.get(launch.base+'/api/workspace')).json();assert.equal(w.receipts.length,0);assert(!fs.existsSync(path.join(root,'dispatch-count')));result.checks.push('source changed before admission refuses durable input receipt and native launch');result.passed=true;return;
 }
 for(let i=0;i<400;i++){w=await(await page.request.get(launch.base+'/api/workspace')).json();if(w.receipts.some(r=>['failed','uncertain','cancelled'].includes(r.phase))){if(process.env.DECK2_HISTORY_CONFLICT)break;throw Error(JSON.stringify(w.receipts));}if(w.receipts[0]?.phase==='completed')break;await wait(25);}
 if(process.env.DECK2_HISTORY_CONFLICT){
  assert.equal(w.receipts.length,1);assert.equal(w.receipts[0].phase,'failed');if(process.env.DECK2_HISTORY_CONFLICT.startsWith('root-')){assert.equal(w.sessions.find(s=>s.id===sid).project.root,project);assert(!fs.existsSync(project)||fs.existsSync(path.join(root,'displaced-project')));}else assert.match(w.receipts[0].detail,/original|Original/);assert(!fs.existsSync(path.join(root,'dispatch-count')),'changed original authority must prevent turn/start after resume preparation');result.checks.push('source/owner/lease changed during real native preparation refuses dispatch');result.receipt={phase:w.receipts[0].phase,detail:w.receipts[0].detail};result.passed=true;return;
 }
 assert.equal(w.receipts.length,1);assert.equal(w.receipts[0].phase,'completed');assert.equal(w.receipts[0].thread,thread);assert.equal(w.receipts[0].configuration.session_contract.leadTask,'lead');assert.equal(fs.readFileSync(path.join(root,'dispatch-count'),'utf8'),'dispatch\n');const input=fs.readFileSync(path.join(root,'turn-input.json'),'utf8');assert(input.includes('Continue this original Codex conversation once.'));assert(!/NEVER|old-approval|old-question|historical-grant/.test(input),'historical inputs and authority are never sent to native');const protocol=fs.readFileSync(path.join(root,'native-protocol'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(protocol[0].method,'thread/resume');assert.equal(protocol[0].threadId,thread);assert(!protocol.some(p=>p.method==='thread/start'));assert.equal(protocol[0].approvalPolicy,'on-request');

 if(multi){
  const post=async(url,body)=>{const r=await page.request.post(launch.base+url,{headers:{Origin:launch.base},data:body});const v=await r.json();assert.equal(r.status(),200,JSON.stringify(v));return v;};
  const get=async url=>{const r=await page.request.get(launch.base+url);assert.equal(r.status(),200);return r.json();};
  if(process.env.DECK2_PROJECT_AVAILABILITY==='1'){
   // UI boundary fault injection only: B remains healthy while the startup A
   // projection reports loss. The host owner-selection boundary is tested in Rust.
   const unavailable='Fixture startup A runner unavailable';
   const route=async route=>{const response=await route.fetch();const value=await response.json();await route.fulfill({response,json:{...value,availability:unavailable,project_availability:{[pidA]:unavailable,[pid]:null}}});};
   await page.route('**/api/workspace',route);
   await page.reload();
   await page.locator('#prompt:visible').waitFor();
   result.stage='availability-initial-b';
   await page.getByRole('heading',{name:'Original Codex conversation',exact:true}).waitFor();
   await page.locator('#prompt').fill('Availability draft B');
   await page.waitForFunction(()=>document.querySelector('.composer .send')?.disabled===false);
   assert.equal(await page.locator('.composer .send').isEnabled(),true,'healthy B composer must ignore startup A failure');
   await page.locator('.project-row button').filter({hasText:'Other original project'}).first().click();
   await page.getByRole('button',{name:'Other original conversation',exact:false}).first().click();
   result.stage='availability-a';
   await page.getByRole('heading',{name:'Other original conversation',exact:true}).waitFor();
   await page.locator('#prompt').fill('Availability draft A');
   await page.waitForFunction(()=>document.querySelector('.composer .send')?.disabled===true);
   await page.getByRole('button',{name:'Original Codex conversation',exact:false}).first().click();
   result.stage='availability-return-b';
   await page.getByRole('heading',{name:'Original Codex conversation',exact:true}).waitFor();
   await page.waitForFunction(()=>document.querySelector('.composer .send')?.disabled===false);
   await page.locator('.project-row button').filter({hasText:'Other original project'}).first().click();
   await page.unroute('**/api/workspace',route);
   result.checks.push('selected B composer stays usable with unavailable startup A; selecting A honestly blocks its composer');
   // This optional case owns only the availability boundary. Run the unchanged
   // full A/B journey separately, without extra navigation racing its Git reads.
   result.passed=true;return;
  }
  const ca=(await get('/api/configuration?projectId='+pidA)).selected,cb=(await get('/api/configuration?projectId='+pid)).selected;assert.equal(ca.project,projectA);assert.equal(cb.project,project);assert.notEqual(ca.revision,cb.revision);
  await post('/api/project/trust',{api:7,project:projectA,trusted:true});assert.equal((await get('/api/workspace')).project_trust[pid],false);
  await page.locator('.project-row button').filter({hasText:'Other original project'}).first().click();await page.getByRole('button',{name:'Other original conversation',exact:false}).first().click();await page.locator('#prompt:visible').waitFor();
  await page.locator('#prompt').fill('Project73 delegate A');await page.getByRole('button',{name:'Send question',exact:true}).click();
  for(let i=0;i<600&&!fs.existsSync(path.join(root,'ready-childproject'));i++)await wait(25);assert(fs.existsSync(path.join(root,'ready-childproject')),'Quality child must reach owned native preparation');
  const before=await get('/api/workspace'),child=before.tasks.find(t=>t.id===fs.readFileSync(path.join(root,'project-child'),'utf8'));assert.equal(child.session,sidA);assert.equal(child.owner,'quality');assert.equal(child.attempts[0].configuration.project.root,projectA);
  await page.getByRole('button',{name:'Original Codex conversation',exact:false}).first().click();await page.locator('#prompt:visible').waitFor();await page.locator('#prompt').fill('B draft survives reversal');
  await page.getByRole('button',{name:'Other original conversation',exact:false}).first().click();await page.getByRole('button',{name:'Original Codex conversation',exact:false}).first().click();await page.waitForFunction(()=>document.querySelector('#prompt')?.value==='B draft survives reversal');
  const ga=await get('/api/sessions/'+sidA+'/git'),gb=await get('/api/sessions/'+sid+'/git');const fa=ga.files.find(f=>f.path==='same.txt'),fb=gb.files.find(f=>f.path==='same.txt');assert(fa&&fb);const da=await get('/api/sessions/'+sidA+'/git/'+ga.revision+'/'+fa.id),db=await get('/api/sessions/'+sid+'/git/'+gb.revision+'/'+fb.id);assert(JSON.stringify(da).includes('A changed'));assert(JSON.stringify(db).includes('B changed'));assert.equal((await page.request.get(launch.base+'/api/sessions/'+sid+'/git/'+ga.revision+'/'+fa.id)).status(),409);
  await post('/api/commands',{api:7,id:'project-b-waiting',session:sid,prompt:'Project73 queued B',mode:'session_v1',queue:true,fresh:false});await post('/api/sessions/'+sid+'/approvals',{api:7,mode:'yolo'});
  await post('/api/project/trust',{api:7,project:project,trusted:false});assert.equal((await get('/api/workspace')).project_trust[pidA],true);
  assert.equal((await get('/api/workspace')).receipts.find(r=>r.id==='project-b-waiting').phase,'queued');write(path.join(root,'release-childproject'),'release');
  for(let i=0;i<600;i++){w=await get('/api/workspace');if(w.receipts.find(r=>r.id==='project-b-waiting')?.phase==='completed')break;await wait(25);}
  const queued=w.receipts.find(r=>r.id==='project-b-waiting');assert.equal(queued.phase,'completed',JSON.stringify(w.receipts));assert.equal(queued.configuration.project.root,project);assert.equal(queued.configuration.session_contract.approvals,'yolo');assert.equal(w.tasks.find(t=>t.id===child.id).attempts[0].configuration.project.root,projectA);
  const nativeLog=fs.readFileSync(path.join(root,'native-protocol'),'utf8').trim().split('\n').map(JSON.parse);assert(nativeLog.some(v=>v.cwd===projectA));assert(nativeLog.some(v=>v.cwd===project&&v.permissions===':danger-full-access'));
  await page.emulateMedia({reducedMotion:'reduce'});const aButton=page.getByRole('button',{name:'Other original conversation',exact:false}).first();await aButton.focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Original Codex conversation',exact:false}).first().click();
  result.checks.push('A Quality attempt remains in A while B is selected and queued; B captures its own updated permission at launch','A/B same-name Git files and revisions cannot cross sessions; B revocation leaves A trust intact','rapid reversal and keyboard/reduced-motion navigation preserve B composer draft');
  const reads=fs.readFileSync(path.join(root,'project-config-reads'),'utf8').trim().split('\n').map(JSON.parse);assert(reads.some(v=>v.cwd===projectA&&v.value==='A changed\n'));assert(reads.some(v=>v.cwd===project&&v.value==='B changed\n'));
  await page.locator('.sidebar .project-group').filter({hasText:'Original project'}).first().getByRole('button',{name:'+ New conversation',exact:true}).click();await page.getByRole('textbox',{name:'Session name'}).fill('Project B fresh session');await page.getByRole('button',{name:'Create session',exact:true}).click();await page.getByRole('heading',{name:'Project B fresh session',exact:true}).waitFor();
  const fresh=(await get('/api/workspace')).sessions.find(s=>s.title==='Project B fresh session');assert.equal(fresh.project.id,pid);assert.equal(fresh.project.root,project);await page.getByRole('button',{name:'Original Codex conversation',exact:false}).first().click();
  result.checks.push('new session uses selected B project and grouping; native configuration probes see distinct owning roots and contents');
  result.multiReceiptCount=w.receipts.length;result.multiDispatch=fs.readFileSync(path.join(root,'dispatch-count'),'utf8');
 }
 await page.getByText('Connected reply',{exact:true}).first().waitFor();await page.screenshot({path:path.join(out,'continuation-desktop.png')});await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('tab',{name:'Conversation',exact:true}).click();await page.screenshot({path:path.join(out,'continuation-mobile.png')});result.checks.push('original navigation automatically activates supported context; original folded history and normal composer coexist','verified native thread/project/model; original Lead task/attempt retained; exactly one resume/dispatch','old queued input and historical approval are never replayed');
 await browser.close();browser=undefined;host.kill('SIGINT');await new Promise(r=>host.once('exit',r));host=undefined;for(let i=0;i<200&&fs.existsSync(path.join(source,'daemon/daemon.lock'));i++)await wait(10);
 if(multi)fs.renameSync(projectA,path.join(root,'unavailable-initial-project'));
 launch=await start();const auth=await fetch(launch.base+'/auth',{method:'POST',headers:{Origin:launch.base},body:new URL(launch.link.url).hash.slice(1)}),cookie=auth.headers.get('set-cookie').split(';')[0];w=await(await fetch(launch.base+'/api/workspace',{headers:{Cookie:cookie}})).json();assert.equal(w.sessions.find(s=>s.id===sid).native.thread,thread);assert.equal(w.receipts.length,result.multiReceiptCount??1);assert.equal(fs.readFileSync(path.join(root,'dispatch-count'),'utf8'),result.multiDispatch??'dispatch\n');if(multi){const h=await fetch(launch.base+'/api/history/sessions/'+sidA,{headers:{Cookie:cookie}});assert.equal(h.status,200);const refused=await fetch(launch.base+'/api/history/sessions/'+sidA+'/activate',{method:'POST',headers:{Cookie:cookie,Origin:launch.base,'Content-Type':'application/json'},body:'{}'});assert.equal(refused.status,409);result.checks.push('missing initial project still opens same saved origin and history; missing-root activation refuses');}result.checks.push('restart retains original native identity and does not replay completed or historical work');assert.equal(fs.readFileSync(path.join(baseSession,'events/000001.jsonl'),'utf8'),raw);
 result.passed=true;
}catch(error){result.failure=safeError(error);if(page&&!page.isClosed()){result.ui=await page.evaluate(()=>({title:document.querySelector('h1')?.textContent,draft:document.querySelector('#prompt')?.value,sendDisabled:document.querySelector('.composer .send')?.disabled,availability:document.querySelector('.app-error')?.textContent})).catch(()=>null);await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}throw error;}finally{if(browser)await browser.close();if(host){host.kill('SIGINT');await Promise.race([new Promise(r=>host.once('exit',r)),wait(15000)]);if(host.exitCode===null){result.cleanupFailure='Host did not stop within fixture cleanup deadline';process.exitCode=1;}}result.seconds=(performance.now()-started)/1000;fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(!result.cleanupFailure)fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(safeError(e));process.exitCode=1;});
