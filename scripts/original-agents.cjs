// Production composition with disposable Deck1 events. Only the native process
// and delayed network delivery are faked; history, adoption and UI are real.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),crypto=require('crypto'),{spawn,execFileSync}=require('child_process'),{chromium}=require('playwright');
const binary=path.resolve(process.argv[2]||'dist/deck2'),out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/original-agents'),readonly=process.env.DECK2_AGENT_READONLY==='1';fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-agents-')),source=path.join(root,'original'),state=path.join(root,'state'),native=path.join(root,'native'),project=path.join(root,'project'),sid='original-a',thread='12345678-1234-1234-1234-123456789abc';
let host,browser,page,base,launcher;const wait=ms=>new Promise(r=>setTimeout(r,ms)),digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function dir(p){fs.mkdirSync(p,{recursive:true,mode:0o700});}function write(p,v){dir(path.dirname(p));fs.writeFileSync(p,Buffer.isBuffer(v)||typeof v==='string'?v:JSON.stringify(v),{mode:0o600});}
// Read only this disposable fixture's durable receipts; workspace observations
// are intentionally projected to the current context by the host.
const storedReceipts=()=>JSON.parse(execFileSync('python3',['-c',"import sqlite3,json,sys; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); print(json.dumps([json.loads(r[0]) for r in c.execute('SELECT body FROM receipts ORDER BY id')]))",path.join(state,'state.db')],{encoding:'utf8'}));
const trace=[];const record=(event,data={})=>trace.push({order:trace.length+1,ms:performance.now()-started,event,...data});
const result={passed:false,readonly,binary:digest(fs.readFileSync(binary)),checks:[]},started=performance.now();
(async()=>{try{
 const projects=[project,path.join(root,'project-b')];projects.forEach(dir);dir(path.join(root,'home'));
 write(path.join(source,'projects.json'),{v:1,projects:projects.map((p,i)=>({projectId:'project-'+digest(p).slice(0,24),path:p,name:'Project '+(i?'B':'A'),createdAt:'2026-01-01Z'}))});
 const inventories={};
 const imageId='22345678-1234-1234-1234-123456789abc',png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC','base64'),attachment={attachmentId:imageId,mimeType:'image/png',name:'agent.png',sizeBytes:png.length,width:1,height:1};
 for(const [si,session] of [sid,'original-b'].entries()){
  const project=projects[si],rows=[];write(path.join(source,'sessions',session,'attachments',imageId+'.image'),png);write(path.join(source,'sessions',session,'attachments',imageId+'.json'),{attachment,digest:digest(png),createdAt:1});const push=(kind,data={},taskId='lead',memberId='lead',attempt=1)=>{rows.push({v:1,sessionId:session,seq:rows.length+1,ts:'2026-01-01T00:00:00Z',kind,source:{taskId,memberId,attempt},data});};
  write(path.join(source,'sessions',session,'session.json'),{v:1,sessionId:session,projectRoot:project,title:'History '+(si?'B':'A'),createdAt:'2026-01-01T00:00:00Z',approvals:'relay',members:{lead:{runnerId:'codex',modelId:'gpt-6.1-sol'},'apply-deep':{runnerId:'codex',modelId:'gpt-6.1-sol'}}});
  push('session.created',{projectRoot:project,approvals:'relay'});push('task.created',{taskId:'lead',memberId:'lead',runnerId:'codex',modelId:'gpt-6.1-sol'});push('task.state',{state:'running',nativeSessionId:thread});push('message.completed',{role:'assistant',text:'Lead history '+session});push('task.state',{state:'completed',nativeSessionId:thread});
  for(const [task,member] of [['same-task','quality'],['second-task','investigate']]){
   for(let a=1;a<=2;a++){
    push(a===1?'task.created':'task.continued',a===1?{taskId:task,memberId:member,runnerId:'codex',modelId:'recorded-worker',assignedRoleId:'deck-'+member,continuityRole:member==='quality'?'review':'work',dependsOn:[]}:{taskId:task,attempt:a},task,member,a);
    push('task.state',{state:'running'},task,member,a);
    push('message.completed',{role:'user',text:session+' '+member+' assignment '+a,...(member==='quality'&&a===1?{attachments:[attachment]}:{})},task,member,a);
    for(let n=0;n<135;n++){
     push('message.delta',{text:'partial'},task,member,a);
     push('message.completed',{role:'assistant',text:session+' '+member+' attempt '+a+' line '+n},task,member,a);
    }
    push('task.result',{summary:session+' '+member+' report '+a},task,member,a);push('task.state',{state:'completed'},task,member,a);
   }
  }
  // Unknown identity remains unknown, including an absent attempt number.
  rows.push({v:1,sessionId:session,seq:rows.length+1,ts:'2026-01-01T00:00:00Z',kind:'message.completed',source:{taskId:'unknown-task'},data:{role:'assistant',text:'Unknown recorded conversation'}});
  push('prompt.queued',{promptId:'old','text':'NEVER REPLAY'});push('approval.resolved',{decision:'allow',by:'historical-grant'});
  const raw=rows.map(JSON.stringify).join('\n')+'\n'+(readonly?'incomplete':'');const file=path.join(source,'sessions',session,'events/000001.jsonl');write(file,raw);inventories[file]=digest(Buffer.from(raw));
 }
 write(path.join(native,'sessions/2026/01/01/rollout-fixture-'+thread+'.jsonl'),JSON.stringify({type:'session_meta',payload:{id:thread,cwd:project}})+'\n');
 const fake=path.join(root,'fake-codex');let fakeSource=fs.readFileSync(path.join(__dirname,'../crates/host/tests/fake_session_native.py'),'utf8');
 if(process.env.DECK2_ASSIGNMENT_JOURNEY==='1')fakeSource=fakeSource.replaceAll("  out({'method':'turn/completed',", "  out({'method':'thread/tokenUsage/updated','params':{'threadId':thread,'turnId':'normal-turn','tokenUsage':{'last':{'totalTokens':180000 if thread=='12345678-1234-1234-1234-123456789abc' else 34794},'modelContextWindow':258400}}})\n  out({'method':'turn/completed',");
 fs.writeFileSync(fake,fakeSource);fs.chmodSync(fake,0o700);write(path.join(root,'original-thread'),thread);
 async function start(){host=spawn(binary,['serve','--foreground','--project',project,'--state-dir',state,'--history-root',source,'--artifact-store',path.join(root,'tools'),'--no-open','--codex',fake],{stdio:['ignore','pipe','pipe'],env:{...process.env,HOME:path.join(root,'home'),CODEX_HOME:native}});let log='';host.stdout.on('data',b=>log+=b);host.stderr.on('data',b=>log+=b);for(let i=0;i<400;i++){if(fs.existsSync(path.join(state,'launcher.json'))){launcher=JSON.parse(fs.readFileSync(path.join(state,'launcher.json')));base='http://'+launcher.host;try{const r=await fetch(base+'/launch',{method:'POST',body:launcher.admin});if(r.ok){fs.writeFileSync(path.join(out,'host.log'),log);return (await r.json()).url;}}catch{}}if(host.exitCode!==null)throw Error(log);await wait(25);}throw Error('startup deadline');}
 async function stop(){host.kill('SIGINT');await Promise.race([new Promise(r=>host.once('exit',r)),wait(5000)]);assert.notEqual(host.exitCode,null);host=undefined;}
 let url=await start();browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||chromium.executablePath(),headless:true,args:['--no-sandbox']});page=await browser.newPage({viewport:{width:1365,height:900}});page.setDefaultTimeout(10000);
 // Network-edge fault: allow an already fetched response to arrive even after
 // client cancellation, exercising the render's own selection/abort checks.
 await page.addInitScript(()=>{const original=window.fetch.bind(window);window.fetch=(input,init)=>String(input).includes('/api/history/sessions/')?original(input,{...init,signal:undefined}):original(input,init);});
 // Trace the page's real network edge independently of direct backend probes.
 const requests=new WeakMap();let requestId=0;
 const identities=w=>w.tasks.map(t=>({task:t.id,session:t.session,attempt:t.attempts.at(-1)?.id,report:t.attempts.at(-1)?.report}));
 page.on('request',r=>{if(new URL(r.url()).pathname==='/api/workspace'){requests.set(r,++requestId);record('page-workspace-request',{request:requestId});}});
 page.on('response',async r=>{if(new URL(r.url()).pathname==='/api/workspace'){try{record('page-workspace-response',{request:requests.get(r.request()),tasks:identities(await r.json())});}catch(e){record('page-workspace-response-error',{error:String(e)});}}});
 await page.exposeFunction('recordTaskRender',data=>record('page-render',data));
 await page.addInitScript(()=>{let previous='';new MutationObserver(()=>{const data={cards:[...document.querySelectorAll('.task-card [data-task]')].map(n=>n.getAttribute('data-task')).sort(),detail:document.querySelector('.detail-card')?.textContent??null};const next=JSON.stringify(data);if(next!==previous){previous=next;void window.recordTaskRender(data);}}).observe(document,{childList:true,subtree:true,characterData:true});});
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.goto(url);
 const get=async p=>{const r=await page.request.get(base+p);assert.equal(r.status(),200,await r.text());return r.json();};
 async function openA(){const group=page.locator('.project-row button').filter({hasText:'Project A'}).first();await group.waitFor();if(await group.getAttribute('aria-expanded')!=='true')await group.click();await page.getByRole('button',{name:'History A',exact:false}).first().click();if(!readonly)await page.locator('#prompt:visible').waitFor();else await page.getByRole('heading',{name:'History A',exact:true}).waitFor();}
 async function agents(){if(!readonly&&await page.getByRole('button',{name:'Toggle workspace panel',exact:true}).getAttribute('aria-pressed')==='false')await page.getByRole('button',{name:'Toggle workspace panel',exact:true}).click();await page.getByRole('tab',{name:'Subagents',exact:true}).click();await page.getByRole('heading',{name:'Quality',exact:true}).waitFor();const back=page.getByRole('button',{name:'← Subagents',exact:true});if(await back.isVisible())await back.click();}
 await openA();await agents();let w=await get('/api/workspace');assert.equal(w.receipts.length,0);assert.equal(w.tasks.length,0,'historical tasks must stay out of executable store');assert(!fs.existsSync(path.join(root,'dispatch-count')));assert.equal(await page.getByRole('button',{name:'Cancel specialist',exact:true}).count(),0);assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('deck2.reply.')).length),0,'clipped historical previews must not acknowledge reports');
 const card=page.locator('.task-card').filter({has:page.getByRole('heading',{name:'Quality',exact:true})});await card.getByRole('button',{name:'Open full view'}).click();await page.getByText('original-a quality report 2',{exact:true}).waitFor();await page.getByText('original-a quality attempt 2 line 134',{exact:true}).waitFor();await page.waitForFunction(()=>Object.keys(localStorage).some(k=>k.startsWith('deck2.reply.')&&k.includes('original:2')));assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('deck2.reply.')&&k.includes('original:1')).length),0,'undisplayed attempt must remain unread');assert.equal(await page.getByText('Lead history original-a',{exact:true}).isVisible().catch(()=>false),!readonly);assert.equal(await page.getByText('original-a quality attempt 1 line 134',{exact:true}).count(),0);
 await page.getByRole('combobox',{name:'Task attempt'}).selectOption('original:1');await page.getByText('original-a quality report 1',{exact:true}).waitFor();await page.getByText('original-a quality attempt 1 line 134',{exact:true}).waitFor();for(let i=0;i<3;i++){const response=page.waitForResponse(r=>r.url().includes('taskId=same-task')&&r.url().includes('before='));await page.getByRole('button',{name:'Load older messages',exact:true}).last().click();await response;}
 assert(await page.locator('.detail-conversation article').count()<=120);await page.getByText('original-a quality assignment 1',{exact:true}).waitFor();await page.getByRole('button',{name:'View agent.png',exact:true}).click();await page.getByRole('dialog',{name:'Image preview'}).waitFor();await page.keyboard.press('Escape');
 result.checks.push('two agents/two attempts, assignment/runner/model/results, bounded attempt-only older pages, no executable task import or historical dispatch');
 // Hold an actual A response, switch to B, then deliver A after B is selected.
 let release,arrived,finished;const gate=new Promise(r=>release=r),held=new Promise(r=>arrived=r),done=new Promise(r=>finished=r);
 await page.route('**/api/history/sessions/original-a?**',async route=>{if(route.request().url().includes('attempt=2')){const response=await route.fetch();arrived();await gate;await route.fulfill({response});finished();}else await route.continue();});
 await page.getByRole('combobox',{name:'Task attempt'}).selectOption('original:2');await held;
 await page.locator('.project-row button').filter({hasText:'Project B'}).first().click();await page.getByRole('button',{name:'History B',exact:false}).first().click();await page.getByRole('heading',{name:'History B',exact:true}).waitFor();await page.getByRole('tab',{name:'Subagents',exact:true}).click();await page.getByRole('heading',{name:'Quality',exact:true}).waitFor();await page.locator('.task-card').filter({has:page.getByRole('heading',{name:'Quality',exact:true})}).getByRole('button',{name:'Open full view'}).click();await page.getByText('original-b quality attempt 2 line 134',{exact:true}).waitFor();release();await done;await page.unroute('**/api/history/sessions/original-a?**');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.equal(await page.getByText('original-a quality attempt 2 line 134',{exact:true}).isVisible().catch(()=>false),false);
 result.checks.push('overlapping task IDs across projects/sessions; delayed previous-attempt response cannot replace current selection');
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'← Subagents',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Quality',exact:true}).waitFor();await page.locator('.task-card').filter({has:page.getByRole('heading',{name:'Investigate',exact:true})}).getByRole('button',{name:'Open full view'}).focus();await page.keyboard.press('Enter');await page.getByText('original-b investigate report 2',{exact:true}).waitFor();await page.screenshot({path:path.join(out,'mobile.png')});
 assert.equal(await page.getByRole('button',{name:'Cancel specialist',exact:true}).count(),0);assert.deepEqual(errors,[]);result.checks.push('mobile, keyboard selection/back focus, reduced motion, recorded state without live cancellation/context');
 let live,continued;
 const renderedCards=()=>page.locator('.task-card [data-task]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-task')).sort());
 const historical=['same-task','second-task','unknown-task'].map(id=>JSON.stringify(['original',project,id])).sort();
 async function assertCoexistence(){
  assert.deepEqual(await renderedCards(),[...historical,live.id].sort(),'historical/live identities must be complete and distinct');
  assert.equal(await page.getByRole('button',{name:'Open full view',exact:true}).count(),4,'three historical cards plus one Rust task');
  for(const [owner,report] of [['Quality','original-a quality report 2'],['Investigate','original-a investigate report 2']]){
   const card=page.locator('.task-card').filter({has:page.getByRole('heading',{name:owner,exact:true})});await card.getByText(continued&&owner==='Quality'?continued.attempts.at(-1).report.text:report,{exact:true}).waitFor();
  }
 }
 async function openLive(){
  const a=live.attempts.at(-1);
  const exact=page.locator('[data-task='+JSON.stringify(live.id)+']').locator('..');
  await exact.getByText(a.report.text,{exact:true}).waitFor();
  const transcript=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/sessions/${live.session}/tasks/${live.id}/attempts/${a.id}/transcript`);
  await exact.getByRole('button',{name:'Open full view',exact:true}).click();
  const response=await transcript,body=await response.json();assert.equal(body.task,live.id);assert.equal(body.attempt,a.id);assert.equal(body.session,live.session);
  await page.locator('.detail-card').getByText(a.report.text,{exact:true}).waitFor();
  record('exact-live-full-view',{task:live.id,attempt:a.id,report:a.report,transcript:{task:body.task,attempt:body.attempt,session:body.session}});
 }
 if(!readonly){
  await page.setViewportSize({width:1365,height:900});await openA();await agents();assert.deepEqual(await renderedCards(),historical);
  let releaseWorkspace,backendComplete,responseHeld,responseDelivered;
  const releaseGate=new Promise(r=>releaseWorkspace=r),backendGate=new Promise(r=>backendComplete=r),heldGate=new Promise(r=>responseHeld=r),deliveredGate=new Promise(r=>responseDelivered=r);
  const deadline=async(p,label)=>{let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error(label+' deadline')),10000))]);}finally{clearTimeout(timer);}};
  let gated=false;
  await page.route('**/api/workspace',async route=>{
   const response=await route.fetch(),workspace=await response.json();
   if(!workspace.tasks.length||gated){await route.fulfill({response});return;}
   gated=true;record('workspace-delivery-blocked',{request:requests.get(route.request()),tasks:identities(workspace)});
   // Keep this poll pending while an independent backend probe observes the
   // completed report, then pin that real response before permitting delivery.
   const expected=await backendGate,fresh=await route.fetch(),body=await fresh.json();
   const task=body.tasks.find(t=>t.id===expected.id);assert(task,'held response must contain exact task');assert.equal(task.session,expected.session);assert.equal(task.attempts.at(-1).id,expected.attempts.at(-1).id);assert.deepEqual(task.attempts.at(-1).report,expected.attempts.at(-1).report);
   record('completed-workspace-response-held',{request:requests.get(route.request()),tasks:identities(body)});responseHeld();await releaseGate;
   record('workspace-release',{request:requests.get(route.request()),tasks:identities(body)});await route.fulfill({response:fresh});responseDelivered();
  });
  await page.locator('#prompt').fill('Delegate fixture apply-deep report');await page.getByRole('button',{name:'Send question',exact:true}).click();
  for(let i=0;i<400;i++){w=await get('/api/workspace');if(w.tasks.length&&w.tasks.every(t=>t.attempts.at(-1).report))break;await wait(25);}
  assert.equal(w.tasks.length,1,'one fresh Rust task required');live=w.tasks[0];assert.equal(live.session,sid);assert(live.attempts.at(-1).report,'fresh Rust report missing');record('backend-confirmed-completed-task',{tasks:identities(w)});backendComplete(live);
  await deadline(heldGate,'workspace response hold');
  assert.deepEqual(await renderedCards(),historical,'page must remain historical-only while workspace delivery is held');assert.equal(await page.getByRole('button',{name:'Open full view',exact:true}).count(),3);
  const staleCount=await page.getByRole('button',{name:'Open full view',exact:true}).count();assert.throws(()=>assert.equal(staleCount,4),/3 !== 4/,'predecessor count assertion must fail before page delivery');record('predecessor-assertion-fails-while-held',{expected:4,actual:staleCount});
  record('held-historical-only-assertion',{cards:await renderedCards(),missingLiveTask:live.id});await page.screenshot({path:path.join(out,'workspace-held.png')});
  releaseWorkspace();await deadline(deliveredGate,'workspace delivery');
  const exact=page.locator('[data-task='+JSON.stringify(live.id)+']').locator('..');await exact.getByText(live.attempts.at(-1).report.text,{exact:true}).waitFor();record('exact-live-card-rendered',{task:live.id,attempt:live.attempts.at(-1).id,report:live.attempts.at(-1).report,cards:await renderedCards()});
  await assertCoexistence();await openLive();await page.getByRole('button',{name:'← Subagents',exact:true}).click();await assertCoexistence();await page.unroute('**/api/workspace');
  result.checks.push('deterministic workspace hold/release: exact fresh task/attempt/report reaches card and full view without refresh/reopen, all historical cards retained');
 }
 if(!readonly){
  await page.locator('#prompt').fill('Continue original-task');await page.getByRole('button',{name:'Send question',exact:true}).click();
  for(let i=0;i<400;i++){if(fs.existsSync(path.join(root,'ready-original-continued')))break;await wait(25);}
  assert(fs.existsSync(path.join(root,'ready-original-continued')),'continued native task reached its current input');
  const quality=page.locator('.task-card').filter({has:page.getByRole('heading',{name:'Quality',exact:true})});
  await quality.getByText(/Attempt 3/).waitFor();assert.equal(await page.getByRole('heading',{name:'Quality',exact:true}).count(),1,'continued task must merge, not duplicate');
  await quality.getByRole('button',{name:'Open full view'}).click();await page.getByRole('button',{name:'Cancel specialist',exact:true}).waitFor();assert(await page.getByRole('button',{name:'Cancel specialist',exact:true}).isEnabled());
  const select=page.getByRole('combobox',{name:'Task attempt'});assert.deepEqual(await select.locator('option').allTextContents().then(v=>v.map(x=>x.split(' · ')[0])),['1','2','3']);
  await select.selectOption('original:2');await page.getByText('original-a quality report 2',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Cancel specialist',exact:true}).count(),0,'old attempts stay passive in merged card');
  await select.selectOption('original:1');await page.getByText('original-a quality report 1',{exact:true}).waitFor();
  let releaseContinued,heldContinued,deliveredContinued,failedContinued;
  const continuationGate=new Promise(r=>releaseContinued=r),continuationHeld=new Promise(r=>heldContinued=r),continuationDelivered=new Promise((r,reject)=>{deliveredContinued=r;failedContinued=reject;});let heldOnce=false;
  const continuationRoute=async route=>{try{const response=await route.fetch(),body=await response.json(),task=body.tasks.find(t=>t.original?.task_id==='same-task');if(!heldOnce&&task?.attempts.at(-1)?.report){heldOnce=true;record('continued-result-held',{task:task.id,attempt:task.attempts.at(-1)});heldContinued();await continuationGate;record('continued-result-release',{task:task.id,attempt:task.attempts.at(-1)});await route.fulfill({response});deliveredContinued();}else if(heldOnce)await route.abort();else await route.fulfill({response});}catch(e){record('continuation-route-error',{error:String(e)});failedContinued(e);}};
  await page.route('**/api/workspace',continuationRoute);
  write(path.join(root,'release-original-continued'),'released');
  for(let i=0;i<400;i++){w=await get('/api/workspace');continued=w.tasks.find(t=>t.original?.task_id==='same-task');if(continued?.attempts.at(-1)?.report)break;await wait(25);}
  assert(continued?.attempts.at(-1)?.report);assert.equal(continued.attempts.length,1,'old attempts stay out of execution store');assert.equal(continued.attempts[0].number,3);assert.equal(continued.owner,'quality');assert.equal(continued.session,sid);assert.equal(continued.attempts[0].requested_model,'recorded-worker');
  let holdTimer;try{await Promise.race([continuationHeld,new Promise((_,reject)=>holdTimer=setTimeout(()=>reject(Error('continued delivery deadline')),10000))]);}finally{clearTimeout(holdTimer);}
  assert.equal(await page.getByText('original-a quality report 1',{exact:true}).count(),1,'held workspace result must preserve selected old attempt');
  await select.selectOption(continued.attempts[0].id);assert.equal(await page.locator('.detail-card .task-result').count(),0,'current report must remain absent while its response is held');
  releaseContinued();await continuationDelivered;await page.locator('.detail-card').getByText(continued.attempts[0].report.text,{exact:true}).waitFor();
  await page.unroute('**/api/workspace',continuationRoute);
  assert.equal(await page.getByRole('button',{name:'Cancel specialist',exact:true}).count(),0,'settled live attempt has no cancel');
  await page.getByRole('button',{name:'← Subagents',exact:true}).click();await assertCoexistence();assert.equal(await renderedCards().then(ids=>ids.length),4);
  result.checks.push('explicit original continuation: one merged card, attempts1/2/3, immutable owner/model/project, live cancel while running and passive old routes, deterministic delayed current result');
 }
 let evolvedAssignment;
 if(!readonly && process.env.DECK2_ASSIGNMENT_JOURNEY==='1'){
  for(let i=0;i<400;i++){w=await get('/api/workspace');if(w.receipts.some(r=>r.continuation?.task===continued.id&&r.continuation?.attempt===continued.attempts[0].id&&r.phase==='completed')&&w.receipts.every(r=>!['accepted','preparing','dispatching','running','waiting_input','cancelling','uncertain','queued'].includes(r.phase)))break;await wait(25);}
  assert(w.receipts.some(r=>r.continuation?.task===continued.id&&r.phase==='completed'),'current continuation outcome must settle before assignment baseline');
  record('lead-context-before',{session:w.sessions.find(s=>s.id===sid),receipts:w.receipts});
  const before=w.sessions.find(s=>s.id===sid);assert(before?.original);const taskHistory=JSON.stringify(w.tasks.map(t=>({id:t.id,attempts:t.attempts}))),receiptHistory=JSON.stringify(storedReceipts());
  const leadContext=page.getByRole('button',{name:/^Lead context details:/});
  await leadContext.filter({hasText:'180k'}).waitFor();await leadContext.click();
  await page.getByRole('dialog',{name:'Lead context',exact:true}).locator('.context-window-counts').filter({hasText:'180,000'}).waitFor();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Settings',exact:true}).first().click();await page.getByRole('button',{name:'Session',exact:true}).click();
  await page.getByRole('button',{name:'Session assignments',exact:true}).focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog',{name:'Session assignments',exact:true});await dialog.waitFor();
  await dialog.getByRole('combobox',{name:'Model for Lead',exact:true}).selectOption('openai-codex/gpt-6.1-sol');
  await dialog.getByRole('combobox',{name:'Reasoning level for Lead',exact:true}).selectOption('high');
  const saved=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/sessions/${sid}/assignments`&&r.request().method()==='POST');
  await dialog.getByRole('button',{name:'Save Lead assignment',exact:true}).focus();await page.keyboard.press('Enter');
  const response=await saved;assert.equal(response.status(),200,await response.text());evolvedAssignment=await response.json();
  assert.deepEqual(evolvedAssignment.original,before.original);assert.equal(evolvedAssignment.original_generation,before.original_generation);assert.equal(evolvedAssignment.contract.generation,before.contract.generation+1);assert.equal(evolvedAssignment.contract.leadTask,before.contract.leadTask);assert.equal(evolvedAssignment.contract.approvals,before.contract.approvals);assert.equal(evolvedAssignment.native,null);
  await dialog.getByRole('button',{name:'Done',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.getByRole('button',{name:'Back to session',exact:true}).click();
  record('lead-context-after-assignment',{session:evolvedAssignment,reading:await leadContext.innerText()});
  await leadContext.filter({hasText:'Context unavailable'}).waitFor();await leadContext.click();
  const cleared=page.getByRole('dialog',{name:'Lead context',exact:true});await cleared.getByText('Not reported yet',{exact:true}).waitFor();assert(!await cleared.getByText('180,000',{exact:true}).count());await page.keyboard.press('Escape');
  w=await get('/api/workspace');record('lead-context-after-workspace',{receipts:w.receipts});assert.equal(JSON.stringify(storedReceipts()),receiptHistory,'saving Lead preserves exact historical receipts/observations');assert.equal(JSON.stringify(w.tasks.map(t=>({id:t.id,attempts:t.attempts}))),taskHistory,'saving defaults preserves historical attempts/observations');
  write(path.join(root,'original-thread'),'32345678-1234-1234-1234-123456789abc');
  const previous=fs.readFileSync(path.join(root,'wire'),'utf8').trim().split('\n').length;
  await page.locator('#prompt').fill('Assignment reseed current input');await page.getByRole('button',{name:'Send question',exact:true}).click();
  let current;for(let i=0;i<400;i++){w=await get('/api/workspace');current=w.receipts.find(r=>r.prompt==='Assignment reseed current input');if(current?.phase==='completed')break;if(current?.phase==='failed')throw Error(current.detail);await wait(25);}assert.equal(current?.phase,'completed');
  const wire=fs.readFileSync(path.join(root,'wire'),'utf8').trim().split('\n').slice(previous).map(JSON.parse);const prepared=wire.find(v=>v.method==='thread/start'),turn=wire.find(v=>v.method==='turn/start');assert(prepared,'Lead reassignment starts a fresh context');assert(!wire.some(v=>v.method==='thread/resume'));assert.equal(prepared.params.model,'gpt-6.1-sol');assert.equal(turn.params.model,'gpt-6.1-sol');assert.equal(turn.params.effort,'high');const prompt=turn.params.input.map(i=>i.text||'').join('\n');assert(prompt.includes('Original public history source='));assert(prompt.includes('session='+sid));assert(prompt.includes('Assignment reseed current input'));assert(!prompt.includes('NEVER REPLAY'));evolvedAssignment=w.sessions.find(s=>s.id===sid);assert.equal(evolvedAssignment.native.thread,'32345678-1234-1234-1234-123456789abc');assert.deepEqual(evolvedAssignment.original,before.original);
  record('lead-context-new-context',{session:evolvedAssignment,receipt:current});
  await leadContext.filter({hasText:'34.8k'}).waitFor();await leadContext.click();await page.getByRole('dialog',{name:'Lead context',exact:true}).locator('.context-window-counts').filter({hasText:'34,794'}).waitFor();await page.keyboard.press('Escape');
  assert.deepEqual(storedReceipts().filter(r=>r.id!==current.id),JSON.parse(receiptHistory),'new current reading preserves all old receipts');
  result.checks.push('old usage clears after assignment; popup is unavailable; matching new context usage returns; exact historical receipts remain');
  result.checks.push('adopted assignment through existing keyboard/reduced-motion controls: stable public alias, fresh native wire model/effort, bounded original public provenance, preserved tasks and source');
 }
 await page.screenshot({path:path.join(out,'desktop.png')});const dispatchFile=path.join(root,'dispatch-count'),dispatchBefore=fs.existsSync(dispatchFile)?fs.readFileSync(dispatchFile,'utf8'):'';record('before-restart',{dispatches:dispatchBefore.split('\n').filter(Boolean).length});await stop();url=await start();await page.goto(url);await page.setViewportSize({width:1365,height:900});await openA();await agents();assert.equal(await page.getByRole('heading',{name:'Quality',exact:true}).count(),1);if(live){await assertCoexistence();await openLive();assert.equal((await get('/api/workspace')).tasks.length,continued?2:1,'restart must not replay or duplicate delegation');}result.checks.push('restart preserves historical/live identity and exact report without duplicated cards or replay');
 if(evolvedAssignment){const after=(await get('/api/workspace')).sessions.find(s=>s.id===sid);assert.deepEqual(after,evolvedAssignment,'reactivation/restart must keep new assignment/thread and original provenance');await page.getByRole('button',{name:/^Lead context details:.*34.8k/}).waitFor();result.checks.push('reassigned original session survives restart/reactivation without reverting generation/context or replaying earlier input');}
 assert.equal(fs.existsSync(dispatchFile)?fs.readFileSync(dispatchFile,'utf8'):'',dispatchBefore,'restart/history inspection must not replay native dispatch');assert.deepEqual(errors,[]);
 if(evolvedAssignment){
  // Retained task evidence deliberately blocks release. Exercise release on a
  // distinct task-free connected session, preserving the original task guard.
  const releaseSession='release-context-fixture';
  const created=await page.request.post(base+'/api/sessions',{headers:{origin:base},data:{api:7,id:releaseSession,title:'Release context fixture',project_id:evolvedAssignment.project.id,members:{lead:{runnerId:'codex',modelId:'gpt-6.1-sol'}}}});assert.equal(created.status(),200,await created.text());
  await page.getByRole('button',{name:/Release context fixture/}).click();
  write(path.join(root,'original-thread'),'42345678-1234-1234-1234-123456789abc');
  await page.locator('#prompt').fill('Release context reading');await page.getByRole('button',{name:'Send question',exact:true}).click();
  let releaseReading;for(let i=0;i<400;i++){w=await get('/api/workspace');releaseReading=w.receipts.find(r=>r.session===releaseSession);if(releaseReading?.phase==='completed')break;if(releaseReading?.phase==='failed')throw Error(releaseReading.detail);await wait(25);}assert.equal(releaseReading?.phase,'completed');
  await page.getByRole('button',{name:/^Lead context details:.*34.8k/}).waitFor();
  const preserved=storedReceipts(),dispatches=fs.readFileSync(dispatchFile,'utf8');
  await page.getByRole('tab',{name:'Activity',exact:true}).click();
  const released=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/sessions/${releaseSession}/release`&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Release saved native context',exact:true}).click();const response=await released;assert.equal(response.status(),200,await response.text());
  await page.getByRole('button',{name:/^Lead context details: Context unavailable/}).waitFor();
  assert.deepEqual(storedReceipts(),preserved,'release preserves exact durable receipt observations');
  await stop();url=await start();await page.goto(url);await page.getByRole('button',{name:/Release context fixture/}).click();
  await page.getByRole('button',{name:/^Lead context details: Context unavailable/}).waitFor();
  assert.equal((await get('/api/workspace')).sessions.find(s=>s.id===releaseSession).native,null);
  assert.deepEqual(storedReceipts(),preserved,'restart after release preserves exact durable observations');
  assert.equal(fs.readFileSync(dispatchFile,'utf8'),dispatches,'release/restart must not replay');assert.deepEqual(errors,[]);
  result.checks.push('task-free session release and second restart clear the visible reading without changing stored historical observations or replay');
 }
 record('restart-no-replay',{dispatches:dispatchBefore.split('\n').filter(Boolean).length});
 for(const [file,hash] of Object.entries(inventories))assert.equal(digest(fs.readFileSync(file)),hash,'original event bytes changed');result.passed=true;
 }catch(e){result.failure=String(e);if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw e;}finally{if(browser)await browser.close();if(host){host.kill('SIGINT');await Promise.race([new Promise(r=>host.once('exit',r)),wait(5000)]);}fs.writeFileSync(path.join(out,'workspace-trace.json'),JSON.stringify(trace,null,2));result.seconds=(performance.now()-started)/1000;fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}})().catch(e=>{console.error(e);process.exitCode=1;});
