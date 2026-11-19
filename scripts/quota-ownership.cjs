// DAILY52-Q01: independent packaged hosts, shared isolated native auth scope; no real native effects.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),crypto=require('crypto'),{spawn}=require('child_process');
const binary=path.resolve(process.argv[2]||'dist/deck2'),out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/repair53/ownership');fs.mkdirSync(out,{recursive:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms)),until=async f=>{for(let i=0;i<400;i++){if(await f())return;await wait(15);}throw Error('Fixture deadline');};
const result={binarySha256:crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),checks:[],passed:false},start=performance.now();
(async()=>{for(const exclusive of ['login','maintenance'])for(const quotaFirst of [true,false]){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-quota-ownership-')),hosts=[],clients=[];fs.mkdirSync(path.join(root,'project'));fs.writeFileSync(path.join(root,'case'),'cancel');
 let source=fs.readFileSync('scripts/fixtures/s7-codex.py','utf8').replace("if '--version' in sys.argv:","if '--version' in sys.argv:\n if (base/'hold-maintenance').exists():\n  import time\n  (base/'entered-maintenance').touch()\n  while (base/'hold-maintenance').exists():time.sleep(.01)").replace(" elif m=='account/read':"," elif m=='account/rateLimits/read':\n  import time\n  (base/'entered-quota').touch()\n  while (base/'hold-quota').exists():time.sleep(.01)\n  reply(q,{'rateLimits':{'planType':'pro'}})\n elif m=='account/read':");
 const native=path.join(root,'codex');fs.writeFileSync(native,source,{mode:0o700});
 try{
  for(let i=0;i<2;i++){
   const state=path.join(root,'state'+i),host=spawn(binary,['serve','--foreground','--project',path.join(root,'project'),'--state-dir',state,'--codex',native,'--no-open'],{stdio:'ignore',env:{...process.env,HOME:root,CODEX_HOME:path.join(root,'auth')}});hosts.push(host);
   await until(()=>fs.existsSync(path.join(state,'launcher.json')));const launcher=JSON.parse(fs.readFileSync(path.join(state,'launcher.json'))),base='http://'+launcher.host;
   const link=await(await fetch(base+'/launch',{method:'POST',body:launcher.admin})).json();const auth=await fetch(base+'/auth',{method:'POST',body:new URL(link.url).hash.slice(1),headers:{Origin:base}});assert.equal(auth.status,204);const cookie=auth.headers.get('set-cookie').split(';')[0];
   clients.push(async(method,url,data,signal)=>{const r=await fetch(base+url,{method,headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal});return {status:r.status,body:await r.json()};});
  }
  const [a,b]=clients,revision=(await a('GET','/api/configuration')).body.selected.revision;
  const body={api:7,expected_revision:revision,...(exclusive==='login'?{id:'quota-process-login',kind:'device'}:{})};
  const endpoint=exclusive==='login'?'/api/runners/login':'/api/runners/maintenance';
  if(quotaFirst){
   fs.writeFileSync(path.join(root,'hold-quota'),'');const abort=new AbortController(),pending=a('POST','/api/quota/codex/refresh',{},abort.signal).catch(()=>null);await until(()=>fs.existsSync(path.join(root,'entered-quota')));abort.abort();await pending;
   const blocked=await b('POST',endpoint,body);assert.equal(blocked.status,409,JSON.stringify(blocked));
   fs.unlinkSync(path.join(root,'hold-quota'));await until(async()=>!(await a('GET','/api/quota')).body.runners.codex.refreshing);
   assert.equal((await b('POST','/api/runners/maintenance',{api:7,expected_revision:revision})).status,200);
  }else{
   if(exclusive==='maintenance')fs.writeFileSync(path.join(root,'hold-maintenance'),'');const pending=a('POST',endpoint,body);
   if(exclusive==='maintenance')await until(()=>fs.existsSync(path.join(root,'entered-maintenance')));else assert.equal((await pending).status,200);
   const blocked=await b('POST','/api/quota/codex/refresh',{});assert.equal(blocked.status,409,JSON.stringify(blocked));
   if(exclusive==='maintenance'){fs.unlinkSync(path.join(root,'hold-maintenance'));assert.equal((await pending).status,200);}else{
    const cancel=await a('POST','/api/runners/operations/quota-process-login/cancel',{api:7});assert.equal(cancel.status,200,JSON.stringify(cancel));
    await until(async()=>['cancelled','failed','authenticated'].includes((await a('GET','/api/runners/operations/quota-process-login')).body.operation.phase));
   }
   assert.equal((await b('POST','/api/quota/codex/refresh',{})).status,200);
  }
  const calls=fs.readFileSync(path.join(root,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert(!calls.some(c=>/^thread\/|^turn\//.test(c.method)));
  result.checks.push({exclusive,quotaFirst,root,passed:true});
 }finally{for(const marker of ['hold-quota','hold-maintenance'])fs.rmSync(path.join(root,marker),{force:true});for(const h of hosts)h.kill('SIGTERM');for(const h of hosts)await Promise.race([new Promise(r=>h.exitCode!==null||h.signalCode?r():h.once('exit',r)),wait(2000)]);for(const h of hosts)if(h.exitCode===null&&!h.signalCode)h.kill('SIGKILL');}
}result.passed=true;})().catch(e=>{result.error=String(e);process.exitCode=1;}).finally(()=>{result.duration_ms=performance.now()-start;fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));});
