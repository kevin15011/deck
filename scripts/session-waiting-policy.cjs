// Launch-admission oracle: real packaged scheduler/Store/native composition;
// filesystem barriers replace only the external native transport. No user state.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const binary=path.resolve(process.argv[2]||'dist/deck2'),out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/p17-waiting');fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-waiting-')),project=path.join(root,'project');fs.mkdirSync(project);fs.copyFileSync('crates/host/tests/fake_session_native.py',path.join(root,'codex'));fs.chmodSync(path.join(root,'codex'),0o700);fs.writeFileSync(path.join(root,'waiting-fixture'),'');
const host=spawn(binary,['serve','--project',project,'--state-dir',path.join(root,'state'),'--codex',path.join(root,'codex'),'--no-open'],{stdio:['ignore',fs.openSync(path.join(out,'host.log'),'w'),'ignore'],env:{...process.env,CODEX_HOME:path.join(root,'native')}});
const wait=ms=>new Promise(r=>setTimeout(r,ms)),result={binarySha256:crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),cases:[],kind:'Packaged HTTP/Chromium authentication; fake native transport with explicit causal barriers'};let browser,page,base;
async function until(fn){for(let i=0;i<800;i++){const v=await fn();if(v)return v;await wait(25);}throw Error('Waiting fixture deadline');}
async function api(route,data){const r=await page.request[data?'post':'get'](base+route,data?{data,headers:{Origin:base}}:{});assert.equal(r.status(),200,await r.text());return r.json();}
const workspace=()=>api('/api/workspace'),mode=(session,value)=>api(`/api/sessions/${session}/approvals`,{api:7,mode:value});
const observed=()=>fs.existsSync(path.join(root,'waiting-observed'))?fs.readFileSync(path.join(root,'waiting-observed'),'utf8').trim().split('\n').map(JSON.parse):[];
const approval=r=>r.configuration.session_contract.approvals;
const configWithoutMode=r=>{const v=structuredClone(r.configuration);delete v.session_contract.approvals;delete v.delivery_observed;return v;};
const release=key=>fs.writeFileSync(path.join(root,'release-'+key),'');
async function settled(){await until(async()=>{const w=await workspace();return !w.receipts.some(r=>['queued','accepted','preparing','dispatching','running','cancelling'].includes(r.phase))&&!w.tasks.some(t=>t.attempts.some(a=>['accepted','preparing','dispatching','running','cancelling'].includes(a.phase)));});}
(async()=>{try{
 await until(()=>fs.existsSync(path.join(root,'state/launcher.json')));const l=JSON.parse(fs.readFileSync(path.join(root,'state/launcher.json')));base='http://'+l.host;const link=await(await fetch(base+'/launch',{method:'POST',body:l.admin})).json();
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM,headless:true,args:['--no-sandbox']});page=await browser.newPage();await page.goto(link.url);await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 for(const kind of ['lead','member','continued'])for(const [from,to] of [['yolo','relay'],['relay','yolo']]){
  const key=kind+'-'+from,session='waiting-'+key,failures=[];
  const check=(label,fn)=>{try{fn();}catch(e){failures.push(label+': '+e.message);}};
  await api('/api/sessions',{api:7,id:session,title:session,approvals:from,members:{lead:{runnerId:'codex',modelId:'gpt-6.1-sol'},'apply-deep':{runnerId:'codex',modelId:'gpt-6.1-sol'}}});
  const send=(suffix,prompt,queue=false)=>api('/api/commands',{api:7,id:key+'-'+suffix,session,prompt,queue,mode:'session_v1'});
  let before,target,active;
  if(kind==='lead'){
   active=await send('blocker','Waiting-policy hold blocker-'+key);await until(()=>fs.existsSync(path.join(root,'ready-blocker-'+key)));active=(await workspace()).receipts.find(r=>r.id===active.id);
   target=await send('target','Waiting-policy hold target-'+key,true);assert.equal(target.phase,'queued');before=target;
  }else{
   if(kind==='continued'){await send('seed','Waiting-policy seed '+key);await settled();}
   await send('delegate','Waiting-policy delegate '+key);
   await until(()=>fs.existsSync(path.join(root,'ready-blocker-'+key))&&fs.existsSync(path.join(root,'target-'+key)));
   const taskId=fs.readFileSync(path.join(root,'target-'+key),'utf8');
   const w=await workspace();target=w.tasks.find(t=>t.id===taskId);before=target.attempts.at(-1);assert.equal(before.phase,'accepted');assert.equal(target.attempts.length,kind==='continued'?2:1);
   active=w.tasks.find(t=>t.attempts.some(a=>a.prompt==='Waiting-policy hold blocker-'+key)).attempts.at(-1);
  }
  const beforeConfig=configWithoutMode(before),activeConfig=structuredClone(active.configuration);
  await mode(session,to);
  let w=await workspace();const stillActive=kind==='lead'?w.receipts.find(r=>r.id===active.id):w.tasks.flatMap(t=>t.attempts).find(a=>a.id===active.id);
  check('running policy frozen',()=>assert.deepEqual(stillActive.configuration,activeConfig));
  release('blocker-'+key);await until(()=>fs.existsSync(path.join(root,'ready-target-'+key)));
  w=await workspace();const admitted=kind==='lead'?w.receipts.find(r=>r.id===before.id):w.tasks.find(t=>t.id===target.id).attempts.at(-1);
  check('persisted launch mode',()=>assert.equal(approval(admitted),to));check('assignment retained',()=>assert.deepEqual(configWithoutMode(admitted),beforeConfig));
  const native=observed().find(v=>v.text.includes('Waiting-policy hold target-'+key));assert(native);
  check('native launch policy',()=>assert.deepEqual([native.permissions,native.approvalPolicy],to==='yolo'?[':danger-full-access','never']:[':read-only','on-request']));
  // A later mode update cannot alter the execution that has crossed admission.
  const admittedConfig=structuredClone(admitted.configuration);await mode(session,from);w=await workspace();
  const running=kind==='lead'?w.receipts.find(r=>r.id===before.id):w.tasks.find(t=>t.id===target.id).attempts.at(-1);
  check('admitted policy frozen',()=>assert.deepEqual(running.configuration,admittedConfig));
  if(kind!=='lead')check('owner retained',()=>assert.equal(w.tasks.find(t=>t.id===target.id).owner,'apply-deep'));
  release('target-'+key);await settled();result.cases.push({kind,from,to,persisted:approval(admitted),native,failures});console.log(JSON.stringify({kind,from,to,failures}));
 }
 assert(result.cases.every(c=>c.failures.length===0),'Launch-admission regressions: '+JSON.stringify(result.cases.flatMap(c=>c.failures)));result.passed=true;
}finally{await browser?.close();host.kill('SIGTERM');await Promise.race([new Promise(r=>host.once('exit',r)),wait(3000)]);if(host.exitCode===null)host.kill('SIGKILL');fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');if(result.passed)fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
