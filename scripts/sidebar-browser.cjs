// Real embedded host, disposable projects/history and the existing native transport fake.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),crypto=require('crypto'),{spawn,execFileSync}=require('child_process');
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
const orderOnly=process.argv.includes('--sidebar-order-only');
const attentionOnly=process.argv.includes('--sidebar-attention-only');
const redesignOnly=process.argv.includes('--sidebar-redesign-only');
const inspectorOnly=process.argv.includes('--sidebar-inspector-only');
const binary=path.resolve(process.argv[2]),out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'../browser-evidence');fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck-sidebar-')),project=path.join(root,'Deck'),second=path.join(root,'Naf EC'),state=path.join(root,'state'),original=path.join(root,'original');
const wait=ms=>new Promise(r=>setTimeout(r,ms)),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,typeof v==='string'?v:JSON.stringify(v),{mode:0o600});}
for(const p of [project,second,original])fs.mkdirSync(p,{recursive:true,mode:0o700});
execFileSync('git',['init','--quiet',second]);
const pid='project-'+hash(project).slice(0,24),secondPid='project-'+hash(second).slice(0,24),files=[],missing=path.join(root,'missing-project'),missingPid='project-'+hash(missing).slice(0,24);
write(path.join(original,'projects.json'),{v:1,projects:[{projectId:pid,path:project,name:'Deck',createdAt:'2026-01-01T00:00:00Z'},{projectId:missingPid,path:missing,name:'Archived project',createdAt:'2026-01-01T00:00:00Z'},...(orderOnly||redesignOnly?[{projectId:secondPid,path:second,name:'Naf EC',createdAt:'2026-01-01T00:00:00Z'}]:[])]});
for(const [i,title] of ['whisper','Terminal','Collision history',...(orderOnly||redesignOnly?['Foreign history']:[])].entries()){
 const owner=title==='Foreign history'?{projectRoot:second,projectId:secondPid}:{projectRoot:project,projectId:pid};
 const sid='sidebar-original-'+i,base=path.join(original,'sessions',sid);
 for(const [name,data] of [['session.json',{v:1,sessionId:sid,...owner,title,createdAt:'2026-01-01T00:00:00Z',members:{lead:{runnerId:'opencode',modelId:'saved-model'}},approvals:'relay'}],['events/000001.jsonl',JSON.stringify({v:1,sessionId:sid,seq:1,ts:'2026-01-01T00:00:00Z',kind:'message.completed',source:{taskId:'lead',memberId:'lead',runnerId:'opencode'},data:{role:'assistant',text:'Preserved conversation '+title}})+'\n']]){const p=path.join(base,name);write(p,data);files.push([p,hash(fs.readFileSync(p))]);}
}
const deviceToken=crypto.randomBytes(32).toString('base64url');write(path.join(original,'web/devices.json'),[{id:'sidebar-browser',name:'Sidebar browser',createdAt:'2026-01-01T00:00:00Z',hash:hash(deviceToken)}]);
const fake=path.join(root,'fake-codex');let transport=fs.readFileSync(path.resolve('crates/host/tests/fake_session_native.py'),'utf8');transport=transport.replace("  out({'method':'item/agentMessage/delta','params':{'threadId':thread,'turnId':turn,'delta':'Connected reply'}})",`  out({'method':'item/started','params':{'threadId':thread,'turnId':turn,'item':{'type':'agentMessage','id':'final'}}})
  out({'method':'item/agentMessage/delta','params':{'threadId':thread,'turnId':turn,'delta':'Connected reply'}})
  out({'method':'item/completed','params':{'threadId':thread,'turnId':turn,'item':{'type':'agentMessage','id':'final','phase':'final_answer','text':'Connected reply'}}})`);
if(attentionOnly){
 transport=transport.replace("pending_mcp=None","pending_mcp=None\nsidebar_requests=set()");
 transport=transport.replace(" if not m and v.get('id')==80:",` if not m and v.get('id') in sidebar_requests:
  sidebar_requests.remove(v['id'])
  with (root/'sidebar-permission-responses').open('a') as log:
   log.write(json.dumps({'id':v['id'],'decision':v.get('result',{}).get('decision')})+'\\n')
  if not sidebar_requests:
   out({'method':'turn/completed','params':{'threadId':thread,'turn':{'id':turn,'status':'completed'}}})
  continue
 if not m and v.get('id')==80:`);
 transport=transport.replace("  if 'Native command' in text:",`  if text=='Native command attention fixture':
   for request_id,command in [(90,'write first-fixture.txt'),(91,'write second-fixture.txt')]:
    sidebar_requests.add(request_id)
    out({'id':request_id,'method':'item/commandExecution/requestApproval','params':{'threadId':thread,'turnId':turn,'itemId':'command-'+str(request_id),'command':command,'cwd':str(root)}})
   continue
  if 'Native command' in text:`);
}
fs.writeFileSync(fake,transport,{mode:0o700});
let host,browser,page;let log='';
const hostArgs=['serve','--foreground','--project',project,'--state-dir',state,'--history-root',original,'--artifact-store',path.join(root,'tools'),'--codex',fake,'--no-open'];
async function startHost(){host=spawn(binary,hostArgs,{stdio:['ignore','pipe','pipe']});host.stdout.on('data',b=>log+=b);host.stderr.on('data',b=>log+=b);for(let i=0;i<1200;i++){if(host.exitCode!==null)throw Error(log);if(fs.existsSync(path.join(state,'launcher.json'))){try{const launcher=JSON.parse(fs.readFileSync(path.join(state,'launcher.json')));const response=await fetch('http://'+launcher.host+'/launch',{method:'POST',body:launcher.admin});if(response.ok)return {launcher,link:await response.json()};}catch{}}await wait(50);}throw Error('Host readiness timed out; see sanitized host.log');}
async function stopHost(){const child=host;await new Promise((resolve,reject)=>{child.once('exit',resolve);child.kill('SIGTERM');setTimeout(()=>{if(child.exitCode===null){child.kill('SIGKILL');reject(Error('Host shutdown timed out'));}},3000).unref();});}
const errors=[],checks=[],report={binary:hash(fs.readFileSync(binary)),root,checks};
(async()=>{try{
 let {launcher,link}=await startHost();let base='http://'+launcher.host;
 browser=await chromium.launch({headless:true,executablePath:process.env.DECK2_CHROMIUM||'/home/kevin15011/.cache/ms-playwright/chromium-1237/chrome-linux64/chrome',args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(7000);await page.context().addCookies([{name:'deck_device',value:deviceToken,url:base,httpOnly:true,sameSite:'Strict'}]);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')console.error('BROWSER',m.text());});
 await page.addInitScript(()=>{if(!localStorage.getItem('deck.theme'))localStorage.setItem('deck.theme','one-dark-pro');});
 if(process.env.DECK2_SIDEBAR_ASSETS){
  report.browserAssets={};
  for(const file of ['app.js','app.css']){
   const asset=path.join(process.env.DECK2_SIDEBAR_ASSETS,file);
   report.browserAssets[file]=hash(fs.readFileSync(asset));
   await page.route(url=>url.origin===base&&url.pathname==='/'+file,route=>route.fulfill({path:asset}));
  }
 }
 if(inspectorOnly){
  await page.addInitScript(()=>localStorage.setItem('deck2.sidebar-pinned','false'));
  await page.goto(link.url,{waitUntil:'domcontentloaded'});
  const prompt=page.locator('#prompt');
  const opener=page.getByRole('button',{name:/^Open projects and sessions/});
  const inspectorButton=page.getByRole('button',{name:'Open Subagents',exact:true});
  const inspector=page.getByRole('dialog',{name:'Session inspector',exact:true});
  const panel=page.getByRole('dialog',{name:'Projects and sessions',exact:true});
  const draft='Keep this draft while reviewing Subagents';
  await prompt.waitFor();
  const {session}=await page.evaluate(async()=>await (await fetch('/api/workspace')).json());
  await inspectorButton.click();
  await inspector.getByRole('tab',{name:'Subagents',selected:true}).waitFor();
  await inspector.getByRole('button',{name:'Dock inspector'}).click();
  for(const mode of ['docked','floating']){
   await prompt.fill(draft);
   await prompt.focus();
   await page.mouse.move(8,340);
   await panel.waitFor();
   assert(await inspector.isVisible(),`the ${mode} inspector stays visible with the left drawer open`);
   assert(await panel.evaluate(el=>!el.matches(':modal')),'hover leaves the drawer modeless');
   const title=`Workspace refreshed while pointer is stationary (${mode})`;
   const renamed=await page.evaluate(async({id,title})=>{
    const response=await fetch('/api/sessions/'+id+'/rename',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api:7,title})});
    return response.status;
   },{id:session,title});
   assert.equal(renamed,200);
   await page.getByRole('heading',{name:title,exact:true}).waitFor();
   assert(await panel.isVisible(),'workspace refresh keeps the drawer open with a stationary pointer');
   assert(await inspector.isVisible(),'workspace refresh keeps the inspector open');
   assert(await prompt.evaluate(el=>el===document.activeElement),'hover and refresh retain composer focus');
   assert.equal(await prompt.inputValue(),draft);
   await page.mouse.move(100,340,{steps:4});
   await page.waitForTimeout(250);
   assert(await panel.isVisible(),'moving from the edge into the drawer keeps it open');
   await page.mouse.move(600,340);
   await panel.waitFor({state:'hidden'});
   if(mode==='docked')await inspector.getByRole('button',{name:'Float inspector'}).click();
  }
  checks.push('Docked and floating Subagents coexist with the edge drawer through a live workspace refresh, preserving composer focus and draft');

  await opener.click();
  await panel.waitFor();
  assert(await panel.evaluate(el=>el.matches(':modal')),'explicit sidebar opening remains modal with the inspector open');
  await page.keyboard.press('Escape');
  await panel.waitFor({state:'hidden'});
  assert(await inspector.isVisible(),'closing the explicit drawer retains the inspector');

  await page.setViewportSize({width:860,height:640});
  await inspector.getByRole('button',{name:'Dock inspector'}).waitFor({state:'hidden'});
  await page.mouse.move(8,340);
  await page.waitForTimeout(250);
  assert.equal(await panel.isVisible(),false,'the narrow focus-contained inspector blocks edge hover');
  await opener.press('Enter');
  await panel.waitFor();
  assert(await panel.evaluate(el=>el.matches(':modal')),'keyboard can still open modal navigation in a narrow viewport');
  await page.keyboard.press('Escape');
  await panel.waitFor({state:'hidden'});
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const openerBox=await opener.boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:openerBox.x+openerBox.width/2,y:openerBox.y+openerBox.height/2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await panel.waitFor();
  assert(await panel.evaluate(el=>el.matches(':modal')),'tapping the opener still opens modal navigation');
  await cdp.detach();
  checks.push('Explicit keyboard and touch opening stay modal and the narrow inspector retains hover priority');
  assert.deepEqual(errors,[]);
  report.passed=true;
  console.log(JSON.stringify({passed:true,checks}));
  return;
 }
 if(attentionOnly){
  const api=async(url,body)=>page.evaluate(async({url,body})=>{
   const response=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api:7,...body})}:undefined);
   return {status:response.status,body:await response.json()};
  },{url,body});
  await page.goto(link.url,{waitUntil:'domcontentloaded'});
  const opener=page.getByRole('button',{name:/^Open projects and sessions/});
  if(!await opener.isVisible()){
   await page.getByRole('button',{name:'Unpin sidebar',exact:true}).click();
  }
  await opener.waitFor();
  const initialWorkspace=(await api('/api/workspace')).body;
  const initial=initialWorkspace.sessions.find(s=>s.id===initialWorkspace.session);
  const initialRoute=new URL(page.url()).search;
  for(const [url,body] of [
   ['/api/projects',{root:second,trusted:true}],
   ['/api/projects/'+secondPid+'/rename',{title:'Other project'}],
   ['/api/sessions',{id:'attention-background',project_id:secondPid,title:'Background review',members:{lead:{runnerId:'codex',modelId:'gpt-6.1-sol'}},approvals:'relay'}],
  ]){
   const result=await api(url,body);assert.equal(result.status,200,JSON.stringify(result.body));
  }
  const prompt=page.locator('#prompt');
  await prompt.fill('Draft in the current session');
  await prompt.focus();
  const command=crypto.randomUUID();
  const accepted=await api('/api/commands',{id:command,session:'attention-background',prompt:'Native command attention fixture',mode:'session_v1',fresh:false,queue:true,attachments:[]});
  assert.equal(accepted.status,200,JSON.stringify(accepted.body));
  await page.waitForFunction(async id=>(await(await fetch('/api/workspace')).json()).receipts.find(r=>r.id===id)?.decisions.filter(d=>d.state==='pending').length===2,command);
  const rail=page.getByRole('region',{name:'Sessions needing attention'});
  const title=rail.getByRole('button',{name:/^Background review Other project/});
  await title.waitFor();
  assert(await prompt.evaluate(el=>el===document.activeElement),'arrival retains composer focus');
  assert.equal(await prompt.inputValue(),'Draft in the current session');
  checks.push('Background native permission displays session and project without moving composer focus');
  const panel=page.getByRole('dialog',{name:'Projects and sessions'});
  const transcript=page.getByRole('region',{name:'Recorded messages'});
  for(const [width,height] of [[1440,900],[1440,680],[860,640]]){
   await page.setViewportSize({width,height});
   await page.mouse.move(500,height-16);
   for(const y of [16,Math.floor(height/2),height-16]){
    await page.mouse.move(10,y);
    await panel.waitFor();
    await page.mouse.move(100,y,{steps:4});
    await page.waitForTimeout(250);
    assert(await panel.isVisible(),'the drawer stays open after crossing into it');
    await page.mouse.move(500,y,{steps:4});
    await panel.waitFor({state:'hidden'});
   }
  }
  await page.setViewportSize({width:1440,height:900});
  const attentionTarget=await title.boundingBox();
  await page.mouse.move(attentionTarget.x+1,attentionTarget.y+attentionTarget.height/2);
  await page.waitForTimeout(250);
  assert(await title.isVisible(),'hovering the edge of an attention bubble preserves its action');
  assert.equal(await panel.isVisible(),false);
  const geometry=await transcript.boundingBox();
  await page.mouse.move(0,190);
  await panel.waitFor();
  assert.equal(await panel.evaluate(el=>el.matches(':modal')),false);
  await rail.waitFor({state:'hidden'});
  assert.deepEqual(await transcript.boundingBox(),geometry,'hover overlay preserves chat geometry');
  assert(await prompt.evaluate(el=>el===document.activeElement),'edge hover preserves composer focus');
  await page.mouse.move(100,190);
  await page.waitForTimeout(250);
  assert(await panel.isVisible(),'moving from edge into drawer retains it');
  await page.mouse.move(500,190);
  await panel.waitFor({state:'hidden'});
  await title.waitFor();
  await page.mouse.move(0,190);
  await panel.waitFor();
  await page.keyboard.press('Escape');
  await panel.waitFor({state:'hidden'});
  await page.mouse.move(1,195);
  await page.waitForTimeout(230);
  assert.equal(await panel.isVisible(),false,'dismissed hover stays closed while pointer remains at edge');
  assert(await prompt.evaluate(el=>el===document.activeElement),'hover dismissal preserves composer focus');
  await page.mouse.move(500,190);
  const usage=page.getByRole('button',{name:/Subscription usage, remaining quota/});
  await usage.click();
  const usagePanel=page.getByRole('region',{name:'Subscription usage',exact:true});
  await usagePanel.waitFor();
  await page.mouse.move(10,190);
  await page.waitForTimeout(250);
  assert.equal(await panel.isVisible(),false,'an open popover keeps the edge from revealing navigation');
  await page.keyboard.press('Escape');
  await usagePanel.waitFor({state:'hidden'});
  await page.mouse.move(9,200);
  await panel.waitFor();
  await page.mouse.move(500,200);
  await panel.waitFor({state:'hidden'});

  await opener.click();
  await panel.waitFor();
  assert(await panel.evaluate(el=>el.matches(':modal')),'explicit opening remains modal');
  await rail.waitFor({state:'hidden'});
  await panel.getByRole('button',{name:'Pin sidebar',exact:true}).click();
  await page.getByRole('navigation',{name:'Projects and sessions'}).waitFor();
  await rail.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Unpin sidebar',exact:true}).click();
  await title.waitFor();
  checks.push('Hover crossing, leave and dismissal stay modeless and preserve composer focus, geometry, explicit modal and docking');

  const trigger=rail.getByRole('button',{name:'Review permissions for Background review · Other project'});
  const review=rail.getByRole('region',{name:'Background review',exact:true});
  await trigger.press('Enter');
  await review.getByRole('button',{name:'Close permission review'}).waitFor();
  const firstReview=review.getByRole('region',{name:'Permission request'}).filter({hasText:'write first-fixture.txt'});
  const secondReview=review.getByRole('region',{name:'Permission request'}).filter({hasText:'write second-fixture.txt'});
  await firstReview.waitFor();
  await secondReview.waitFor();
  await page.mouse.move(0,190);
  await page.waitForTimeout(230);
  assert.equal(await panel.isVisible(),false,'edge hover does not override an open permission review');
  await page.screenshot({path:path.join(out,'attention-review-desktop.png')});
  await page.keyboard.press('Escape');
  await review.waitFor({state:'hidden'});
  assert(await trigger.evaluate(el=>el===document.activeElement),'Escape returns focus to review trigger');
  await trigger.click();
  const receipt=(await api('/api/workspace')).body.receipts.find(r=>r.id===command);
  const approval=receipt.decisions.find(d=>JSON.stringify(d.presentation.details).includes('first-fixture.txt'));
  const workspaceUrl=base+'/api/workspace';
  const holdReceipt=async snapshot=>page.route(workspaceUrl,async route=>{
   const response=await route.fetch();
   const body=await response.json();
   body.receipts=body.receipts.map(r=>r.id===snapshot.id?snapshot:r);
   await route.fulfill({response,json:body});
  });
  const approvalUrl=base+'/api/decisions/'+approval.id+'/responses';
  const approvals=[];
  await holdReceipt(receipt);
  await page.route(approvalUrl,async route=>{
   approvals.push(route.request().postDataJSON());
   const response=await route.fetch();
   if(approvals.length===1)await route.abort();
   else await route.fulfill({response});
  });
  await firstReview.getByRole('button',{name:'Allow once',exact:true}).click();
  await firstReview.locator('..').getByRole('alert').filter({hasText:'Connection lost'}).waitFor();
  await firstReview.getByRole('button',{name:'Deny',exact:true}).click();
  await firstReview.locator('..').getByRole('alert').filter({hasText:'identity is retained'}).waitFor();
  assert.equal(approvals.length,1,'changing the retained response sends no new authorization');
  const approvalResponse=page.waitForResponse(r=>r.url()===approvalUrl&&r.request().method()==='POST');
  await firstReview.getByRole('button',{name:'Allow once',exact:true}).click();
  const acknowledged=await approvalResponse;
  assert.equal(acknowledged.status(),200);
  assert.equal((await acknowledged.json()).session,'attention-background');
  assert.deepEqual(approvals,[approvals[0],approvals[0]],'retry reuses the exact original response identity');
  await page.unroute(approvalUrl);
  await page.unroute(workspaceUrl);
  await firstReview.waitFor({state:'hidden'});
  assert(await title.isVisible(),'session stays actionable while another request is pending');
  await secondReview.getByRole('button',{name:'Deny',exact:true}).click();
  await title.waitFor({state:'hidden'});
  assert.equal(await prompt.inputValue(),'Draft in the current session');
  assert.equal(new URL(page.url()).search,initialRoute);
  assert.deepEqual(fs.readFileSync(path.join(root,'sidebar-permission-responses'),'utf8').trim().split('\n').map(JSON.parse),[
   {id:90,decision:'accept'},{id:91,decision:'decline'},
  ]);
  checks.push('Keyboard review shows two live requests, prevents changed consent after a lost acknowledgment and delivers each chosen response exactly once');

  const next=crypto.randomUUID();
  const pending=await api('/api/commands',{id:next,session:'attention-background',prompt:'Native command attention deny fixture',mode:'session_v1',fresh:false,queue:true,attachments:[]});
  assert.equal(pending.status,200,JSON.stringify(pending.body));
  await title.waitFor();
  await title.click();
  await page.getByRole('heading',{name:'Background review',exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('session'),'attention-background');
  await opener.click();
  const originalGroup=panel.locator('.project-group').filter({has:page.getByRole('button',{name:'New session in Deck',exact:true})});
  const toggle=originalGroup.locator('.project-toggle');
  if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
  await originalGroup.getByRole('button',{name:initial.title,exact:true}).click();
  await panel.waitFor({state:'hidden'});
  await page.getByRole('heading',{name:initial.title,exact:true}).waitFor();
  assert.equal(await prompt.inputValue(),'Draft in the current session');

  await page.setViewportSize({width:390,height:844});
  await trigger.click();
  assert(await review.evaluate(el=>{const r=el.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}),'review fits mobile viewport');
  await page.screenshot({path:path.join(out,'attention-review-mobile.png')});
  await page.context().setOffline(true);
  await review.getByRole('status').filter({hasText:'Reconnect'}).waitFor();
  assert.equal(await review.getByRole('button',{name:'Deny',exact:true}).isEnabled(),false);
  await page.context().setOffline(false);
  await review.getByRole('status').filter({hasText:'Reconnect'}).waitFor({state:'hidden'});
  const denyDecision=(await api('/api/workspace')).body.receipts.find(r=>r.id===next).decisions.find(d=>d.state==='pending');
  const denyResponse=page.waitForResponse(r=>r.url()===base+'/api/decisions/'+denyDecision.id+'/responses'&&r.request().method()==='POST');
  await review.getByRole('button',{name:'Deny',exact:true}).click();
  const denied=await denyResponse;
  assert.equal(denied.status(),200);
  assert.equal((await denied.json()).resolution.response.type,'deny');
  await title.waitFor({state:'hidden'});
  assert.equal(await prompt.inputValue(),'Draft in the current session');
  assert.equal(new URL(page.url()).searchParams.get('session'),initial.id);
  assert.equal(fs.existsSync(path.join(root,'native-created.txt')),false);
  checks.push('Title uses ordinary two-project navigation and mobile denial leaves selected session, draft and native effect intact');
  const staleId=crypto.randomUUID();
  const staleInput=await api('/api/commands',{id:staleId,session:'attention-background',prompt:'Native command attention stale fixture',mode:'session_v1',fresh:false,queue:true,attachments:[]});
  assert.equal(staleInput.status,200,JSON.stringify(staleInput.body));
  await trigger.click();
  const staleReceipt=(await api('/api/workspace')).body.receipts.find(r=>r.id===staleId);
  const staleDecision=staleReceipt.decisions.find(d=>d.state==='pending');
  const staleUrl='/api/decisions/'+staleDecision.id+'/responses';
  await holdReceipt(staleReceipt);
  const competing=await api(staleUrl,{command_id:crypto.randomUUID(),expected_revision:staleDecision.revision,response:{type:'deny'}});
  assert.equal(competing.status,200);
  const staleResponse=page.waitForResponse(r=>r.url()===base+staleUrl&&r.request().method()==='POST');
  await review.getByRole('button',{name:'Allow once',exact:true}).click();
  assert.equal((await staleResponse).status(),409);
  await review.getByRole('alert').waitFor();
  await page.unroute(workspaceUrl);
  await title.waitFor({state:'hidden'});
  const actual=(await api('/api/workspace')).body.receipts.find(r=>r.id===staleId).decisions[0];
  assert.equal(actual.resolution.response.type,'deny');
  assert.equal(fs.existsSync(path.join(root,'native-created.txt')),false);
  checks.push('Disconnected actions disable, and a stale allow is rejected by the real host after external denial');
  assert.deepEqual(errors,[]);
  report.passed=true;
  return;
 }
 if(redesignOnly){
  await page.addInitScript(()=>{if(localStorage.getItem('deck.sidebar-collapsed')===null)localStorage.setItem('deck.sidebar-collapsed','true');});
  const current='sidebar-fixture-current',needsReview='sidebar-fixture-review',needsAnswer='sidebar-fixture-answer',working='sidebar-fixture-working';
  const session=(id,title,projectId,root)=>({id,title,project:{id:projectId,root,identity:null},native:null});
  const fixtureSessions=[
   session(current,'Current conversation',pid,project),session(needsReview,'Review deployment',pid,project),
   session(needsAnswer,'Confirm settings',secondPid,second),session(working,'Working only',secondPid,second),
   ...Array.from({length:36},(_,i)=>session('sidebar-fixture-'+i,'Fixture conversation '+i,pid,project)),
  ];
  const receipt=(session,phase,requests=[])=>{
   const id='receipt-'+session;
   return {id,session,phase,fresh:false,prompt:'Fixture task',text:'',detail:'',policy:'read-only',runner:'codex',delivery:'',
    model:null,thread:null,turn:null,native_pid:null,handshake_ms:null,dispatch_ms:null,first_output_ms:null,accepted_ms:1,
    revision:1,local_tool_calls:0,decisions:requests.map(([id,state,questions])=>({
     id,session,command:'receipt-'+session,attempt:'attempt',generation:'generation',thread:'thread',turn:'turn',item:id,
     request:id,detail:'',revision:1,state,questions,file:null,resolution:null,dispatch_ms:null,delivered_ms:null,grant_consumed:false
    }))};
  };
  const question={id:'answer',header:'Choice',question:'Choose a setting',options:[]};
  let incoming=false,resolved=false;
  await page.route(base+'/api/workspace',async route=>{
   const response=await route.fetch(),body=await response.json();
   const receipts=[
    receipt(working,'running'),receipt(current,'running',[['already-here','pending',[]]]),
    ...(incoming?[
     receipt(needsReview,'running',[['review',resolved?'settled':'pending',[]],['approve',resolved?'settled':'pending',[]],['delivered','delivered',[]]]),
     receipt(needsAnswer,'running',[['question','pending',[question]]]),
    ]:[]),
   ];
   await route.fulfill({response,json:{...body,session:current,sessions:[...fixtureSessions,...body.sessions],receipts}});
  });
  await page.route(base+'/api/sidebar',async route=>{
   const response=await route.fetch(),body=await response.json();
   await route.fulfill({response,json:{...body,decisions:{...body.decisions,[needsAnswer]:1}}});
  });
  await page.goto(link.url,{waitUntil:'domcontentloaded'});
  const opener=page.getByRole('button',{name:/^Open projects and sessions/});
  const panel=page.getByRole('dialog',{name:'Projects and sessions'});
  const transcript=page.getByRole('region',{name:'Recorded messages'});
  const geometry=async()=>await transcript.boundingBox();
  await opener.waitFor();
  await page.getByRole('heading',{name:'Current conversation',exact:true}).waitFor();
  await page.getByRole('button',{name:/1 other session needs attention/}).waitFor();
  assert.equal(await panel.count(),0);
  await opener.focus();
  incoming=true;
  await page.getByRole('button',{name:/2 other sessions need attention/}).waitFor();
  assert.equal(await panel.count(),0,'incoming attention leaves navigation closed');
  assert(await opener.evaluate(el=>el===document.activeElement),'incoming attention preserves focus');
  assert.match(await opener.getAttribute('title'),/2 other sessions need attention/);
  const bubbles=page.getByRole('region',{name:'Sessions needing attention'});
  await bubbles.getByRole('button',{name:/^Review deployment Deck Actions pending: 2/}).waitFor();
  const answerBubble=bubbles.getByRole('button',{name:/^Confirm settings Naf EC Actions pending: 2/});
  await answerBubble.press('Enter');
  await page.getByRole('heading',{name:'Confirm settings',exact:true}).waitFor();
  assert.equal(await answerBubble.getAttribute('aria-current'),'page');
  await bubbles.getByRole('button',{name:/^Current conversation Deck/}).click();
  await page.getByRole('heading',{name:'Current conversation',exact:true}).waitFor();
  const full=await geometry();
  assert.equal(full.x,0,'hidden sidebar reserves no rail');
  assert(await opener.evaluate(el=>el.compareDocumentPosition(el.parentElement.querySelector('h1'))&Node.DOCUMENT_POSITION_FOLLOWING));
  await page.evaluate(()=>{
   window.sidebarMotion=[];
   const nav=document.getElementById('projects-and-sessions');
   nav.addEventListener('transitionrun',event=>{
    if(event.target===nav&&!event.pseudoElement)window.sidebarMotion.push([nav.open,event.propertyName]);
   });
  });
  await opener.press('Enter');
  await panel.waitFor();
  await page.waitForFunction(()=>['opacity','transform'].every(name=>window.sidebarMotion.some(([opening,property])=>opening&&name===property)));
  assert.equal(await panel.getByRole('button',{name:'Close project navigation'}).evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Shift+Tab');
  assert(await page.evaluate(()=>!document.activeElement.closest('.app-header, .chat-pane')),'modal keyboard navigation stays out of chat');
  assert.deepEqual(await geometry(),full,'overlay keeps conversation geometry');
  const section=panel.getByRole('region',{name:'Needs attention'});
  const review=section.getByRole('button',{name:/Review deployment Deck Actions pending: 2/});
  const answer=section.getByRole('button',{name:/Confirm settings Naf EC Actions pending: 2/});
  await review.waitFor();
  await answer.waitFor();
  await page.screenshot({path:path.join(out,'overlay-attention.png')});
  assert.equal(await section.getByRole('button',{name:/Working only/}).count(),0);
  assert.equal(await section.getByRole('button',{name:/Confirm settings/}).count(),1,'one row per session with multiple causes');
  const foreignProject=panel.getByRole('button',{name:/^Naf EC/}).filter({has:page.locator('.project-name')});
  assert.equal(await foreignProject.getAttribute('aria-expanded'),'false');
  const foreignActions=panel.getByRole('button',{name:'More options for project Naf EC'});
  await foreignActions.scrollIntoViewIfNeeded();
  await foreignActions.press('ArrowDown');
  await panel.getByRole('menuitem',{name:'Project settings'}).waitFor();
  await page.keyboard.press('Escape');
  assert(await panel.isVisible(),'Escape dismisses the nested action menu first');
  await panel.getByRole('menuitem',{name:'Project settings'}).waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.activeElement.getAttribute('aria-label')==='More options for project Naf EC');
  await panel.getByRole('button',{name:'Close project navigation'}).focus();
  const tree=panel.locator('.navigation-scroll');
  const position=await tree.evaluate(el=>{el.scrollTop=160;return el.scrollTop;});
  await page.waitForFunction(expected=>document.querySelector('.navigation-scroll').scrollTop===expected,position);
  assert(position>0,'fixture has scrollable tree');
  await page.keyboard.press('Escape');
  await panel.waitFor({state:'hidden'});
  assert(await opener.evaluate(el=>el===document.activeElement),'Escape returns focus to opener');
  await page.waitForFunction(()=>['opacity','transform'].every(name=>window.sidebarMotion.some(([opening,property])=>!opening&&name===property)));
  await opener.click();
  await panel.waitFor();
  await page.waitForFunction(expected=>document.querySelector('.navigation-scroll').scrollTop===expected,position);
  assert.equal(await foreignProject.getAttribute('aria-expanded'),'false');
  await answer.click();
  await page.getByRole('heading',{name:'Confirm settings',exact:true}).waitFor();
  await panel.waitFor({state:'hidden'});
  await opener.click();
  await answer.waitFor();
  assert.equal(await answer.getAttribute('aria-current'),'page','visiting does not resolve attention');
  assert.equal(await foreignProject.getAttribute('aria-expanded'),'false','attention row does not expand a project');
  resolved=true;
  await review.waitFor({state:'hidden'});
  assert.equal(await answer.count(),1);
  await page.mouse.click(1000,300);
  await panel.waitFor({state:'hidden'});
  await opener.click();
  await panel.getByRole('button',{name:'Usage'}).click();
  await panel.getByRole('button',{name:'Settings',exact:true}).click();
  const settings=page.locator('.settings-modal[open]');
  await settings.getByRole('button',{name:'Close settings'}).click();
  await settings.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.activeElement.matches('.sidebar-opener'));
  await opener.click();
  await panel.getByRole('button',{name:'Pin sidebar'}).click();
  const dock=page.getByRole('navigation',{name:'Projects and sessions'});
  await dock.waitFor();
  assert((await geometry()).x>0,'pin reserves room in the layout');
  await page.reload({waitUntil:'domcontentloaded'});
  await dock.waitFor();
  await page.setViewportSize({width:390,height:844});
  await opener.click();
  await panel.waitFor();
  assert.equal(await panel.getByRole('button',{name:'Pin sidebar'}).count(),0);
  await page.screenshot({path:path.join(out,'mobile-overlay.png')});
  await page.keyboard.press('Escape');
  await panel.waitFor({state:'hidden'});
  await page.setViewportSize({width:1440,height:900});
  await dock.waitFor();
  await page.evaluate(()=>{
   localStorage.removeItem('deck2.sidebar-pinned');
   localStorage.setItem('deck.sidebar-collapsed','false');
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await dock.getByRole('button',{name:'Unpin sidebar'}).press('Enter');
  await opener.waitFor();
  assert(await opener.evaluate(el=>el===document.activeElement),'unpin returns focus to opener');
  await page.reload({waitUntil:'domcontentloaded'});
  await opener.waitFor();
  await page.emulateMedia({reducedMotion:'reduce'});
  await opener.click();
  const originalProject=panel.locator('.project-toggle').filter({has:page.getByText('Deck',{exact:true})});
  if(await originalProject.getAttribute('aria-expanded')==='false')await originalProject.click();
  await panel.getByRole('button',{name:'whisper',exact:true}).click();
  await panel.waitFor({state:'hidden'});
  await page.getByText('Preserved conversation whisper',{exact:true}).waitFor();
  assert(await opener.evaluate(el=>el===document.activeElement),'history navigation focuses the visible opener');
  await opener.click();
  await panel.waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await panel.count(),0);
  assert.equal(await page.locator('#projects-and-sessions').evaluate(el=>getComputedStyle(el).display),'none');
  assert.deepEqual(errors,[]);
  report.passed=true;
  checks.push('legacy collapsed preference, zero rail, desktop and mobile overlay, animated entry/exit and instant reduced motion, keyboard/outside dismissal, settings and focus restore, pin reload and history navigation');
  checks.push('incoming attention preserves focus; distinct other sessions; multi-project actions, collapsed project navigation, scroll restore and authoritative resolution');
  return;
 }
 await page.goto(link.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>{const add=document.querySelector('.sidebar .navigation-add');return add&&!add.disabled;},null,{timeout:15000});
 const nav=page.locator('.sidebar');await nav.getByRole('button',{name:'whisper',exact:true}).waitFor();
 // Trust is an explicit grant on Add and a scoped grant/revocation in settings.
 const trustName='Trust this project';
 const workspace=()=>page.evaluate(async()=>await(await fetch('/api/workspace')).json());
 const readTrust=async root=>{const w=await workspace();return w.project_trust[w.projects.find(p=>p.root===root)?.id];};
 async function clickRowMenu(trigger){
  await trigger.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," session-row ") or contains(concat(" ",normalize-space(@class)," ")," project-row ")][1]').hover();
  await trigger.click();
 }
 async function addWithTrust(root,optIn){
  await nav.getByRole('button',{name:'Add project',exact:true}).click();
  const add=page.getByRole('dialog',{name:'Add project',exact:true});
  const checkbox=add.getByRole('checkbox',{name:trustName,exact:true});
  await checkbox.waitFor();assert.equal(await checkbox.isChecked(),false);
  await add.getByRole('combobox',{name:'Project directory'}).fill(root);
  if(optIn)await checkbox.check();
  await add.getByRole('button',{name:'Add project',exact:true}).click();
  await add.waitFor({state:'hidden'});
 }
 async function trustSettings(name){
  await nav.getByRole('button',{name:'More options for project '+name,exact:true}).press('ArrowDown');
  await page.getByRole('menuitem',{name:'Project settings',exact:true}).click();
  return page.getByRole('dialog',{name:name+' / Project settings'});
 }
 if(!orderOnly){
 const trustRoot=path.join(root,'Trust fixture');fs.mkdirSync(trustRoot);
 const defaultRoot=path.join(root,'Default trust fixture');fs.mkdirSync(defaultRoot);
 const initialTrust=await readTrust(project);
 await addWithTrust(defaultRoot,false);assert.equal(await readTrust(defaultRoot),false);
 await addWithTrust(trustRoot,true);assert.equal(await readTrust(trustRoot),true);
 await addWithTrust(trustRoot,false);assert.equal(await readTrust(trustRoot),true);
 let trustDialog=await trustSettings('Trust fixture');
 let trustBox=trustDialog.getByRole('checkbox',{name:trustName,exact:true});
 await trustBox.waitFor();assert.equal(await trustBox.isChecked(),true);
 await trustBox.click();
 await trustDialog.getByRole('status').filter({hasText:/project not trusted/i}).waitFor();
 assert.equal(await trustBox.isChecked(),false);
 assert(await trustDialog.getByRole('button',{name:'Rebuild index'}).isDisabled());
 assert.equal(await readTrust(trustRoot),false);assert.equal(await readTrust(project),initialTrust);
 const trustFailure=route=>route.fulfill({status:409,json:{message:'Fixture trust rejection'}});
 await page.route('**/api/project/trust',trustFailure);
 await trustBox.click();await trustDialog.getByRole('alert').filter({hasText:'Fixture trust rejection'}).waitFor();
 assert.equal(await trustBox.isChecked(),false);
 await page.unroute('**/api/project/trust',trustFailure);
 const ensure=page.waitForResponse(res=>res.request().method()==='POST'&&res.url().includes('/api/cbm/automatic?projectId='));
 await trustBox.click();const indexResponse=await ensure;
 assert.equal(new URL(indexResponse.url()).searchParams.get('projectId'),'project-'+hash(trustRoot).slice(0,24));
 assert(indexResponse.ok(),`Code Map refresh failed: ${indexResponse.status()} ${await indexResponse.text()}`);
 await trustDialog.getByRole('button',{name:'Close project settings'}).click();
 assert.equal(await readTrust(trustRoot),true);assert.equal(await readTrust(project),initialTrust);
 await page.reload({waitUntil:'domcontentloaded'});
 trustDialog=await trustSettings('Trust fixture');
 trustBox=trustDialog.getByRole('checkbox',{name:trustName,exact:true});
 await trustBox.waitFor();assert.equal(await trustBox.isChecked(),true);
 await trustDialog.getByRole('button',{name:'Close project settings'}).click();
 checks.push('explicit Add trust, unchanged on re-add, and scoped settings revoke/grant, rejection, Code Map refresh and reload');
 }
 if(orderOnly)await nav.getByRole('button',{name:'Reorder project Deck',exact:true}).waitFor();
 if(process.argv.includes('--project-trust-only')){assert.deepEqual(errors,[]);report.passed=true;console.log(JSON.stringify({passed:true,checks}));return;}
 assert.equal(await nav.locator('.project-toolbar').getByRole('button',{name:/refresh/i}).count(),0);
 checks.push('real host authenticated; historical and local tree loaded; no Projects refresh');
 if(!orderOnly){
 await page.waitForTimeout(400);await page.screenshot({path:path.join(out,'initial.png')});
 const initialGeometry=await nav.evaluate(owner=>({projectX:owner.querySelector('.project-name strong').getBoundingClientRect().left-owner.getBoundingClientRect().left,sessionX:owner.querySelector('.session-label strong').getBoundingClientRect().left-owner.getBoundingClientRect().left}));report.initialGeometry=initialGeometry;assert(initialGeometry.sessionX>initialGeometry.projectX,JSON.stringify(initialGeometry));
 assert(await nav.getByRole('button',{name:'New session in Archived project',exact:true}).isDisabled());
 await nav.getByRole('button',{name:'More options for project Archived project',exact:true}).press('ArrowDown');await page.getByRole('menuitem',{name:'Rename project',exact:true}).click();let archived=page.getByRole('dialog',{name:'Rename project'});await archived.getByRole('textbox').fill('Archived renamed');await archived.getByRole('button',{name:'Save',exact:true}).click();await archived.waitFor({state:'hidden'});await nav.getByRole('button',{name:'More options for project Archived renamed',exact:true}).waitFor();checks.push('unavailable historical project remains identifiable and rename works without registering its missing directory');
 }
 let dialog;
 if(!orderOnly){
 // Add and rename a project through the actual dialogs/endpoints, then reload.
 await addWithTrust(second,false);
 const pm=nav.getByRole('button',{name:'More options for project Naf EC',exact:true});await pm.press('ArrowDown');await page.getByRole('menuitem',{name:'Rename project',exact:true}).click();dialog=page.getByRole('dialog',{name:'Rename project'});await dialog.getByRole('textbox').fill('Naf EC renamed');await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await page.reload({waitUntil:'domcontentloaded'});await nav.getByRole('button',{name:'More options for project Naf EC renamed',exact:true}).waitFor();checks.push('add project and project rename persist across reload');
 // Plus opens original model/approval dialog and creates a bound session.
 const newSession=nav.getByRole('button',{name:'New session in Naf EC renamed',exact:true});await newSession.focus();await newSession.click();dialog=page.getByRole('dialog',{name:'New session',exact:true});await dialog.getByRole('textbox',{name:'Session name'}).fill('Top banner');await dialog.getByRole('combobox',{name:'Runner',exact:true}).waitFor();await dialog.getByRole('button',{name:'Create session',exact:true}).click();await dialog.waitFor({state:'hidden'});
 let group=nav.locator('.project-group').filter({has:page.getByRole('button',{name:'New session in Naf EC renamed',exact:true})});const toggle=group.locator('.project-toggle');if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
 await nav.getByRole('button',{name:'Top banner',exact:true}).waitFor();checks.push('per-project plus creates a session using real model discovery and immutable project binding');
 // Session menu keyboard/Escape/focus, persisted rename.
 let sm=nav.getByRole('button',{name:'More options for session Top banner',exact:true});await sm.scrollIntoViewIfNeeded();await sm.press('ArrowUp');assert.equal(await page.getByRole('menuitem',{name:'Remove session',exact:true}).evaluate(n=>document.activeElement===n),true);await page.keyboard.press('Escape');assert.equal(await sm.evaluate(n=>document.activeElement===n),true);
 await clickRowMenu(sm);await page.getByRole('menuitem',{name:'Rename session',exact:true}).click();dialog=page.getByRole('dialog',{name:'Rename session',exact:true});await dialog.getByRole('textbox').fill('Product Impression');await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await page.reload({waitUntil:'domcontentloaded'});await nav.getByRole('button',{name:'Product Impression',exact:true}).waitFor();checks.push('session menu keyboard, Escape focus and persistent rename');
 }
 const otherProjectName=orderOnly?'Naf EC':'Naf EC renamed',otherSessionName=orderOnly?'Foreign history':'Product Impression';
 const handles=(kind,name)=>nav.getByRole('button',{name:'Reorder '+kind+' '+name,exact:true});
 const rowNames=(selector)=>nav.locator(selector).allTextContents();
 async function assertBefore(selector,first,last){
  await page.waitForFunction(({selector,first,last})=>{
   const names=Array.from(document.querySelectorAll('.sidebar '+selector),e=>e.textContent);
   return names.includes(first)&&names.indexOf(first)<names.indexOf(last);
  },{selector,first,last});
 }
 async function drag(handle,target,edge){
  await handle.scrollIntoViewIfNeeded();await target.scrollIntoViewIfNeeded();
  const a=await handle.boundingBox(),b=await target.boundingBox();
  const hitsGrip=await handle.evaluate((button,{x,y})=>button.contains(document.elementFromPoint(x,y)),{x:a.x+a.width/2,y:a.y+a.height/2});
  assert(hitsGrip,'Drag handle must own its pointer hit area');
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
  await page.mouse.move(b.x+b.width/2,b.y+b.height*edge,{steps:12});
  const marker=await nav.locator('[data-insertion]').count();
  await page.mouse.up();
  return marker;
 }
 const projectLabels='.project-name strong',sessionLabels='.session-label strong';
 const deck=nav.locator('.project-group').filter({has:page.getByRole('button',{name:'New session in Deck',exact:true})});
 const deckToggle=deck.locator('.project-toggle');if(await deckToggle.getAttribute('aria-expanded')!=='true')await deckToggle.click();
 const other=nav.locator('.project-group').filter({has:page.getByRole('button',{name:'New session in '+otherProjectName,exact:true})});
 const otherToggle=other.locator('.project-toggle');if(await otherToggle.getAttribute('aria-expanded')!=='true')await otherToggle.click();
 await nav.getByRole('button',{name:otherSessionName,exact:true}).waitFor();
 const terminal=nav.getByRole('button',{name:'Terminal',exact:true}),whisper=nav.getByRole('button',{name:'whisper',exact:true});
 await terminal.click();
 const terminalCurrent=await terminal.getAttribute('aria-current');assert.equal(terminalCurrent,'page');
 await handles('project',otherProjectName).waitFor();
 const projectGrip=handles('project','Deck').locator('.sidebar-reorder-grip');
 const sessionGrip=handles('session','Terminal').locator('.sidebar-reorder-grip');
 const opacity=grip=>grip.evaluate(el=>getComputedStyle(el).opacity);
 await page.mouse.move(1000,10);
 assert.deepEqual(await Promise.all([opacity(projectGrip),opacity(sessionGrip)]),['0','0']);
 await deckToggle.hover();
 assert.deepEqual(await Promise.all([opacity(projectGrip),opacity(sessionGrip)]),['1','0']);
 await terminal.hover();
 assert.deepEqual(await Promise.all([opacity(projectGrip),opacity(sessionGrip)]),['0','1']);
 checks.push('grips appear only on the hovered project or session row');

 const waitForSave=()=>{const pending=page.waitForResponse(r=>r.url().endsWith('/api/sidebar/order')&&r.request().method()==='POST');pending.catch(()=>{});return pending;};
 let saved=waitForSave();
 assert.equal(await drag(handles('project',otherProjectName),deckToggle,.2),1);
 assert((await saved).ok());await assertBefore(projectLabels,otherProjectName,'Deck');
 saved=waitForSave();
 const [firstSession,lastSession]=(await deck.locator('.session-label strong').allTextContents()).filter(name=>['Terminal','whisper'].includes(name));
 assert.equal(await drag(handles('session',lastSession),firstSession==='Terminal'?terminal:whisper,.2),1);
 assert((await saved).ok());await assertBefore(sessionLabels,lastSession,firstSession);
 assert.equal(await terminal.getAttribute('aria-current'),'page');
 const beforeCross=await rowNames(sessionLabels);
 assert.equal(await drag(handles('session','Terminal'),nav.getByRole('button',{name:otherSessionName,exact:true}),.2),0);
 assert.deepEqual(await rowNames(sessionLabels),beforeCross);
 await page.reload({waitUntil:'domcontentloaded'});
 await handles('session',lastSession).waitFor();
 await assertBefore(projectLabels,otherProjectName,'Deck');await assertBefore(sessionLabels,lastSession,firstSession);
 saved=waitForSave();
 await handles('session',firstSession).press('ArrowUp');
 assert((await saved).ok());await assertBefore(sessionLabels,firstSession,lastSession);
 await page.waitForFunction(label=>document.activeElement?.getAttribute('aria-label')===label,'Reorder session '+firstSession);
 const rejectedOrders=await page.evaluate(async({other,session})=>{
  const history=await(await fetch('/api/history/projects')).json();
  const deck=history.projects.find(p=>p.name==='Deck').projectId;
  const key=JSON.stringify(['history',history.source,deck,session]);
  async function post(owner,keys){
   const response=await fetch('/api/sidebar/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api:7,project:owner,keys})});
   return response.status;
  }
  const before=await(await fetch('/api/sidebar')).json();
  const codes=[await post(other,[key]),await post(deck,[JSON.stringify(['history','another-source',deck,session])]),await post(deck,[key,key])];
  const after=await(await fetch('/api/sidebar')).json();
  return {codes,unchanged:before.order_revision===after.order_revision};
 },{other:secondPid,session:'sidebar-original-0'});
 assert.deepEqual(rejectedOrders,{codes:[409,409,409],unchanged:true});
 checks.push('pointer project and history-session reorder persist on reload; selected row, cross-project rejection and keyboard focus verified');
 if(orderOnly){for(const [p,digest] of files)assert.equal(hash(fs.readFileSync(p)),digest);assert.deepEqual(errors,[]);report.passed=true;console.log(JSON.stringify({passed:true,checks}));return;}
 await nav.getByRole('button',{name:'Product Impression',exact:true}).click();
 // Hold a real native attempt so processing animation, active guards and cancellation are observed.
 await page.getByRole('textbox',{name:'Message your team'}).fill('Waiting-policy hold sidebar-work');await page.getByRole('button',{name:'Send question',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.sidebar .session.selected .agent-indicator')?.getAttribute('data-state')==='working',null,{timeout:20000});
 const orbit=nav.locator('.session.selected .work-orbit');const beforeOrbit=await orbit.getAttribute('transform');await page.waitForTimeout(120);assert.notEqual(await orbit.getAttribute('transform'),beforeOrbit);await page.screenshot({path:path.join(out,'processing.png')});
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(60);const reducedOrbit=await orbit.getAttribute('transform');await page.waitForTimeout(120);assert.equal(await orbit.getAttribute('transform'),reducedOrbit);await page.screenshot({path:path.join(out,'processing-reduce.png')});await page.emulateMedia({reducedMotion:'no-preference'});
 const working=await page.evaluate(async()=>await(await fetch('/api/workspace')).json());const own=working.sessions.find(s=>s.title==='Product Impression');assert.equal(own.project.root,second);
 const removed=await page.evaluate(async id=>{const r=await fetch('/api/sessions/'+id+'/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api:7})});return r.status;},own.id);assert.equal(removed,409);
 await nav.getByRole('button',{name:'Terminal',exact:true}).click();write(path.join(root,'release-sidebar-work'),'');await page.waitForFunction(async id=>{const w=await(await fetch('/api/workspace')).json();return w.receipts.some(r=>r.session===id&&r.phase==='completed');},own.id,{timeout:15000});checks.push('actual native processing drives working indicators; active session removal rejected');
 await page.waitForFunction(()=>[...document.querySelectorAll('.sidebar .session')].find(n=>n.getAttribute('aria-label')==='Product Impression')?.querySelector('.agent-indicator')?.getAttribute('data-state')==='completed');
 const unreadDot=nav.getByRole('button',{name:'Product Impression',exact:true}).locator('.unread-dot');await unreadDot.waitFor();await page.reload({waitUntil:'domcontentloaded'});await unreadDot.waitFor();await page.screenshot({path:path.join(out,'unread.png')});
 await nav.getByRole('button',{name:'Product Impression',exact:true}).click();await page.getByText('Connected reply',{exact:true}).waitFor();await unreadDot.waitFor({state:'hidden'});const replyState=await page.evaluate(async()=>await(await fetch('/api/replies')).json());assert(!replyState.replies.some(r=>r.sessionId===own.id));assert.equal(await nav.getByRole('button',{name:'Product Impression',exact:true}).locator('.agent-indicator').getAttribute('data-state'),'completed');checks.push('completed receipt renders completed with and without unread');checks.push('real reply remains unread across background navigation/reload; visible exact final content clears its device receipt');

 const foreign=await page.evaluate(async({project,session})=>{const r=await fetch(`/api/sidebar/projects/${project}/sessions/${session}/rename`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api:7,title:'Foreign'})});return r.status;},{project:own.project.id,session:'sidebar-original-0'});assert.equal(foreign,409);checks.push('historical session mutation rejects a foreign project scope');
 // Original session menu changes local navigation only.
 const deckGroup=nav.locator('.project-group').filter({has:page.getByRole('button',{name:'New session in Deck',exact:true})});if(await deckGroup.locator('.project-toggle').getAttribute('aria-expanded')!=='true')await deckGroup.locator('.project-toggle').click();
 const sm=nav.getByRole('button',{name:'More options for session whisper',exact:true});await clickRowMenu(sm);await page.getByRole('menuitem',{name:'Rename session',exact:true}).click();dialog=page.getByRole('dialog',{name:'Rename session',exact:true});await dialog.getByRole('textbox').fill('Rust');await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});
 // Delay actual history delivery for opening and rapid-switch ownership checks.
 let release;const gate=new Promise(r=>release=r);await page.route('**/api/history/sessions/sidebar-original-0?*',async route=>{await gate;await route.continue();});
 await nav.getByRole('button',{name:'Rust',exact:true}).click();await page.getByText('Opening conversation',{exact:true}).waitFor();await page.screenshot({path:path.join(out,'opening-normal.png')});
 await nav.getByRole('button',{name:'Terminal',exact:true}).click();release();await page.getByText('Preserved conversation Terminal',{exact:true}).waitFor();assert.equal(await page.getByText('Preserved conversation whisper',{exact:true}).count(),0);await page.unroute('**/api/history/sessions/sidebar-original-0?*');
 checks.push('opening animation represents pending history; rapid switch fences stale history response');
 await page.emulateMedia({reducedMotion:'reduce'});let releaseReduced;const reducedGate=new Promise(r=>releaseReduced=r);await page.route('**/api/history/sessions/sidebar-original-0?*',async route=>{await reducedGate;await route.continue();});await nav.getByRole('button',{name:'Rust',exact:true}).click();await page.getByText('Opening conversation',{exact:true}).waitFor();await page.screenshot({path:path.join(out,'opening-reduce.png')});releaseReduced();await page.getByText('Preserved conversation whisper',{exact:true}).waitFor();await page.unroute('**/api/history/sessions/sidebar-original-0?*');

 // Normal/reduced motion and selection geometry after rapid reversals.
 for(const motion of ['no-preference','reduce']){await page.emulateMedia({reducedMotion:motion});for(const name of ['Rust','Terminal','Rust','Terminal'])await nav.getByRole('button',{name,exact:true}).click();await page.getByText('Preserved conversation Terminal',{exact:true}).waitFor();await page.waitForTimeout(motion==='reduce'?30:450);const geometry=await nav.locator('.session.selected').evaluate(row=>{const owner=row.closest('.sidebar'),svg=owner.querySelector('.session-selection-plane'),box=svg.querySelector('path').getBBox(),a=row.getBoundingClientRect(),b=owner.getBoundingClientRect();const project=owner.querySelector('.project-name strong').getBoundingClientRect(),label=row.querySelector('.session-label strong').getBoundingClientRect();return {projectX:project.left-b.left,sessionX:label.left-b.left,left:box.x,width:owner.clientWidth,delta:Math.abs(box.y+box.height/2-(a.top+a.height/2-b.top)),right:Math.abs(box.x+box.width-owner.clientWidth)};});report.geometry??={};report.geometry[motion]=geometry;assert(geometry.delta<2&&geometry.right<2,JSON.stringify(geometry));assert(Math.abs(geometry.projectX-42)<2&&Math.abs(geometry.sessionX-59)<2&&Math.abs(geometry.left-6)<2,JSON.stringify(geometry));await page.screenshot({path:path.join(out,'selection-'+motion+'.png')});}
 checks.push('selection joins chat edge in normal/reduced motion after rapid reversals');
 // Local/historical IDs deliberately collide in different projects; scope all preference keys.
 const collision='sidebar-original-2';
 const api=async(url,body)=>page.evaluate(async({url,body})=>{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api:7,...body})});return {status:r.status,body:await r.json()};},{url,body});
 const collisionUrl=`/api/sidebar/projects/${pid}/sessions/${collision}`;
 assert.equal((await api('/api/sessions',{id:collision,title:'Local collision',project_id:own.project.id})).status,200);
 for(const action of ['rename','remove'])assert.equal((await api(collisionUrl+'/'+action,{title:'Must not rename local'})).status,409);
 let collisionWorkspace=await page.evaluate(async()=>await(await fetch('/api/workspace')).json());assert.equal(collisionWorkspace.sessions.find(s=>s.id===collision).title,'Local collision');
 await page.reload({waitUntil:'domcontentloaded'});await nav.getByRole('button',{name:'Collision history',exact:true}).waitFor();await nav.getByRole('button',{name:'Local collision',exact:true}).waitFor();
 assert.equal((await api('/api/sessions/'+collision+'/remove',{})).status,200);
 assert.equal((await api(collisionUrl+'/rename',{title:'History only'})).status,200);assert.equal((await api(collisionUrl+'/remove',{})).status,200);
 const preferences=await page.evaluate(async()=>await(await fetch('/api/sidebar')).json());const source=hash(original);assert.equal(preferences.sessions[JSON.stringify(['history',source,pid,collision])].title,'History only');assert.equal(preferences.sessions[collision],undefined);
 assert.equal((await api('/api/sessions',{id:collision,title:'Local survives historical hiding',project_id:own.project.id})).status,200);
 await page.reload({waitUntil:'domcontentloaded'});await nav.getByRole('button',{name:'Local survives historical hiding',exact:true}).waitFor();assert.equal(await nav.getByRole('button',{name:'History only',exact:true}).count(),0);
 assert.equal((await api('/api/sessions/'+collision+'/remove',{})).status,200);
 checks.push('same-ID historical/local rename and remove reject collisions; source/project-qualified preferences cannot hide or rename local rows');
 // Outside click closes menu; remove original hides only this local navigation entry.
 await clickRowMenu(nav.getByRole('button',{name:'More options for session Rust',exact:true}));await nav.getByRole('heading',{name:'Projects'}).click();assert.equal(await page.getByRole('menu').count(),0);
 await clickRowMenu(nav.getByRole('button',{name:'More options for session Rust',exact:true}));await page.getByRole('menuitem',{name:'Remove session',exact:true}).click();dialog=page.getByRole('dialog',{name:'Remove session',exact:true});await dialog.getByRole('button',{name:'Remove',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(await nav.getByRole('button',{name:'Rust',exact:true}).count(),0);
 for(const [p,digest] of files)assert.equal(hash(fs.readFileSync(p)),digest,'original payload changed');checks.push('historical rename/remove preserve original metadata and event bytes');
 // Remove settled local session, remove project, restore with Add project.
 await clickRowMenu(nav.getByRole('button',{name:'More options for session Product Impression',exact:true}));await page.getByRole('menuitem',{name:'Remove session',exact:true}).click();dialog=page.getByRole('dialog',{name:'Remove session',exact:true});await dialog.getByRole('button',{name:'Remove',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(await nav.getByRole('button',{name:'Product Impression',exact:true}).count(),0);
 await clickRowMenu(nav.getByRole('button',{name:'More options for project Naf EC renamed',exact:true}));await page.getByRole('menuitem',{name:'Remove project',exact:true}).click();dialog=page.getByRole('dialog',{name:'Remove project',exact:true});await dialog.getByRole('button',{name:'Remove',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.reload({waitUntil:'domcontentloaded'});assert.equal(await nav.getByRole('button',{name:'More options for project Naf EC renamed',exact:true}).count(),0);
 await nav.getByRole('button',{name:'Add project',exact:true}).click();dialog=page.getByRole('dialog',{name:'Add project',exact:true});await dialog.getByRole('combobox',{name:'Project directory'}).fill(second);await dialog.getByRole('button',{name:'Add project',exact:true}).click();await dialog.waitFor({state:'hidden'});await nav.getByRole('button',{name:'More options for project Naf EC renamed',exact:true}).waitFor();checks.push('settled local session removal; project removal persists and same-path add restores project');
 // Historical catalog registration runs again on a real process restart.
 assert.equal((await api(`/api/projects/${pid}/remove`,{})).status,200);
 assert.equal((await api(`/api/projects/${missingPid}/remove`,{})).status,200);
 await stopHost();({launcher,link}=await startHost());base='http://'+launcher.host;
 await page.context().addCookies([{name:'deck_device',value:deviceToken,url:base,httpOnly:true,sameSite:'Strict'}]);await page.goto(link.url,{waitUntil:'domcontentloaded'});
 await nav.getByRole('button',{name:'More options for project Naf EC renamed',exact:true}).waitFor();assert.equal(await nav.getByRole('button',{name:'More options for project Deck',exact:true}).count(),0);assert.equal(await nav.getByRole('button',{name:'More options for project Archived renamed',exact:true}).count(),0);
 assert.equal((await api('/api/projects',{root:project})).status,200);
 fs.mkdirSync(missing,{mode:0o700});assert.equal((await api('/api/projects',{root:missing})).status,200);
 await page.reload({waitUntil:'domcontentloaded'});await nav.getByRole('button',{name:'More options for project Deck',exact:true}).waitFor();await nav.getByRole('button',{name:'More options for project Archived renamed',exact:true}).waitFor();
 for(const [p,digest] of files)assert.equal(hash(fs.readFileSync(p)),digest,'original payload changed after restart');
 checks.push('hidden catalog projects stay removed across actual host restart; explicit Add restores existing and newly available historical projects');
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:/^Open projects and sessions/}).click();await page.getByRole('dialog',{name:'Projects and sessions',exact:true}).waitFor();assert.equal(await page.getByRole('dialog',{name:'Projects and sessions',exact:true}).getByRole('button',{name:'More options for project Naf EC renamed',exact:true}).count(),1,'mobile must immediately use the same committed navigation metadata');await page.screenshot({path:path.join(out,'mobile.png')});await page.keyboard.press('Escape');checks.push('mobile navigation opens and Escape closes');
 assert.deepEqual(errors,[]);report.passed=true;fs.writeFileSync(path.join(out,'host.log'),log.replace(/(https?:\/\/[^\s#]+)#\S+/g,'$1#[redacted]'));console.log(JSON.stringify({passed:true,checks},null,2));
}catch(e){if(page){await page.screenshot({path:path.join(out,'failure.png'),timeout:3000}).catch(()=>{});report.diagnostic=await page.evaluate(async()=>({navigation:document.querySelector('.sidebar')?.innerText,errors:[...document.querySelectorAll('[role=alert]')].map(n=>n.textContent),history:await(await fetch('/api/history/projects')).json(),sidebar:await(await fetch('/api/sidebar')).json()})).catch(String);}report.passed=false;report.error=String(e.stack);console.error(e.stack);process.exitCode=1;}finally{fs.writeFileSync(path.join(out,'host.log'),log.replace(/(https?:\/\/[^\s#]+)#\S+/g,'$1#[redacted]'));report.errors=errors;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));if(browser)await browser.close();if(host){host.kill('SIGTERM');await Promise.race([new Promise(r=>host.once('exit',r)),wait(3000)]);if(host.exitCode===null)host.kill('SIGKILL');}}})();
