// P10/P16: real keys and default packaged composition; only native/network edges are synthetic.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),crypto=require('crypto'),{spawn,execFileSync}=require('child_process');
const repo=path.resolve(__dirname,'..'),binary=path.resolve(process.argv[2]||'dist/deck2'),out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/recall95/red');fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-stop-')),project=path.join(root,'project');fs.mkdirSync(project);
const git=(...args)=>execFileSync('/usr/bin/git',args,{cwd:project,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
git('init','-q','-b','keyboard-unborn');
let native=fs.readFileSync(path.join(repo,'crates/host/tests/fake_session_native.py'),'utf8').replace(" elif m=='turn/start':", " elif m=='turn/interrupt':\n  result(v,{})\n  out({'method':'turn/completed','params':{'threadId':thread,'turn':{'id':'normal-turn','status':'interrupted'}}})\n elif m=='turn/start':").replace("  assert p['approvalPolicy']","  while (root/'prepare-gate').exists():time.sleep(.02)\n  assert p['approvalPolicy']").replace("  def tool(name,args):","  if 'Keyboard hold' in text:continue\n  def tool(name,args):");
fs.writeFileSync(path.join(root,'codex'),native,{mode:0o700});
const host=spawn(binary,['serve','--project',project,'--state-dir',path.join(root,'state'),'--codex',path.join(root,'codex'),'--no-open'],{stdio:'ignore',env:{...process.env,HOME:root,XDG_DATA_HOME:path.join(root,'data'),XDG_CONFIG_HOME:path.join(root,'config'),CODEX_HOME:path.join(root,'native')}});
const wait=ms=>new Promise(r=>setTimeout(r,ms));let browser,page;
const result={binarySha256:crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),checks:[],passed:false,root};const start=performance.now();
(async()=>{try{
 for(let i=0;i<200&&!fs.existsSync(path.join(root,'state/launcher.json'));i++)await wait(100);
 const launcher=JSON.parse(fs.readFileSync(path.join(root,'state/launcher.json'))),base='http://'+launcher.host,link=await(await fetch(base+'/launch',{method:'POST',body:launcher.admin})).json();
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||'/snap/bin/chromium',headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(link.url);await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 const ws=async()=>await(await page.request.get(base+'/api/workspace')).json();const until=async fn=>{for(let i=0;i<200;i++){const w=await ws();if(fn(w))return w;await wait(100);}throw Error('Workspace deadline');};
 const create=async title=>{await page.getByRole('button',{name:'New session in project',exact:true}).click();await page.getByLabel('Session name',{exact:true}).fill(title);await page.getByRole('button',{name:'Create session',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.waitForFunction(title=>document.querySelector('.app-header h1')?.textContent===title,title);return (await ws()).sessions.find(s=>s.title===title).id;};

 const prompt=page.locator('#prompt');
 const pair=async()=>{await page.keyboard.press('Escape');await wait(40);await page.keyboard.press('Escape');};
 const attach=async()=>{const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Attach images',exact:true}).click();await(await chooser).setFiles({name:'recovery.png',mimeType:'image/png',buffer:fs.readFileSync(path.join(repo,'scripts/fixtures/s8c-synthetic.png'))});await page.waitForFunction(()=>document.querySelector('.image-draft small')?.textContent==='Ready');};
 for(const fault of ['lost-response','reload-ack','image-persistence','text-persistence']){
  const session=await create('Recovery '+fault);
  fs.writeFileSync(path.join(root,'prepare-gate'),'');await attach();await prompt.fill('Recover '+fault);await page.keyboard.press('Enter');
  const pinned=await until(w=>w.receipts.at(-1)?.session===session&&w.receipts.at(-1).phase==='preparing'&&w.receipts.at(-1).dispatch_ms===null),input=pinned.receipts.at(-1);
  await page.waitForFunction(()=>document.querySelector('[aria-label="Cancel task"]'));
  // Hold workspace projection so only the acknowledgement can reveal committed recall until reload.
  await page.route('**/api/workspace',route=>route.fulfill({json:pinned}));await wait(600);
  if(fault.endsWith('persistence'))await page.evaluate(fault=>{
   const original=Storage.prototype.setItem;
   Storage.prototype.setItem=function(key,value){if(this===localStorage&&key.endsWith(fault==='image-persistence'?'.images':'.draft'))throw Error('Injected storage failure');return original.call(this,key,value);};
  },fault);
  let seen,release;const observed=new Promise(r=>seen=r),gate=new Promise(r=>release=r);
  await page.route('**/api/commands/*/recall',async route=>{const response=await route.fetch();seen();if(fault==='reload-ack')await gate;if(fault==='lost-response')await route.abort();else await route.fulfill({response}).catch(()=>{});});
  await pair();await observed;
  if(fault!=='reload-ack')await wait(200);
  if(fault==='image-persistence')assert.equal(await prompt.inputValue(),'Recover '+fault,'text persists before image failure');
  await page.unroute('**/api/workspace');
  await page.reload();release();await page.unroute('**/api/commands/*/recall');
  await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
  await page.waitForFunction(expected=>document.querySelector('#prompt')?.value===expected,'Recover '+fault,{timeout:6000});
  await page.waitForFunction(()=>document.querySelectorAll('.image-draft').length===1);
  assert.equal(await page.locator('#exchange-'+input.id).count(),0);
  fs.unlinkSync(path.join(root,'prepare-gate'));await until(w=>w.receipts.find(r=>r.id===input.id)?.phase==='cancelled');
  await prompt.fill('Edited recovered '+fault);await page.reload();await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
  assert.equal(await prompt.inputValue(),'Edited recovered '+fault);assert.equal(await page.locator('.image-draft').count(),1);
  const other=await create('Other '+fault);assert.notEqual(other,session);await page.getByRole('button',{name:'Recovery '+fault,exact:true}).click();
  await page.waitForFunction(expected=>document.querySelector('#prompt')?.value===expected,'Edited recovered '+fault);
  assert.equal(await page.locator('.image-draft').count(),1);
  result.checks.push(fault+': exact text/image recovery survives reload, preserves later edits and never duplicates on reopen');
 }
 assert.deepEqual(errors,[]);result.passed=true;
}finally{result.duration_ms=performance.now()-start;if(page&&!result.passed){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.txt'),await page.locator('body').innerText().catch(()=>''));}await browser?.close();host.kill('SIGTERM');await Promise.race([new Promise(r=>host.once('exit',r)),wait(3000)]);if(host.exitCode===null)host.kill('SIGKILL');result.hostExitCode=host.exitCode;result.hostSignal=host.signalCode;fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}})().catch(e=>{console.error(e);process.exitCode=1;});
