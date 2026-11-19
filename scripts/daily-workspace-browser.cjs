// Connected default composition: packaged UI/HTTP/store/native adapter. Only native transport is synthetic.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),crypto=require('crypto'),{spawn}=require('child_process');
const repo=path.resolve(__dirname,'..'),binary=path.resolve(process.argv[2]||'dist/deck2'),out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/daily52/browser');fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-daily-')),project=path.join(root,'project');fs.mkdirSync(project);
let native=fs.readFileSync(path.join(repo,'crates/host/tests/fake_session_native.py'),'utf8');
native=native.replace("root=pathlib.Path(__file__).parent","root=pathlib.Path(__file__).parent\nsys.stderr=open(root/'errors','a')");
native=native.replace(" elif m=='account/read':",` elif m=='account/rateLimits/read':
  with (root/'quota-reads').open('a') as f:f.write('read\\n')
  result(v,{'rateLimits':{'planType':'pro','accountId':'private-account','primary':{'windowDurationMins':300,'usedPercent':42.2,'resetsAt':1900000000},'secondary':{'windowDurationMins':10080,'usedPercent':19,'resetsAt':1901000000}}})
 elif m=='account/read':`);
native=native.replace("  if 'Fresh graph' in text:",`  if 'Daily delivery' in text and not member:
   tasks=[tool('deck_delegate',{'agent':'investigate','task':'Daily member alpha'}),tool('deck_delegate',{'agent':'quality','task':'Daily member beta'})]
   (root/'daily-tasks').write_text(json.dumps(tasks))
  if 'Daily retry' in text and not member:
   tasks=json.loads((root/'daily-tasks').read_text())
   tool('deck_delegate',{'agent':'quality','continueTaskId':tasks[1]['taskId'],'task':'Daily member gamma'})
  member_text=text.split('\\nStructured Lead claims')[0]
  tokens=34794 if not member else 70000 if 'alpha' in member_text else 100000 if 'beta' in member_text else 15000
  out({'method':'thread/tokenUsage/updated','params':{'threadId':thread,'turnId':'foreign-turn','tokenUsage':{'last':{'totalTokens':999999},'modelContextWindow':258400}}})
  out({'method':'thread/tokenUsage/updated','params':{'threadId':thread,'turnId':'normal-turn','tokenUsage':{'last':{'totalTokens':tokens},'total':{'totalTokens':9000000},'modelContextWindow':258400}}})
  if member and 'Daily member' in text:
   name='alpha' if 'alpha' in member_text else 'beta' if 'beta' in member_text else 'gamma'
   out({'method':'item/agentMessage/delta','params':{'threadId':thread,'turnId':'normal-turn','delta':'Live '+name+' conversation\\n'}})
   while (root/('hold-'+name)).exists():time.sleep(.02)
   out({'method':'turn/completed','params':{'threadId':thread,'turn':{'id':'normal-turn','status':'failed' if name=='beta' else 'completed'}}})
   continue
  if 'Fresh graph' in text:`);
native=native.replace("if not (root/'coordination-task').exists() and any(","if not (root/'daily-tasks').exists() and not (root/'coordination-task').exists() and any(");
fs.writeFileSync(path.join(root,'codex'),native,{mode:0o700});fs.writeFileSync(path.join(root,'hold-alpha'),'');
const host=spawn(binary,['serve','--foreground','--project',project,'--state-dir',path.join(root,'state'),'--codex',path.join(root,'codex'),'--no-open'],{stdio:'ignore',env:{...process.env,CODEX_HOME:path.join(root,'native')}});
const wait=ms=>new Promise(r=>setTimeout(r,ms));let browser,page;
const result={binarySha256:crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),checks:[],passed:false,root};const start=performance.now();
(async()=>{try{
 for(let i=0;i<200&&!fs.existsSync(path.join(root,'state/launcher.json'));i++)await wait(100);
 const launcher=JSON.parse(fs.readFileSync(path.join(root,'state/launcher.json'))),base='http://'+launcher.host,link=await(await fetch(base+'/launch',{method:'POST',body:launcher.admin})).json();
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||'/home/kevin15011/.cache/ms-playwright/chromium-1237/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(link.url);await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 const ws=async()=>await(await page.request.get(base+'/api/workspace')).json();const until=async fn=>{for(let i=0;i<250;i++){const w=await ws();if(fn(w))return w;await wait(100);}throw Error('Workspace deadline');};
 const create=async title=>{await page.getByRole('button',{name:'+ New conversation',exact:true}).click();await page.getByLabel('Session name',{exact:true}).fill(title);await page.getByRole('button',{name:'Create session',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.waitForFunction(title=>document.querySelector('.app-header h1')?.textContent===title,title);return (await ws()).sessions.find(s=>s.title===title).id;};
 const first=await create('Daily workspace'),prompt=page.locator('#prompt');
 await page.getByRole('button',{name:'Session assignments',exact:true}).click();
 for(const role of ['investigate','quality']){await page.getByRole('combobox',{name:`Runner for ${role}`,exact:true}).selectOption('codex');await page.getByRole('button',{name:`Save ${role} assignment`,exact:true}).click();}
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 const readCount=()=>fs.existsSync(path.join(root,'quota-reads'))?fs.readFileSync(path.join(root,'quota-reads'),'utf8').trim().split('\n').length:0;
 for(let i=0;i<3;i++)assert.equal((await page.request.get(base+'/api/quota')).status(),200);
 assert.equal(readCount(),0);await page.getByRole('button',{name:'Refresh Codex quota',exact:true}).click();await page.getByText('Plan: pro',{exact:false}).waitFor();assert.equal(readCount(),1);
 assert.equal(await page.getByRole('button',{name:'Refresh Claude quota'}).isDisabled(),true);
 const cooldown=await page.request.post(base+'/api/quota/codex/refresh',{headers:{Origin:base},data:{}});assert.equal(cooldown.status(),409);assert.equal(readCount(),1);
 const quota=await(await page.request.get(base+'/api/quota')).json();assert.equal(quota.runners.codex.snapshot.windows[0].usedPercent,42.2);assert.equal(JSON.stringify(quota).includes('private-account'),false);
 result.checks.push('Passive host-only quota reads dispatch no native query; explicit account refresh is allowlisted, cooldown applies and unported Claude is disabled');
 await prompt.fill('Daily delivery');await page.keyboard.press('Enter');await until(w=>w.tasks.length===2&&w.tasks.some(t=>t.attempts.at(-1).context?.observation?.tokens===70000));
 await page.waitForFunction(()=>document.querySelector('#tab-subagents')?.getAttribute('aria-selected')==='true');await page.waitForFunction(()=>document.querySelector('#subagents-status')?.textContent==='1 active subagents');await prompt.fill('Retained draft while reading agents');await page.getByRole('tab',{name:'Subagents',exact:true}).click();
 await page.locator('.task-card').filter({hasText:'Investigate'}).getByRole('button',{name:'Open full view'}).click();await page.getByRole('log',{name:'Investigate conversation'}).getByText('Live alpha conversation').waitFor();
 await page.getByRole('button',{name:/Investigate context details/}).click();await page.getByRole('dialog',{name:'Investigate context'}).getByText('70,000',{exact:false}).waitFor();await page.keyboard.press('Escape');
 assert.equal(await page.getByRole('dialog',{name:'Investigate context'}).count(),0);assert.equal(await prompt.inputValue(),'Retained draft while reading agents');
 fs.unlinkSync(path.join(root,'hold-alpha'));await until(w=>w.tasks.every(t=>['completed','failed'].includes(t.attempts.at(-1).phase)));
 const beforeRead=(await ws()).tasks.find(t=>t.owner==='quality'),readKey='deck2.reply.'+JSON.stringify([first,beforeRead.id,beforeRead.attempts[0].id,beforeRead.attempts[0].report.digest]);
 assert.equal(await page.evaluate(key=>localStorage.getItem(key),readKey),null,'Hidden member result must remain unread');

 await page.getByRole('button',{name:/Quality \(failed\)/}).click();await page.locator('.detail-conversation').getByText('Live beta conversation').waitFor();await page.waitForFunction(key=>localStorage.getItem(key)==='true',readKey);assert.ok((await ws()).tasks.every(t=>t.attempts.every(a=>a.treatments.length===0)),'UI reading must not integrate reports');
 await page.getByRole('button',{name:'← Subagents'}).click();await page.waitForFunction(()=>document.querySelectorAll('.task-card--compact').length===2);
 await until(w=>w.receipts.filter(r=>r.session===first).length>=3&&w.receipts.filter(r=>r.session===first).every(r=>r.phase==='completed'));await page.waitForFunction(()=>document.querySelectorAll('.exchange').length>=3&&[...document.querySelectorAll('.exchange .phase')].every(e=>e.textContent==='Completed'));
 await page.getByRole('button',{name:/Lead context details/}).click();await page.getByRole('dialog',{name:'Lead context'}).getByText('34,794',{exact:false}).waitFor();await page.keyboard.press('Escape');
 await page.screenshot({path:path.join(out,'desktop-cards.png')});
 const terminal=await ws(),alpha=terminal.tasks.find(t=>t.owner==='investigate'),beta=terminal.tasks.find(t=>t.owner==='quality');
 assert.equal(alpha.attempts[0].context.observation.tokens,70000);assert.equal(beta.attempts[0].context.observation.tokens,100000);
 assert.equal(terminal.receipts.find(r=>r.prompt==='Daily delivery').context.observation.tokens,34794);
 assert.equal(alpha.attempts[0].text,'');
 const transcript=await(await page.request.get(base+`/api/sessions/${first}/tasks/${alpha.id}/attempts/${alpha.attempts[0].id}/transcript`)).json();assert.match(transcript.text,/Live alpha/);assert.equal((await page.request.get(base+`/api/sessions/${first}/tasks/${alpha.id}/attempts/${alpha.attempts[0].id}/transcript?offset=999999`)).status(),400);
 const other=await create('Different session');const foreign=await page.request.get(base+`/api/sessions/${other}/tasks/${alpha.id}/attempts/${alpha.attempts[0].id}/transcript`);assert.equal(foreign.status(),404);
 await page.getByRole('tab',{name:'Subagents',exact:true}).click();await page.getByText('No subagents yet.',{exact:false}).waitFor();await page.getByRole('button',{name:/Lead context details: Context unavailable/}).waitFor();
 await page.locator('.sidebar .session').filter({hasText:'Daily workspace'}).click();await page.getByRole('tab',{name:'Subagents',exact:true}).click();assert.equal(await prompt.inputValue(),'Retained draft while reading agents');
 await prompt.fill('Daily retry');await page.keyboard.press('Enter');await until(w=>w.tasks.find(t=>t.id===beta.id)?.attempts.length===2&&w.tasks.find(t=>t.id===beta.id).attempts[1].phase==='completed');await prompt.fill('Draft retained after retry');
 await page.locator('.task-card').filter({hasText:'Quality'}).getByRole('button',{name:'Open full view'}).click();await page.getByRole('combobox',{name:'Task attempt'}).selectOption(beta.attempts[0].id);await page.locator('.detail-conversation').getByText('Live beta conversation').waitFor();
 const latest=(await ws()).tasks.find(t=>t.id===beta.id);assert.equal(latest.attempts[0].context.observation,null);assert.equal(latest.attempts[1].context.observation.tokens,15000);
 await page.getByRole('combobox',{name:'Task attempt'}).selectOption(latest.attempts[1].id);await page.locator('.detail-conversation').getByText('Live gamma conversation').waitFor();await page.screenshot({path:path.join(out,'desktop-detail.png')});
 // Delayed old transcript response is aborted/discarded when the selected attempt changes.
 let release,seen;const gate=new Promise(r=>release=r),observed=new Promise(r=>seen=r);
 await page.route('**/transcript?offset=0',async route=>{if(route.request().url().includes(beta.attempts[0].id)){seen();await gate;await route.fulfill({json:{session:first,task:beta.id,attempt:beta.attempts[0].id,prompt:'STALE OLD',text:'STALE OLD',offset:0,nextOffset:9,more:false,settled:true}}).catch(()=>{});}else await route.continue();});
 await page.getByRole('combobox',{name:'Task attempt'}).selectOption(beta.attempts[0].id);await observed;await page.getByRole('combobox',{name:'Task attempt'}).selectOption(latest.attempts[1].id);release();await page.locator('.detail-conversation').getByText('Live gamma conversation').waitFor();assert.equal(await page.getByText('STALE OLD',{exact:false}).count(),0);await page.unroute('**/transcript?offset=0');
 result.checks.push('Lead/two members retain distinct current-request observations, live/failed/completed/retried transcripts, exact historical selection and rejection of foreign session/stale responses');
 await page.reload();await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));assert.equal(await prompt.inputValue(),'Draft retained after retry');await page.getByRole('tab',{name:'Subagents',exact:true}).click();await page.locator('.task-card--compact').first().waitFor();
 await page.waitForTimeout(15_200);assert.equal(readCount(),1);const dispatches=fs.readFileSync(path.join(root,'dispatch-count'),'utf8');
 for(let i=0;i<8;i++){await page.getByRole('tab',{name:i%2?'Subagents':'Activity',exact:true}).click();}
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('tab',{name:'Subagents',exact:true}).click();await page.locator('.task-card').filter({hasText:'Quality'}).getByRole('button',{name:'Open full view'}).click();await page.keyboard.press('Tab');await page.screenshot({path:path.join(out,'desktop-reduced.png')});
 await page.setViewportSize({width:390,height:844});await page.getByRole('tab',{name:'Subagents',exact:true}).click();await page.screenshot({path:path.join(out,'mobile-detail.png')});await page.getByRole('button',{name:'Toggle project navigation',exact:true}).click();await page.getByRole('dialog',{name:'Projects',exact:true}).getByText('Plan: pro',{exact:false}).waitFor();await page.screenshot({path:path.join(out,'mobile-usage.png')});await page.keyboard.press('Escape');
 await page.getByRole('tab',{name:'Conversation',exact:true}).click();assert.equal(await prompt.inputValue(),'Draft retained after retry');
 assert.equal(fs.readFileSync(path.join(root,'dispatch-count'),'utf8'),dispatches);assert.equal(readCount(),1);assert.deepEqual(errors,[]);
 result.checks.push('Reload, card/detail switching, rapid GSAP reversals, keyboard dismissal, reduced motion and mobile Usage retain draft/selection and cause no model dispatch');
 await until(w=>w.receipts.every(r=>!['accepted','preparing','dispatching','running','cancelling'].includes(r.phase)));
 for(const member of ['quality','lead']){
  const session=(await ws()).sessions.find(s=>s.id===first),original=session.contract.members[member];
  const change=await page.request.post(base+`/api/sessions/${first}/assignments`,{headers:{Origin:base},data:{api:7,memberId:member,assignment:{...original,thinking:'high'},expectedRevision:session.contract.revision}});assert.equal(change.status(),200,await change.text());const changed=await change.json();
  const revert=await page.request.post(base+`/api/sessions/${first}/assignments`,{headers:{Origin:base},data:{api:7,memberId:member,assignment:original,expectedRevision:changed.contract.revision}});assert.equal(revert.status(),200,await revert.text());
 }
 const reset=await ws();assert.ok(reset.tasks.find(t=>t.id===beta.id).attempts.every(a=>!a.context.observation));assert.equal(reset.tasks.find(t=>t.id===alpha.id).attempts[0].context.observation.tokens,70000);assert.ok(reset.receipts.filter(r=>r.session===first).every(r=>!r.context.observation));
 assert.equal(await prompt.inputValue(),'Draft retained after retry');assert.equal(fs.readFileSync(path.join(root,'dispatch-count'),'utf8'),dispatches);
 result.checks.push('Changing and restoring assignments cannot resurrect prior Lead/member context; unrelated member observation, reports and draft survive');result.passed=true;
}finally{fs.rmSync(path.join(root,'hold-alpha'),{force:true});result.duration_ms=performance.now()-start;if(page&&!result.passed){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.txt'),await page.locator('body').innerText().catch(()=>''));}await browser?.close();host.kill('SIGTERM');await Promise.race([new Promise(r=>host.once('exit',r)),wait(3000)]);if(host.exitCode===null)host.kill('SIGKILL');result.hostExitCode=host.exitCode;result.hostSignal=host.signalCode;fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}})().catch(e=>{console.error(e);process.exitCode=1;});
