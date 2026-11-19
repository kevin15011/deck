// Production HTTP/MCP, scheduler and browser, with only the Codex wire faked.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{spawn,execFileSync}=require('node:child_process');
const {setTimeout:wait}=require('node:timers/promises');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-member-guidance-'));const project=path.join(root,'project'),state=path.join(root,'state'),runner=path.join(root,'codex');
fs.mkdirSync(project);execFileSync('git',['init','-q',project]);
const fixture=fs.readFileSync('crates/host/tests/fake_session_native.py','utf8')
 .replaceAll('0.166.0','0.170.0')
 .replace('root=pathlib.Path(__file__).parent',`import threading
root=pathlib.Path(__file__).parent
def fixture_calls(key, binding, thread, turn):
 def invoke(request, invocation):
  method=request['method']
  params=request['params']
  if method=='tools/call':
   out({'method':'item/started','params':{'threadId':thread,'turnId':turn,'item':{'type':'mcpToolCall','id':invocation,'server':'deck-session','tool':params['name'],'arguments':params['arguments']}}})
   params={**params,'_meta':{'threadId':thread,'sessionId':thread,'callId':invocation,'x-codex-turn-metadata':{'thread_id':thread,'session_id':thread,'turn_id':turn}}}
  req=urllib.request.Request(binding['url'],data=json.dumps({'jsonrpc':'2.0','id':invocation,'method':method,'params':params}).encode(),headers={'Content-Type':'application/json',**binding['headers']})
  try:
   with urllib.request.urlopen(req,timeout=18) as response:
    result={'status':response.status,'body':json.load(response)}
  except urllib.error.HTTPError as error:
   result={'status':error.code,'body':json.load(error)}
  output=root/('response-'+invocation)
  temporary=output.with_suffix('.tmp')
  temporary.write_text(json.dumps(result))
  temporary.rename(output)
 while True:
  for pending in sorted(root.glob('request-'+key+'-*')):
   payload=json.loads(pending.read_text())
   pending.unlink()
   threading.Thread(target=invoke,args=(payload,pending.name.split(key+'-',1)[1]),daemon=True).start()
  time.sleep(.015)
`)
 .replace(" elif m=='turn/start':", ` elif m=='turn/steer':
  assert member and p['threadId']==thread and p['expectedTurnId']==turn,p
  with (root/'guidance-wire').open('a') as f:f.write(json.dumps(p)+'\\n')
  text=p['input'][0]['text']
  if 'Fixture race' in text:
   out({'method':'turn/completed','params':{'threadId':thread,'turn':{'id':turn,'status':'completed'}}})
  elif 'Fixture rejected' in text:
   out({'id':v['id'],'error':{'code':-32600,'message':'turn closed'}})
  else:result(v,{'turnId':turn})
 elif m=='turn/start':`)
 .replace("  def tool(name,args):", `  if 'Guidance fixture' in text:
   key='member' if member else text.split()[-1]
   binding={'key':key,'url':spec['url'],'headers':{**spec.get('http_headers',{}),**{key:os.environ[value] for key,value in spec.get('env_http_headers',{}).items()}}}
   threading.Thread(target=fixture_calls,args=(key,binding,thread,turn),daemon=True).start()
   (root/('guidance-'+key)).write_text(json.dumps(binding))
   continue
  def tool(name,args):`);
fs.writeFileSync(runner,fixture,{mode:0o700});
const host=spawn(path.resolve(process.argv[2]||'target/debug/deck2'),['serve','--foreground','--project',project,'--state-dir',state,'--codex',runner,'--no-open'],{stdio:'inherit',env:{...process.env,HOME:root,CODEX_HOME:path.join(root,'native')}});
let browser,page,base,passed=false;
async function until(check,description){for(let i=0;i<400;i++){const result=await check();if(result)return result;await wait(50);}throw Error('Timed out: '+description);}
const binding=async key=>until(()=>{try{return JSON.parse(fs.readFileSync(path.join(root,'guidance-'+key),'utf8'));}catch{}},key);
const wire=()=>fs.existsSync(path.join(root,'guidance-wire'))?fs.readFileSync(path.join(root,'guidance-wire'),'utf8').trim().split('\n').map(JSON.parse):[];
async function rpc(credentials,method,params={},id=randomUUID()){
 const result=await fetch(credentials.url,{method:'POST',headers:{'Content-Type':'application/json',...credentials.headers},body:JSON.stringify({jsonrpc:'2.0',id,method,params})});
 return {status:result.status,body:await result.json()};
}
async function tool(credentials,name,args){
 const id=randomUUID(),request=path.join(root,'request-'+credentials.key+'-'+id),response=path.join(root,'response-'+id);
 const temporary=path.join(root,'pending-'+id);
 fs.writeFileSync(temporary,JSON.stringify({method:'tools/call',params:{name,arguments:args}}));
 fs.renameSync(temporary,request);
 return until(()=>{try{return JSON.parse(fs.readFileSync(response,'utf8'));}catch{}},name);
}
function value(result){assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.result?.isError,false,JSON.stringify(result.body));return JSON.parse(result.body.result.content[0].text);}
async function api(route,data){const response=await page.request[data?'post':'get'](base+route,data?{data,headers:{Origin:base}}:{});assert(response.ok(),await response.text());return response.json();}

(async()=>{try{
 const launcher=await until(()=>{try{return JSON.parse(fs.readFileSync(path.join(state,'launcher.json'),'utf8'));}catch{}},'launcher');
 base='http://'+launcher.host;
 const link=await(await fetch(base+'/launch',{method:'POST',body:launcher.admin})).json();
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||'/snap/bin/chromium',headless:true,args:['--no-sandbox']});
 page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto(link.url);
 const workspace=()=>api('/api/workspace');
 const start=async key=>{
  const session='guidance-'+key;
  await api('/api/sessions',{api:7,id:session,title:session,members:{lead:{runnerId:'codex',modelId:'gpt-6.1-sol'},'apply-deep':{runnerId:'codex',modelId:'gpt-6.1-sol'}}});
  await api('/api/commands',{api:7,id:session+'-request',session,mode:'session_v1',prompt:'Guidance fixture '+key});
  return binding(key);
 };
 const lead=await start('lead');
 const advertised=(await rpc(lead,'tools/list')).body.result.tools;
 assert(advertised.some(t=>t.name==='deck_task_guide'),'Lead must discover the guidance action');
 const delegated=value(await tool(lead,'deck_delegate',{agent:'apply-deep',task:'Guidance fixture hold-member'}));
 const member=await binding('member');
 const target=await until(async()=>{const t=(await workspace()).tasks.find(t=>t.id===delegated.taskId);return t?.attempts[0].phase==='running'&&t;},'member turn');
 const a=target.attempts[0];
 const args={taskId:target.id,attemptId:a.id,threadId:a.native_session,expectedTurnId:a.native_message,commandId:randomUUID(),text:'Fixture accepted guidance'};
 const guide=(credentials,overrides={})=>tool(credentials,'deck_task_guide',{...args,...overrides});
 assert(!(await rpc(member,'tools/list')).body.result.tools.some(t=>t.name==='deck_task_guide'));
 assert((await guide(member)).body.error,'member bridge must refuse guidance');
 assert.equal((await rpc({...lead,headers:{}},'tools/call',{name:'deck_task_guide',arguments:args})).status,401);
 const foreignLead=await start('foreign');
 assert.equal(value(await guide(foreignLead)).status,'undelivered');
 assert.equal(value(await guide(lead,{expectedTurnId:'foreign-turn',commandId:randomUUID()})).status,'undelivered');
 assert.equal(value(await guide(lead,{attemptId:randomUUID(),commandId:randomUUID()})).status,'undelivered');
 assert.equal(wire().length,0);
 const [first,retry]=await Promise.all([guide(lead),guide(lead)]);
 assert.deepEqual(value(first),value(retry));
 assert.equal(value(first).status,'accepted');
 assert.equal(value(await guide(lead)).status,'accepted');
 assert((await guide(lead,{text:'changed retry'})).body.result.isError);
 assert.equal(wire().length,1);
 assert.equal(wire()[0].clientUserMessageId,args.commandId);
 assert.match(wire()[0].input[0].text,/Deck live guidance from Lead/);

 const rejected={commandId:randomUUID(),text:'Fixture rejected guidance'};
 assert.equal(value(await guide(lead,rejected)).status,'undelivered');
 const racing={commandId:randomUUID(),text:'Fixture race guidance'};
 assert.equal(value(await guide(lead,racing)).status,'unknown');
 await until(async()=>(await workspace()).tasks.find(t=>t.id===target.id)?.attempts[0].phase==='completed','member completes during steering');
 assert.equal(value(await guide(lead,racing)).status,'unknown');
 assert.equal(value(await guide(lead,{commandId:randomUUID()})).status,'undelivered');
 assert.equal(wire().length,3);
 assert.equal((await workspace()).receipts.find(r=>r.id==='guidance-lead-request').decisions.length,0);

 const exchange=await api('/api/sessions/guidance-lead/tasks/'+target.id+'/attempts/'+a.id+'/exchanges');
 assert.deepEqual(exchange.messages.filter(v=>v.source==='lead-guidance').map(v=>[v.role,v.delivery,v.text]),[['lead','accepted',args.text],['lead','undelivered',rejected.text],['lead','unknown',racing.text]]);
 await page.reload();
 await page.locator('.sidebar .session').filter({hasText:'guidance-lead'}).click();
 await page.getByRole('button',{name:'Open Subagents',exact:true}).click();
 await page.getByRole('button',{name:'Open full view'}).click();
 const log=page.getByRole('log',{name:'Apply Deep conversation'});
 for(const [text,status] of [[args.text,'Delivered live'],[rejected.text,'Undelivered'],[racing.text,'Delivery unknown']]){
  const row=log.locator('article').filter({hasText:text});
  await row.getByText('Lead',{exact:true}).waitFor();
  await row.getByText(status,{exact:true}).waitFor();
 }

 const continued=value(await tool(lead,'deck_delegate',{agent:'apply-deep',continueTaskId:target.id,continuity:'fresh',task:'Guidance fixture next-member'}));
 assert.equal(continued.attempt,2);
 const next=await until(async()=>{
  const n=(await workspace()).tasks.find(t=>t.id===target.id)?.attempts[1];
  return n?.phase==='running'&&n;
 },'subsequent member attempt');
 assert.equal(value(await guide(lead,racing)).status,'unknown');
 assert.equal(value(await guide(lead,{commandId:randomUUID()})).status,'undelivered');
 assert((await guide(lead,{...racing,attemptId:next.id,threadId:next.native_session,expectedTurnId:next.native_message})).body.result.isError);
 assert.equal(wire().length,3);
 passed=true;console.log('Member live guidance passed through MCP, native wire, ledger and browser.');
}finally{await browser?.close();host.kill('SIGTERM');await Promise.race([new Promise(r=>host.once('exit',r)),wait(3000)]);if(host.exitCode===null)host.kill('SIGKILL');if(passed)fs.rmSync(root,{recursive:true,force:true});else console.error('Fixture retained at '+root);}})().catch(e=>{console.error(e);process.exitCode=1;});
