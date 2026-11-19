// Real embedded host, disposable projects/history and the existing native transport fake.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),crypto=require('crypto'),{spawn,execFileSync}=require('child_process');
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
const orderOnly=process.argv.includes('--sidebar-order-only');
const binary=path.resolve(process.argv[2]),out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'../browser-evidence');fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck-sidebar-')),project=path.join(root,'Deck'),second=path.join(root,'Naf EC'),state=path.join(root,'state'),original=path.join(root,'original');
const wait=ms=>new Promise(r=>setTimeout(r,ms)),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,typeof v==='string'?v:JSON.stringify(v),{mode:0o600});}
for(const p of [project,second,original])fs.mkdirSync(p,{recursive:true,mode:0o700});
execFileSync('git',['init','--quiet',second]);
const pid='project-'+hash(project).slice(0,24),secondPid='project-'+hash(second).slice(0,24),files=[],missing=path.join(root,'missing-project'),missingPid='project-'+hash(missing).slice(0,24);
write(path.join(original,'projects.json'),{v:1,projects:[{projectId:pid,path:project,name:'Deck',createdAt:'2026-01-01T00:00:00Z'},{projectId:missingPid,path:missing,name:'Archived project',createdAt:'2026-01-01T00:00:00Z'},...(orderOnly?[{projectId:secondPid,path:second,name:'Naf EC',createdAt:'2026-01-01T00:00:00Z'}]:[])]});
for(const [i,title] of ['whisper','Terminal','Collision history',...(orderOnly?['Foreign history']:[])].entries()){
 const owner=title==='Foreign history'?{projectRoot:second,projectId:secondPid}:{projectRoot:project,projectId:pid};
 const sid='sidebar-original-'+i,base=path.join(original,'sessions',sid);
 for(const [name,data] of [['session.json',{v:1,sessionId:sid,...owner,title,createdAt:'2026-01-01T00:00:00Z',members:{lead:{runnerId:'opencode',modelId:'saved-model'}},approvals:'relay'}],['events/000001.jsonl',JSON.stringify({v:1,sessionId:sid,seq:1,ts:'2026-01-01T00:00:00Z',kind:'message.completed',source:{taskId:'lead',memberId:'lead',runnerId:'opencode'},data:{role:'assistant',text:'Preserved conversation '+title}})+'\n']]){const p=path.join(base,name);write(p,data);files.push([p,hash(fs.readFileSync(p))]);}
}
const deviceToken=crypto.randomBytes(32).toString('base64url');write(path.join(original,'web/devices.json'),[{id:'sidebar-browser',name:'Sidebar browser',createdAt:'2026-01-01T00:00:00Z',hash:hash(deviceToken)}]);
const fake=path.join(root,'fake-codex');let transport=fs.readFileSync(path.resolve('crates/host/tests/fake_session_native.py'),'utf8');transport=transport.replace("  out({'method':'item/agentMessage/delta','params':{'threadId':thread,'turnId':'normal-turn','delta':'Connected reply'}})",`  out({'method':'item/started','params':{'threadId':thread,'turnId':'normal-turn','item':{'type':'agentMessage','id':'final'}}})
  out({'method':'item/agentMessage/delta','params':{'threadId':thread,'turnId':'normal-turn','delta':'Connected reply'}})
  out({'method':'item/completed','params':{'threadId':thread,'turnId':'normal-turn','item':{'type':'agentMessage','id':'final','phase':'final_answer','text':'Connected reply'}}})`);fs.writeFileSync(fake,transport,{mode:0o700});
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
 await page.goto(link.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>{const add=document.querySelector('.sidebar .navigation-add');return add&&!add.disabled;},null,{timeout:15000});
 const nav=page.locator('.sidebar');await nav.getByRole('button',{name:'whisper',exact:true}).waitFor();
 // Trust is an explicit grant on Add and a scoped grant/revocation in settings.
 const trustName='Trust this project';
 const workspace=()=>page.evaluate(async()=>await(await fetch('/api/workspace')).json());
 const readTrust=async root=>{const w=await workspace();return w.project_trust[w.projects.find(p=>p.root===root)?.id];};
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
 let sm=nav.getByRole('button',{name:'More options for session Top banner',exact:true});await sm.focus();await page.keyboard.press('ArrowUp');assert.equal(await page.getByRole('menuitem',{name:'Remove session',exact:true}).evaluate(n=>document.activeElement===n),true);await page.keyboard.press('Escape');assert.equal(await sm.evaluate(n=>document.activeElement===n),true);
 await sm.click();await page.getByRole('menuitem',{name:'Rename session',exact:true}).click();dialog=page.getByRole('dialog',{name:'Rename session',exact:true});await dialog.getByRole('textbox').fill('Product Impression');await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});
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
 const sm=nav.getByRole('button',{name:'More options for session whisper',exact:true});await sm.click();await page.getByRole('menuitem',{name:'Rename session',exact:true}).click();dialog=page.getByRole('dialog',{name:'Rename session',exact:true});await dialog.getByRole('textbox').fill('Rust');await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});
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
 await nav.getByRole('button',{name:'More options for session Rust',exact:true}).click();await nav.getByRole('heading',{name:'Projects'}).click();assert.equal(await page.getByRole('menu').count(),0);
 await nav.getByRole('button',{name:'More options for session Rust',exact:true}).click();await page.getByRole('menuitem',{name:'Remove session',exact:true}).click();dialog=page.getByRole('dialog',{name:'Remove session',exact:true});await dialog.getByRole('button',{name:'Remove',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(await nav.getByRole('button',{name:'Rust',exact:true}).count(),0);
 for(const [p,digest] of files)assert.equal(hash(fs.readFileSync(p)),digest,'original payload changed');checks.push('historical rename/remove preserve original metadata and event bytes');
 // Remove settled local session, remove project, restore with Add project.
 await nav.getByRole('button',{name:'More options for session Product Impression',exact:true}).click();await page.getByRole('menuitem',{name:'Remove session',exact:true}).click();dialog=page.getByRole('dialog',{name:'Remove session',exact:true});await dialog.getByRole('button',{name:'Remove',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(await nav.getByRole('button',{name:'Product Impression',exact:true}).count(),0);
 await nav.getByRole('button',{name:'More options for project Naf EC renamed',exact:true}).click();await page.getByRole('menuitem',{name:'Remove project',exact:true}).click();dialog=page.getByRole('dialog',{name:'Remove project',exact:true});await dialog.getByRole('button',{name:'Remove',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.reload({waitUntil:'domcontentloaded'});assert.equal(await nav.getByRole('button',{name:'More options for project Naf EC renamed',exact:true}).count(),0);
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
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Toggle project navigation',exact:true}).filter({visible:true}).click();await page.getByRole('dialog',{name:'Projects',exact:true}).waitFor();assert.equal(await page.getByRole('dialog',{name:'Projects',exact:true}).getByRole('button',{name:'More options for project Naf EC renamed',exact:true}).count(),1,'mobile must immediately use the same committed navigation metadata');await page.screenshot({path:path.join(out,'mobile.png')});await page.keyboard.press('Escape');checks.push('mobile navigation opens and Escape closes');
 assert.deepEqual(errors,[]);report.passed=true;fs.writeFileSync(path.join(out,'host.log'),log.replace(/(https?:\/\/[^\s#]+)#\S+/g,'$1#[redacted]'));console.log(JSON.stringify({passed:true,checks},null,2));
}catch(e){if(page){await page.screenshot({path:path.join(out,'failure.png'),timeout:3000}).catch(()=>{});report.diagnostic=await page.evaluate(async()=>({navigation:document.querySelector('.sidebar')?.innerText,errors:[...document.querySelectorAll('[role=alert]')].map(n=>n.textContent),history:await(await fetch('/api/history/projects')).json(),sidebar:await(await fetch('/api/sidebar')).json()})).catch(String);}report.passed=false;report.error=String(e.stack);console.error(e.stack);process.exitCode=1;}finally{fs.writeFileSync(path.join(out,'host.log'),log.replace(/(https?:\/\/[^\s#]+)#\S+/g,'$1#[redacted]'));report.errors=errors;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));if(browser)await browser.close();if(host){host.kill('SIGTERM');await Promise.race([new Promise(r=>host.once('exit',r)),wait(3000)]);if(host.exitCode===null)host.kill('SIGKILL');}}})();
