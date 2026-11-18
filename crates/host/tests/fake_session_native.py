#!/usr/bin/env python3
"""Hermetic Codex transport oracle for the original normal-session journey."""
import sys,json,pathlib,urllib.request,urllib.error,os,re,tomllib,subprocess,time
root=pathlib.Path(__file__).parent
pending_mcp=None
turn='normal-turn'
turn_serial=0
initialized=False
loaded_threads=set()
thread_serial=0
startup=(root/'startup-fixture').exists()
if startup:
 with (root/'startup-wire').open('a') as f:f.write(json.dumps({'pid':os.getpid(),'method':'spawn','version':'--version' in sys.argv})+'\n')
thread=(root/"original-thread").read_text().strip() if (root/"original-thread").exists() else "reseed-thread" if (root/"missing-history").exists() else "normal-thread"
if '--version' in sys.argv: print('codex-cli 0.166.0');sys.exit()
features={sys.argv[i+1]:a=='--enable' for i,a in enumerate(sys.argv[:-1]) if a in ['--disable','--enable']}
def out(v):print(json.dumps(v),flush=True)
def result(v,r):out({'id':v['id'],'result':r})
for line in sys.stdin:
 v=json.loads(line);m=v.get('method');p=v.get('params',{})
 if startup:
  with (root/'startup-wire').open('a') as f:f.write(json.dumps({'pid':os.getpid(),'method':m,'cursor':p.get('cursor'),'serverName':p.get('serverName')})+'\n')
 if not m and v.get('id')==80:
  if v.get('result',{}).get('decision')=='accept':
   effect=root/'native-created.txt'
   effect.write_text((effect.read_text() if effect.exists() else '')+'allowed\n')
  out({'method':'turn/completed','params':{'threadId':thread,'turn':{'id':turn,'status':'completed'}}})
  continue
 if not m and v.get('id')==81:
  assert v.get('result',{}).get('action')=='accept'
  with (root/'mcp-approved').open('a') as f:f.write(json.dumps(pending_mcp)+'\n')
  out({'method':'turn/completed','params':{'threadId':thread,'turn':{'id':turn,'status':'completed'}}})
  continue
 if m=='initialize':
  if initialized:out({'id':v['id'],'error':{'code':-32600,'message':'Already initialized'}});continue
  initialized=True
  result(v,{'userAgent':'deck2/0.166.0 (fake)'})
 elif m=='initialized':pass
 elif m=='account/read':
  if (root/'member-hold-preparation').exists():
   (root/('member-preparing-'+str(os.getpid()))).touch()
   while (root/'member-hold-preparation').exists():time.sleep(.01)
  if (root/'revoked-auth').exists():result(v,{'account':None})
  else:result(v,{'account':{'type':'chatgpt'}})
 elif m=='environment/status':result(v,{'status':'ready'})
 elif m=='config/read':result(v,{'config':{'agents':{'enabled':'agents.enabled=false' not in sys.argv},'features':features,'mcp_servers':json.loads((root/'native-config.json').read_text()) if (root/'native-config.json').exists() else {},'notify':[],**(json.loads((root/'reasoning-config.json').read_text()) if (root/'reasoning-config.json').exists() else {})}})
 elif m=='hooks/list':
  hooks=json.loads((root/'hook-inventory.json').read_text()) if (root/'hook-inventory.json').exists() else []
  state={}
  # Codex CLI splits the LEFT side on dots literally; quoting a path segment
  # does not turn it into a TOML key. Only the right side is parsed as TOML.
  config={}
  for i,arg in enumerate(sys.argv[:-1]):
   if arg=='-c' and '=' in sys.argv[i+1]:
    key,value=sys.argv[i+1].split('=',1)
    try:parsed=tomllib.loads('_x_ = '+value)['_x_']
    except tomllib.TOMLDecodeError:continue
    target=config;parts=key.split('.')
    for part in parts[:-1]:target=target.setdefault(part,{})
    target[parts[-1]]=parsed
  state=config.get('hooks',{}).get('state',{})
  for hook in hooks:
   selected=state.get(hook['key'],{})
   hook.update({'enabled':selected.get('enabled',True),'trustStatus':'trusted' if selected.get('trusted_hash')==hook['currentHash'] else 'untrusted'})
  result(v,{'data':[{'cwd':p['cwds'][0],'hooks':hooks,'errors':[]}]})
 elif m=='model/list':result(v,{'data':json.loads((root/'model-inventory.json').read_text()) if (root/'model-inventory.json').exists() else [{'model':'gpt-6.1-sol','supportedReasoningEfforts':[{'reasoningEffort':'high'}]},{'model':'recorded-worker','supportedReasoningEfforts':[{'reasoningEffort':'high'}]}],'nextCursor':None})
 elif m in ['thread/start','thread/resume']:
  if m=='thread/resume':thread=p['threadId']
  elif thread_serial:
   thread='normal-thread-'+str(thread_serial+1)
  thread_serial+=1
  if m=='thread/start' and (root/'missing-history').exists():thread='reseed-thread'
  if m=='thread/resume' and (root/'lose-resume').exists():sys.exit(0)
  if m=='thread/resume' and (root/'missing-history').exists() and p['threadId']=='normal-thread':
   with (root/'journey').open('a') as f:f.write('thread/resume-missing\n')
   out({'id':v['id'],'error':{'code':-32600,'message':'no rollout found for thread id '+p['threadId']}})
   continue
  loaded_threads.add(thread)
  with (root/'wire').open('a') as f:f.write(json.dumps({'method':m,'params':p})+'\n')
  assert p['approvalPolicy'] in ['never','on-request'] and p['permissions'] in [':read-only',':workspace',':danger-full-access']
  permissions=p['permissions'];policy=p['approvalPolicy']
  if permissions!=':read-only':assert policy=='never'
  with (root/'native-protocol').open('a') as f:f.write(json.dumps({'method':m,'permissions':permissions,'approvalPolicy':policy,'threadId':p.get('threadId')})+'\n')
  assert p['model'] in ['gpt-6.1-sol','recorded-worker']
  assert len(p['developerInstructions'])>100
  spec=p['config']['mcp_servers']['deck-session']
  overrides=p['config']['mcp_servers']
  for entry in overrides.values():
   if 'tool_timeout_sec' in entry:assert type(entry['tool_timeout_sec']) in [int,float], 'native timeout override must be numeric, not null'
  with (root/'overrides').open('a') as f:f.write(json.dumps(overrides)+'\n')
  mcp_serial=0
  def mcp(method,args={}):
   global mcp_serial
   mcp_serial+=1
   if method=='tools/call':
    call='fixture-call-'+str(mcp_serial)
    out({'method':'item/started','params':{'threadId':thread,'turnId':turn,'item':{'type':'mcpToolCall','id':call,'server':'deck-session','tool':args['name'],'arguments':args.get('arguments',{})}}})
    args={**args,'_meta':{'threadId':thread,'sessionId':thread,'callId':call,'x-codex-turn-metadata':{'thread_id':thread,'session_id':thread,'turn_id':turn}}}
   req=urllib.request.Request(spec['url'],data=json.dumps({'jsonrpc':'2.0','id':mcp_serial,'method':method,'params':args}).encode(),headers={'Content-Type':'application/json',**spec.get('http_headers',{}),**{key:os.environ[value] for key,value in spec.get('env_http_headers',{}).items()}})
   return json.load(urllib.request.urlopen(req))
  if startup:
   prior=root/'previous-attempt-header'
   if prior.exists() and prior.read_text()!=spec.get('http_headers',{}).get('Authorization'):
    request=urllib.request.Request(spec['url'],data=json.dumps({'jsonrpc':'2.0','id':909,'method':'tools/list'}).encode(),headers={'Content-Type':'application/json','Authorization':prior.read_text()})
    try:
     urllib.request.urlopen(request)
     raise AssertionError('Retired credential authorized a live subsequent attempt')
    except urllib.error.HTTPError as error:assert error.code==401
    with (root/'credential-rotation').open('a') as f:f.write('rejected\n')
   prior.write_text(spec.get('http_headers',{}).get('Authorization') or os.environ[spec['env_http_headers']['Authorization']])
  assert 'deck_session_history' in [t['name'] for t in mcp('tools/list')['result']['tools']]
  with (root/'journey').open('a') as f:f.write(m+'\n')
  member='deck_delegate' not in [t['name'] for t in mcp('tools/list')['result']['tools']]
  with (root/'policies').open('a') as f:f.write(json.dumps({'member':member,'policy':p['approvalPolicy'],'permissions':p['permissions']})+'\n')
  result(v,{'thread':{'id':thread},'activePermissionProfile':{'id':':read-only' if (root/'wrong-permission-ack').exists() else permissions},'sandbox':{'type':{':read-only':'readOnly',':workspace':'workspaceWrite',':danger-full-access':'dangerFullAccess'}[permissions],'networkAccess':False},'approvalPolicy':p['approvalPolicy'],'approvalsReviewer':'user','cwd':'/foreign-project' if (root/'wrong-member-cwd').exists() else p['cwd'],'model':p['model'],'reasoningEffort':json.loads((root/'reasoning-ack.json').read_text()) if (root/'reasoning-ack.json').exists() else p['config'].get('model_reasoning_effort','high')})
 elif m=='thread/unsubscribe':
  loaded_threads.discard(p['threadId'])
  result(v,{'status':'unsubscribed'})
  out({'method':'thread/closed','params':{'threadId':p['threadId']}})
 elif m=='thread/loaded/list':result(v,{'data':sorted(loaded_threads),'nextCursor':None})
 elif m=='mcpServerStatus/list':
  if not p.get('serverName') and (root/'slow-full-mcp').exists():time.sleep(1.5)
  entries=[{'name':'deck-session','runtimeStatus':'connected','tools':{t['name']:{} for t in mcp('tools/list')['result']['tools']}}]
  configured=json.loads((root/'native-config.json').read_text()) if (root/'native-config.json').exists() else {}
  for selected in ['deck-codebase-memory','deck-context7']:
   if selected in overrides:configured.setdefault(selected,{})
  for name,specification in configured.items():
   merged={**specification,**overrides.get(name,{})}
   entries.append({'name':name,'runtimeStatus':'connected' if merged.get('enabled',True) else 'disabled','tools':{t:{} for t in merged.get('enabled_tools',['search_graph','index_repository','delete_project'])}})
  if not p.get('serverName') and (root/'paginated-mcp').exists():
   if not p.get('cursor'):result(v,{'data':[], 'nextCursor':'last'});continue
   if (root/'unadmitted-mcp').exists():entries.append({'name':'mail','runtimeStatus':'connected','tools':{'send':{}}})
  entries+=[] if member or (root/'native-config.json').exists() else [{'name':'synthetic-mail','runtimeStatus':'connected','tools':{'send_message':{}}}]
  if p.get('serverName')=='synthetic-mail' and (root/'mcp-approval-scenario').exists():
   # The compatible app server can keep a stale catalog in its loaded connection.
   for entry in entries:
    if entry['name']=='synthetic-mail':entry['tools']['send_message']={}
  result(v,{'data':[entry for entry in entries if not p.get('serverName') or entry['name']==p['serverName']],'nextCursor':None})
 elif m=='turn/start':
  turn_serial+=1
  turn='normal-turn' if turn_serial==1 else 'normal-turn-'+str(turn_serial)
  out({'method':'turn/started','params':{'threadId':thread,'turn':{'id':turn}}})
  with (root/'wire').open('a') as f:f.write(json.dumps({'method':m,'params':p})+'\n')
  assert p['permissions']==permissions and p['approvalPolicy']==policy
  with (root/'native-protocol').open('a') as f:f.write(json.dumps({'method':m,'permissions':p['permissions'],'approvalPolicy':p['approvalPolicy']})+'\n')
  with (root/'dispatch-count').open('a') as f:f.write('dispatch\n')
  if (root/'lose-ack').exists():sys.exit(0)
  assert p['threadId']==thread
  result(v,{'turn':{'id':turn}})
  if member:
   for name in ['deck_delegate','deck_task_list','deck_task_cancel','deck_task_integrate']:
    denied=mcp('tools/call',{'name':name,'arguments':{}})
    assert 'error' in denied,denied
   denied=mcp('tools/call',{'name':'deck_task_result','arguments':{}})
   assert denied['result']['isError'],denied
  text='\n'.join(x.get('text','') for x in p['input'])
  # Route only the current admitted input. Historical evidence must never
  # cause this transport fixture to replay an earlier scripted delegation.
  text=text.rsplit('Current user input: ',1)[-1].rsplit('Current input: ',1)[-1]
  def tool(name,args):
   reply=mcp('tools/call',{'name':name,'arguments':args})
   assert 'error' not in reply,reply
   reply=reply['result'];assert not reply['isError'],reply
   return json.loads(reply['content'][0]['text'])
  if not member and text.startswith('CONTINUE_MIXED '):
   task=text.split()[1]
   delegated=tool('deck_delegate',{'agent':'apply-deep','continueTaskId':task,'task':'Return second fixture report','continuity':'fresh'})
   (root/'delegated-task').write_text(task)
   (root/'mixed-continuation').write_text(task)
  if not member and 'Continue original-task' in text:
   delegated=tool('deck_delegate',{'agent':'quality','continueTaskId':'same-task','task':'Waiting-policy hold original-continued'})
   (root/'continued-task').write_text(json.dumps(delegated))
  if 'Waiting-policy' in text:
   with (root/'waiting-observed').open('a') as f:f.write(json.dumps({'text':text,'member':member,'permissions':permissions,'approvalPolicy':policy})+'\n')
   if not member and 'Waiting-policy delegate ' in text:
    key=re.search(r'Waiting-policy delegate ([a-z0-9-]+)',text)[1]
    tool('deck_delegate',{'agent':'apply-deep','task':'Waiting-policy hold blocker-'+key})
    args={'agent':'apply-deep','task':'Waiting-policy hold target-'+key}
    prior=root/('seed-'+key)
    if prior.exists() and prior.read_text()!=spec.get('http_headers',{}).get('Authorization'):args['continueTaskId']=prior.read_text()
    target=tool('deck_delegate',args)
    (root/('target-'+key)).write_text(target['taskId'])
   if not member and 'Waiting-policy seed ' in text:
    key=re.search(r'Waiting-policy seed ([a-z0-9-]+)',text)[1]
    target=tool('deck_delegate',{'agent':'apply-deep','task':'Waiting-policy seed member'})
    (root/('seed-'+key)).write_text(target['taskId'])
   held=re.search(r'Waiting-policy hold ([a-z0-9-]+)',text)
   if held:
    key=held[1];(root/('ready-'+key)).touch()
    for _ in range(1200):
     if (root/('release-'+key)).exists():break
     time.sleep(.025)
    else:raise RuntimeError('Waiting policy fixture release deadline')
  if 'Fresh graph' in text:
   selected=overrides['codebase-memory'];assert selected['args']==['codebase-bridge'],selected
   pattern=re.search(r'Fresh graph ([A-Za-z0-9_.*]+)',text)[1]
   for attempt in range(160):
    request={'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'search_graph','arguments':{'name_pattern':pattern}}}
    queried=subprocess.run([selected['command']]+selected['args'],input=json.dumps(request)+'\n',text=True,capture_output=True,env={**os.environ,**selected['env']},cwd=selected['cwd'],timeout=30)
    assert queried.returncode==0,queried.stderr
    graph=json.loads(queried.stdout)['result']
    if not graph.get('isError'):break
    time.sleep(.1)
   assert not graph.get('isError'),graph
   with (root/'fresh-graphs').open('a') as f:f.write(json.dumps({'member':member,'result':graph})+'\n')
  if 'Open coordination question' in text:
   prompt=re.search(r'promptId=([^ ]+)',text)[1]
   opened=tool('deck_decision_open',{'commandId':'coordination-open','key':'permission-scope','question':'May Apply inspect the coordination fixture?','source':{'promptId':prompt}})
   (root/'coordination-decision').write_text(opened['decisionId'])
  if 'Allow coordination dependency' in text:
   prompt=re.search(r'promptId=([^ ]+)',text)[1];decision=(root/'coordination-decision').read_text()
   tool('deck_decision_resolve',{'commandId':'coordination-resolve','decisionId':decision,'expectedRevision':1,'promptId':prompt,'note':'User allowed this exact bounded fixture action','disposition':'allow','action':'inspect coordination fixture'})
   task=tool('deck_delegate',{'agent':'apply-deep','task':'Run coordination member fixture','dependsOn':[decision],'action':'inspect coordination fixture','findings':{'items':[{'id':'FIXTURE-Q1','state':'open','text':'Fixture result needs Lead review'}]}})['taskId']
   (root/'coordination-task').write_text(task)
   waited=tool('deck_task_wait',{'taskIds':[task],'timeoutSec':50})
   assert not waited['timedOut'],waited
   (root/'coordination-wait').write_text(json.dumps(waited))
  if member and 'Run coordination member fixture' in text:
   for label in ['denied','allowed']:
    action={'recipient':label+'@example.test','body':'Fixture '+label,'token':'fixture-secret-never-display'}
    response=tool('deck_approve',{'tool_name':'send_message','input':action,'tool_use_id':'fixture-'+label})
    assert response['behavior']==('deny' if label=='denied' else 'allow'),response
    if response['behavior']=='allow':
     assert response['updatedInput']==action
     (root/'relay-effect').write_text(json.dumps(response['updatedInput']))
  if 'Host task outcome' in text and (root/'coordination-task').exists():
   task=(root/'coordination-task').read_text();report=tool('deck_task_result',{'taskId':task,'attempt':1})
   tool('deck_task_integrate',{'taskId':task,'attempt':1,'commandId':'coordination-integrate','state':'integrated','note':'Exact report reviewed','evidenceSeqs':report['evidenceSeqs'],'findingResolutions':[{'taskId':task,'findingId':'FIXTURE-Q1','state':'resolved','reason':'Lead inspected exact fixture report','evidenceSeqs':report['evidenceSeqs']}]})
  if 'Synthetic MCP ' in text:
   second='Synthetic MCP second' in text
   pending_mcp={'recipient':'beta@example.test' if second else 'alpha@example.test','body':'Second synthetic payload' if second else 'First synthetic payload','token':'fixture-secret-never-display'}
   params={'threadId':thread,'turnId':turn,'serverName':'synthetic-mail','toolName':'send_message','message':'Allow the synthetic-mail MCP server to run tool "send_message"?','mode':'form','requestedSchema':{'type':'object','properties':{}},'_meta':{'codex_approval_kind':'mcp_tool_call','tool_params':pending_mcp}}
   scenario=root/'mcp-approval-scenario'
   if scenario.exists():
    case=scenario.read_text()
    if case=='removed':
     (root/'native-config.json').write_text(json.dumps({'synthetic-mail':{'command':'/fixture/mail','enabled_tools':['read_message']}}))
    elif case=='missing':
     params.pop('toolName')
     params['message']='Approval requested'
    elif case=='ambiguous':
     params['_meta']['tool_name']='read_message'
    elif case=='ambiguous-server':
     params['message']='Allow the other-source MCP server to run tool "send_message"?'
    elif case=='canonical-message':
     params.pop('toolName')
   out({'id':81,'method':'mcpServer/elicitation/request','params':params})
   continue
  if 'Delegate freshness member' in text:
   delegated=tool('deck_delegate',{'agent':'apply-deep','task':'Fresh graph offline_handler'})
   (root/'delegated-task').write_text(delegated['taskId'])
  if 'Delegate fixture' in text:
   delegated=mcp('tools/call',{'name':'deck_delegate','arguments':{'agent':next((name for name in ['apply-deep','apply-fast','architect','setup','quality'] if ('Delegate fixture '+name+' ') in text), 'investigate'),'task':'Return a bounded fixture member report.'}})['result']
   assert not delegated['isError'],delegated
   (root/'delegated-task').write_text(json.loads(delegated['content'][0]['text'])['taskId'])
  if not (root/'waiting-fixture').exists() and not (root/'coordination-task').exists() and ('Retrieve fixture' in text or 'Host task outcome' in text):
   task=(root/'delegated-task').read_text()
   attempt=2 if (root/'mixed-continuation').exists() and (root/'mixed-continuation').read_text()==task else 1
   retrieved=mcp('tools/call',{'name':'deck_task_result','arguments':{'taskId':task,'attempt':attempt}})['result']
   assert not retrieved['isError'],retrieved
   retrieved=json.loads(retrieved['content'][0]['text'])
   integrated=mcp('tools/call',{'name':'deck_task_integrate','arguments':{'taskId':task,'attempt':attempt,'commandId':'fixture-integration-command-'+task+('-'+str(attempt) if attempt>1 else ''),'state':'integrated','note':'Fixture report inspected','evidenceSeqs':retrieved['evidenceSeqs']}})['result']
   assert not integrated['isError'],integrated
  if 'Native command' in text:
   out({'id':80,'method':'item/commandExecution/requestApproval','params':{'threadId':thread,'turnId':turn,'itemId':'command-item','command':'write native-created.txt','cwd':str(root)}})
   continue
  history=mcp('tools/call',{'name':'deck_session_history','arguments':{}})
  assert history['result']['isError'] is False
  out({'method':'item/agentMessage/delta','params':{'threadId':thread,'turnId':turn,'delta':'Connected reply'}})
  out({'method':'turn/completed','params':{'threadId':thread,'turn':{'id':turn,'status':'completed'}}})
