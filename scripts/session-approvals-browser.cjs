// Original session journey through the packaged host/UI, with a deterministic
// native transport. No provider or user-owned runner state is used.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const repo=path.resolve(__dirname,'..'),binary=path.resolve(process.argv[2]||'dist/deck2'),out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/p17-evidence/browser');fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-session-parity-')),project=path.join(root,'project');fs.mkdirSync(project);fs.copyFileSync(path.join(repo,'crates/host/tests/fake_session_native.py'),path.join(root,'codex'));fs.chmodSync(path.join(root,'codex'),0o700);
const host=spawn(binary,['serve','--foreground','--project',project,'--state-dir',path.join(root,'state'),'--codex',path.join(root,'codex'),'--no-open'],{stdio:'ignore',env:{...process.env,CODEX_HOME:path.join(root,'native')}});
const wait=ms=>new Promise(r=>setTimeout(r,ms));let browser,page;
const result={binarySha256:crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),checks:[],passed:false};
(async()=>{try{
 for(let i=0;i<200&&!fs.existsSync(path.join(root,'state/launcher.json'));i++)await wait(100);
 const launcher=JSON.parse(fs.readFileSync(path.join(root,'state/launcher.json'))),base='http://'+launcher.host,link=await(await fetch(base+'/launch',{method:'POST',body:launcher.admin})).json();
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||'/snap/bin/chromium',headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1440,height:1000}}),testPage=await context.newPage(),errors=[];page=testPage;page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(link.url);await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));

 const workspace=async()=>await(await page.request.get(base+'/api/workspace')).json();
 const until=async fn=>{for(let i=0;i<300;i++){const w=await workspace();if(fn(w))return w;await wait(50);}throw Error('Workspace deadline');};
 const create=async(title,yolo=false)=>{
  await page.getByRole('button',{name:'+ New conversation',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'New session',exact:true});await dialog.getByLabel('Session name',{exact:true}).fill(title);
  const toggle=dialog.getByRole('checkbox',{name:'YOLO mode — agents run without asking for permission',exact:true}),submit=dialog.getByRole('button',{name:'Create session',exact:true});
  assert.equal(await toggle.isChecked(),false);await toggle.check();assert.equal(await submit.isEnabled(),false);
  await dialog.getByLabel('I understand the risks',{exact:true}).check();await toggle.uncheck();await toggle.check();assert.equal(await submit.isEnabled(),false);
  if(yolo)await dialog.getByLabel('I understand the risks',{exact:true}).check();else await toggle.uncheck();
  await submit.click();await dialog.waitFor({state:'hidden'});await page.waitForFunction(title=>document.querySelector('.app-header h1')?.textContent===title,title);
  return (await workspace()).sessions.find(s=>s.title===title);
 };
 const session=await create('Approval journey');assert.equal(session.contract.approvals,'relay');
 const control=page.locator('.session-approval-controls'),prompt=page.locator('#prompt');
 const send=async text=>{await prompt.fill(text);const response=page.waitForResponse(r=>r.url()===base+'/api/commands'&&r.request().method()==='POST');await page.getByRole('button',{name:'Send question',exact:true}).click();return(await(await response).json()).id;};
 const settle=id=>until(w=>w.receipts.find(r=>r.id===id)?.phase==='completed');
 const mode=async value=>until(w=>w.sessions.find(s=>s.id===session.id)?.contract.approvals===value);
 const first=await send('Native command pending approval fixture');await until(w=>w.receipts.find(r=>r.id===first)?.decisions.some(d=>d.state==='pending'));
 await prompt.fill('Draft survives live permission changes');
 await control.getByRole('button',{name:'Enable YOLO',exact:true}).click();let confirmation=page.getByRole('dialog',{name:'Enable YOLO',exact:true});
 assert.equal(await confirmation.getByRole('button',{name:'Enable YOLO',exact:true}).isEnabled(),false);
 await confirmation.getByLabel('I understand the risks',{exact:true}).check();await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
 await control.getByRole('button',{name:'Enable YOLO',exact:true}).click();confirmation=page.getByRole('dialog',{name:'Enable YOLO',exact:true});assert.equal(await confirmation.getByLabel('I understand the risks',{exact:true}).isChecked(),false);
 await confirmation.getByLabel('I understand the risks',{exact:true}).check();let reject=true;
 await page.route('**/api/sessions/*/approvals',async route=>{if(reject){reject=false;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'Mode save fixture failed'})});}else await route.continue();});
 await confirmation.getByRole('button',{name:'Enable YOLO',exact:true}).click();await confirmation.getByRole('alert').waitFor();assert.match(await confirmation.innerText(),/Mode save fixture failed/);
 assert.equal((await workspace()).sessions.find(s=>s.id===session.id).contract.approvals,'relay');assert.equal(await prompt.inputValue(),'Draft survives live permission changes');
 await confirmation.getByRole('button',{name:'Enable YOLO',exact:true}).click();await confirmation.waitFor({state:'hidden'});await mode('yolo');
 assert.equal(await control.getByText('Applies from your next message',{exact:true}).count(),1);assert.equal(await prompt.inputValue(),'Draft survives live permission changes');
 let w=await workspace(),r=w.receipts.find(r=>r.id===first);assert.equal(r.configuration.session_contract.approvals,'relay');assert.equal(r.decisions[0].state,'pending');assert.equal(fs.existsSync(path.join(root,'native-created.txt')),false);
 await page.locator('.review').filter({has:page.getByRole('button',{name:'Deny',exact:true})}).last().getByRole('button',{name:'Deny',exact:true}).click();await settle(first);
 const second=await send('Continue in explicit YOLO');await settle(second);await control.getByRole('button',{name:'Disable YOLO',exact:true}).click();await mode('relay');assert.equal(await page.getByRole('dialog').count(),0);
 const third=await send('Continue in relay again');await settle(third);w=await workspace();const receipts=[first,second,third].map(id=>w.receipts.find(r=>r.id===id));assert.equal(new Set(receipts.map(r=>r.thread)).size,1);assert.deepEqual(receipts.map(r=>r.configuration.session_contract.approvals),['relay','yolo','relay']);
 const protocol=()=>fs.readFileSync(path.join(root,'native-protocol'),'utf8').trim().split('\n').map(JSON.parse);
 assert.deepEqual(protocol().filter(p=>p.method==='turn/start').map(p=>[p.permissions,p.approvalPolicy]),[[':read-only','on-request'],[':danger-full-access','never'],[':read-only','on-request']]);
 result.checks.push('Original create/ack/reset/cancel/error/retry and in-flight pending approval retention; same native thread relay→YOLO→relay on thread/resume and turn/start');
 for(const body of [{api:7,mode:'auto'},{api:0,mode:'yolo'},{api:7,mode:'yolo',extra:true}])assert((await page.request.post(base+'/api/sessions/'+session.id+'/approvals',{data:body})).status()>=400);
 assert((await page.request.post(base+'/api/sessions/foreign-session/approvals',{data:{api:7,mode:'yolo'}})).status()>=400);
 assert.equal((await fetch(base+'/api/sessions/'+session.id+'/approvals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api:7,mode:'yolo'})})).status,403);
 await prompt.fill('Draft kept after reload');await page.reload();await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));assert.equal(await prompt.inputValue(),'Draft kept after reload');assert.equal((await workspace()).sessions.find(s=>s.id===session.id).contract.approvals,'relay');
 const yolo=await create('Created YOLO',true);assert.equal(yolo.contract.approvals,'yolo');
 const fourth=await send('Created YOLO native start');await settle(fourth);assert.equal(protocol().filter(p=>p.method==='thread/start').at(-1).permissions,':danger-full-access');
 await page.getByRole('button',{name:'Session assignments',exact:true}).click();for(const member of ['investigate','apply-deep']){await page.getByLabel('Runner for '+member,{exact:true}).selectOption('codex');await page.getByLabel('Model for '+member,{exact:true}).selectOption('gpt-6.1-sol');await page.getByRole('button',{name:'Save '+member+' assignment',exact:true}).click();await until(w=>w.sessions.find(s=>s.id===yolo.id).contract.members[member]);}await page.getByRole('button',{name:'Done',exact:true}).click();
 for(const member of ['investigate','apply-deep']){const id=await send('Delegate fixture '+member+' work');await settle(id);await until(w=>w.tasks.some(t=>t.owner===member&&t.attempts[0].phase==='completed')&&!w.receipts.some(r=>['accepted','queued','preparing','dispatching','running','cancelling'].includes(r.phase)));}
 const policies=fs.readFileSync(path.join(root,'policies'),'utf8').trim().split('\n').map(JSON.parse);assert(policies.some(p=>p.member&&p.policy==='never'&&p.permissions===':read-only'));assert(policies.some(p=>p.member&&p.policy==='never'&&p.permissions===':danger-full-access'));
 result.checks.push('Explicit creation/start; protected read-only reviewer and ordinary full-access member; authenticated invalid/foreign rejection; draft/mode persistence');
 const dispatchedBeforeBad=protocol().filter(p=>p.method==='turn/start').length;fs.writeFileSync(path.join(root,'wrong-permission-ack'),'fixture');const bad=await send('Refuse mismatched permission acknowledgement');await until(w=>w.receipts.find(r=>r.id===bad)?.phase==='failed');assert.match((await workspace()).receipts.find(r=>r.id===bad).detail,/did not acknowledge/);assert.equal((await workspace()).receipts.find(r=>r.id===bad).dispatch_ms,null);assert.equal(protocol().filter(p=>p.method==='turn/start').length,dispatchedBeforeBad);fs.unlinkSync(path.join(root,'wrong-permission-ack'));
 await page.screenshot({path:path.join(out,'desktop.png')});await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:844});await page.getByRole('tab',{name:'Conversation',exact:true}).click();await control.getByRole('button',{name:'Disable YOLO',exact:true}).click();await until(w=>w.sessions.find(s=>s.id===yolo.id).contract.approvals==='relay');await control.getByRole('button',{name:'Enable YOLO',exact:true}).click();await page.getByRole('dialog',{name:'Enable YOLO',exact:true}).getByLabel('I understand the risks',{exact:true}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'mobile.png')});await page.getByRole('dialog',{name:'Enable YOLO',exact:true}).press('Escape');assert.equal(await control.getByRole('button',{name:'Enable YOLO',exact:true}).evaluate(n=>n===document.activeElement),true);
 assert.deepEqual(errors,[]);fs.copyFileSync(path.join(root,'native-protocol'),path.join(out,'native-protocol.jsonl'));fs.copyFileSync(path.join(root,'policies'),path.join(out,'native-roles.jsonl'));result.passed=true;
}finally{if(page&&!result.passed){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.txt'),await page.locator('body').innerText().catch(()=>'Unavailable'));}if(browser)await browser.close();host.kill('SIGTERM');await Promise.race([new Promise(r=>host.once('exit',r)),wait(3000)]);if(host.exitCode===null)host.kill('SIGKILL');fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');if(result.passed)fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
