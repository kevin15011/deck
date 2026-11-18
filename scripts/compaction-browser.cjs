// P10/P16: real keys and default packaged composition; only native/network edges are synthetic.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),crypto=require('crypto'),{spawn,execFileSync}=require('child_process');
const repo=path.resolve(__dirname,'..'),binary=path.resolve(process.argv[2]||'dist/deck2'),out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/repair53/browser');fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-compaction-')),project=path.join(root,'project');fs.mkdirSync(project);
const git=(...args)=>execFileSync('/usr/bin/git',args,{cwd:project,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
git('init','-q','-b','keyboard-unborn');
let native=fs.readFileSync(path.join(repo,'crates/host/tests/fake_session_native.py'),'utf8').replace("  def tool(name,args):",`  if 'Fresh context' in text:
   out({'method':'thread/tokenUsage/updated','params':{'threadId':thread,'turnId':'normal-turn','tokenUsage':{'last':{'totalTokens':12345},'modelContextWindow':258400}}})
   out({'method':'turn/completed','params':{'threadId':thread,'turn':{'id':'normal-turn','status':'completed'}}})
   continue
  if 'Compaction ' in text:
   def event(method,item='compact',turn='normal-turn'):
    out({'method':method,'params':{'threadId':thread,'turnId':turn,'item':{'id':item,'type':'contextCompaction'}}})
   out({'method':'thread/tokenUsage/updated','params':{'threadId':thread,'turnId':'normal-turn','tokenUsage':{'last':{'totalTokens':34794},'modelContextWindow':258400}}})
   event('item/started')
   (root/'entered').touch()
   while not (root/'stage1').exists():time.sleep(.01)
   event('item/completed','foreign')
   event('item/completed','compact','foreign-turn')
   (root/'foreign').touch()
   while not (root/'stage2').exists():time.sleep(.01)
   if 'completed' in text:
    event('item/completed')
   elif 'response' in text:
    out({'method':'item/agentMessage/delta','params':{'threadId':thread,'turnId':'normal-turn','delta':'Later authoritative response'}})
    event('item/completed','foreign')
   (root/'settling').touch()
   while not (root/'terminal').exists():time.sleep(.01)
   out({'method':'turn/completed','params':{'threadId':thread,'turn':{'id':'normal-turn','status':'failed' if 'failed' in text else 'interrupted' if 'interrupted' in text else 'completed'}}})
   continue
  def tool(name,args):`);
fs.writeFileSync(path.join(root,'codex'),native,{mode:0o700});
const host=spawn(binary,['serve','--project',project,'--state-dir',path.join(root,'state'),'--codex',path.join(root,'codex'),'--no-open'],{stdio:'ignore',env:{...process.env,CODEX_HOME:path.join(root,'native')}});
const wait=ms=>new Promise(r=>setTimeout(r,ms));let browser,page;
const result={binarySha256:crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),checks:[],passed:false,root};const start=performance.now();
(async()=>{try{
 for(let i=0;i<200&&!fs.existsSync(path.join(root,'state/launcher.json'));i++)await wait(100);
 const launcher=JSON.parse(fs.readFileSync(path.join(root,'state/launcher.json'))),base='http://'+launcher.host,link=await(await fetch(base+'/launch',{method:'POST',body:launcher.admin})).json();
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||'/snap/bin/chromium',headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(link.url);await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 const ws=async()=>await(await page.request.get(base+'/api/workspace')).json();const until=async fn=>{for(let i=0;i<200;i++){const w=await ws();if(fn(w))return w;await wait(100);}throw Error('Workspace deadline');};
 const create=async title=>{await page.getByRole('button',{name:'+ New conversation',exact:true}).click();await page.getByLabel('Session name',{exact:true}).fill(title);await page.getByRole('button',{name:'Create session',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.waitForFunction(title=>document.querySelector('.app-header h1')?.textContent===title,title);return (await ws()).sessions.find(s=>s.title===title).id;};
 const prompt=page.locator('#prompt');
 const compacting=()=>page.locator('.lead-progress-label').innerText();
 for(const scenario of ['completed','failed','interrupted','response']){
  for(const marker of ['entered','stage1','foreign','stage2','settling','terminal'])fs.rmSync(path.join(root,marker),{force:true});
  const session=await create('Compaction '+scenario);
  await prompt.fill('Compaction '+scenario);await page.keyboard.press('Enter');
  await until(w=>w.receipts.some(r=>r.session===session&&r.context?.compacted));
  await page.waitForFunction(()=>document.querySelector('.lead-progress-label')?.textContent==='Compacting context…');
  fs.writeFileSync(path.join(root,'stage1'),'');await wait(450);
  assert.equal(await compacting(),'Compacting context…','foreign completion cannot end current progress');
  fs.writeFileSync(path.join(root,'stage2'),'');
  if(['completed','response'].includes(scenario))await page.waitForFunction(()=>document.querySelector('.lead-progress-label')?.textContent!=='Compacting context…');
  const active=(await ws()).receipts.find(r=>r.session===session);
  assert.equal(active.context.compacted,true);assert.equal(active.context.observation,null);
  if(['failed','interrupted'].includes(scenario))assert.equal(await compacting(),'Compacting context…');
  fs.writeFileSync(path.join(root,'terminal'),'');
  await until(w=>w.receipts.find(r=>r.session===session)?.phase===({'interrupted':'cancelled','failed':'failed'}[scenario]||'completed'));
  await page.waitForFunction(()=>document.querySelector('.lead-progress-label')?.textContent==='');
  await prompt.fill('Draft after '+scenario);await page.reload();await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
  assert.equal(await compacting(),'');assert.equal(await prompt.inputValue(),'Draft after '+scenario);
  const reload=(await ws()).receipts.find(r=>r.session===session);assert.equal(reload.context.compacted,true);assert.equal(reload.context.observation,null);assert.equal(reload.context.compacting,null);
  result.checks.push(scenario+': keyed progress, invalidation fence, terminal/reload and draft preserved');
 }
 await prompt.fill('Fresh context');await page.keyboard.press('Enter');
 await until(w=>w.receipts.at(-1)?.context?.observation?.tokens===12345&&w.receipts.at(-1)?.phase==='completed');
 const fresh=(await ws()).receipts.at(-1);assert.equal(fresh.context.compacted,false);assert.equal(fresh.context.compacting,null);
 await page.waitForFunction(()=>[...document.querySelectorAll('.exchange .phase')].at(-1)?.textContent==='Completed'&&!document.querySelector('.lead-progress-label')?.textContent&&!document.querySelector('[aria-label^="Lead context details"]')?.getAttribute('aria-label')?.includes('unavailable'));
 result.checks.push('New turn in the same session accepts its own fresh reading and resets prior compaction fence');
 await page.screenshot({path:path.join(out,'compaction-terminal.png')});assert.deepEqual(errors,[]);result.passed=true;
}finally{fs.writeFileSync(path.join(root,'stage1'),'');fs.writeFileSync(path.join(root,'stage2'),'');fs.writeFileSync(path.join(root,'terminal'),'');result.duration_ms=performance.now()-start;if(page&&!result.passed){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.txt'),await page.locator('body').innerText().catch(()=>''));}await browser?.close();host.kill('SIGTERM');await Promise.race([new Promise(r=>host.once('exit',r)),wait(3000)]);if(host.exitCode===null)host.kill('SIGKILL');result.hostExitCode=host.exitCode;result.hostSignal=host.signalCode;fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}})().catch(e=>{console.error(e);process.exitCode=1;});
