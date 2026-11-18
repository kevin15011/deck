// S2-Q01/Q02: production packaged HTTP/React/native composition, fake native edge.
// Oracle: rejected answers remain correctable; ambiguous identities stay retained;
// native completion cannot imply a successful snapshot read. Owned temp state only.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..'),kind=process.argv[2]||'answers',root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-corrections-'));
const evidence=process.env.DECK2_EVIDENCE_DIR||path.join(repo,'target/s2-corrections');fs.mkdirSync(evidence,{recursive:true});
const project=path.join(root,'project'),state=path.join(root,'state');fs.mkdirSync(project);fs.writeFileSync(path.join(project,'example.txt'),'before\n');
fs.copyFileSync(path.join(repo,'crates/host/tests/fake_native.py'),path.join(root,'codex'));fs.chmodSync(path.join(root,'codex'),0o700);
fs.writeFileSync(path.join(root,'mode'),kind==='snapshot'?'edit-missing':'edit-question');
const host=spawn(process.env.DECK2_BINARY||path.join(repo,'dist/deck2'),['serve','--project',project,'--state-dir',state,'--codex',path.join(root,'codex'),'--no-open']);
const start=Date.now(),wait=ms=>new Promise(r=>setTimeout(r,ms));let browser;
(async()=>{try{
 for(let i=0;i<100&&!fs.existsSync(path.join(state,'launcher.json'));i++)await wait(100);
 const launcher=JSON.parse(fs.readFileSync(path.join(state,'launcher.json'))),base='http://'+launcher.host;
 const {url}=await(await fetch(base+'/launch',{method:'POST',body:launcher.admin})).json();
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||'/snap/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 await page.getByLabel('Execution mode').selectOption('reviewed_edit');await page.getByLabel('Trust this project for reviewed editing').check();
 const snapshot=()=>page.evaluate(async()=>await(await fetch('/api/workspace')).json());
 async function propose(){await page.getByLabel('Ask a read-only question').fill('owned correction fixture');await page.getByRole('button',{name:'Send question'}).click();await page.waitForFunction(()=>[...document.querySelectorAll('.review .phase')].at(-1)?.textContent==='pending');return (await snapshot()).receipts.at(-1).decisions[0];}
 async function finished(){await page.waitForFunction(()=>[...document.querySelectorAll('.assistant-message > .message-meta .phase')].at(-1)?.textContent==='Completed');}
 const initial=await snapshot(),hostId=initial.host_id,api=initial.api;
 let d=await propose();
 if(kind==='snapshot'){
  await page.getByRole('button',{name:'Allow once',exact:true}).click();await finished();
  const result=(await snapshot()).receipts.at(-1).decisions[0];
  assert.equal(result.state,'settled');assert.equal(result.file.native_status,'completed');assert.equal(result.file.after,null);
  assert(result.file.snapshot_error,'Missing snapshot needs a retained reason');
  await page.getByRole('button',{name:'Observed change',exact:true}).click();
  assert.match(await page.locator('.review-diff').innerText(),/unavailable/i);
 }else{
  const input=()=>page.locator('.review').last().locator('input'),send=()=>page.getByRole('button',{name:'Send answers',exact:true}).last();
  const key=()=> 'deck2.host.'+hostId+'.project.'+encodeURIComponent(project)+'.session.'+d.session+'.decision.'+d.id;
  const retained=()=>page.evaluate(k=>localStorage.getItem(k),key());
  const fill=async text=>{await input().fill(text);await send().click();};
  let posts=0;page.on('request',r=>{if(r.url().includes('/responses'))posts++;});
  await fill('界'.repeat(2000));await wait(150);
  assert((await retained())===null,'Oversized answers must not retain identity');assert.equal(posts,0);
  await page.reload();await input().waitFor();await fill('Copper');await finished();
  // Old poisoned payload: explicit correction must obtain authoritative rejection
  // of that exact identity before retaining/releasing the replacement.
  d=await propose();const poisoned={api,command_id:crypto.randomUUID(),expected_revision:d.revision,response:{type:'answers',answers:{word:['界'.repeat(2000)]}}};
  await page.evaluate(({k,v})=>localStorage.setItem(k,JSON.stringify(v)),{k:key(),v:poisoned});await page.reload();await input().waitFor();
  await fill('Copper');await finished();assert.notEqual(JSON.parse(await retained()).command_id,poisoned.command_id);
  // Lost ack, generic 409, and mismatched rejection proof are never clearance.
  for(const fault of ['lost','generic','wrong-proof']){
   d=await propose();const route='**/api/decisions/'+d.id+'/responses';
   await page.route(route,async r=>{if(fault==='lost')await r.abort();else await r.fulfill({status:409,contentType:'application/json',body:JSON.stringify(fault==='generic'?{message:'rejected',correlation:'fixture'}:{api,code:'answers_not_accepted',decision_id:'other-decision',command_id:r.request().postDataJSON().command_id,expected_revision:d.revision})});});
   await fill('Amber');await wait(150);const old=await retained();assert(old);
   await page.reload();await input().waitFor();await fill('Copper');await wait(150);assert.equal(await retained(),old);
   await page.unroute(route);
   // User explicitly retries original response, preserving identity, then settles.
   await fill('Amber');await finished();assert.equal(await retained(),old);
  }
 }
 assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(evidence,kind+'.png')});
 fs.writeFileSync(path.join(evidence,kind+'.json'),JSON.stringify({passed:true,kind,duration_s:(Date.now()-start)/1000,workspace:await snapshot()},null,2));
 console.log(JSON.stringify({passed:true,kind,duration_s:(Date.now()-start)/1000}));
}finally{if(browser)await browser.close();host.kill('SIGTERM');await new Promise(r=>host.exitCode!==null?r():host.once('exit',r));}})().catch(e=>{console.error(e);process.exitCode=1;});
