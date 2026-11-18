#!/usr/bin/env python3
"""Owned deterministic native boundary; never launches a model or external tool."""
import json,sys,pathlib,os,time,subprocess,threading
root=pathlib.Path(__file__).parent
mode=(root/'mode').read_text()
if '--version' in sys.argv:
 if mode.startswith('probe-'):
  child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'])
  (root/'probe-pids').write_text(str(os.getpid())+' '+str(child.pid))
  if mode in ['probe-flood','probe-stderr']:
   while True: os.write(2 if mode=='probe-stderr' else 1,b'x'*4096)
  time.sleep(60)
 print('codex-cli '+('0.1.0' if mode=='version' else '0.166.0'));sys.exit()
assert '--stdio' in sys.argv
assert 'hooks' in sys.argv and 'plugins' in sys.argv and 'plugin_hooks' in sys.argv
assert 'sandbox_mode="read-only"' in sys.argv
features={sys.argv[i+1]:a=='--enable' for i,a in enumerate(sys.argv[:-1]) if a in ['--disable','--enable']}
def out(v):print(json.dumps(v),flush=True)
def result(req,v):out({'id':req['id'],'result':v})
for line in sys.stdin:
 req=json.loads(line);m=req.get('method','');p=req.get('params',{})
 if not m and req.get('id')==80:
  with (root/'responses').open('a') as f:f.write(json.dumps(req)+'\n')
  if mode=='edit-disconnect':sys.exit(0)
  if mode=='edit-question':
   out({'method':'turn/completed','params':{'threadId':'native-thread','turn':{'id':'native-turn','status':'completed'}}});continue
  allowed=req.get('result',{}).get('decision')=='accept'
  if allowed:target.write_text('after\n')
  if mode=='edit-missing':target.unlink()
  if mode!='edit-no-result':out({'method':'item/completed','params':{'threadId':'native-thread','turnId':'native-turn','item':{'id':'file-item','type':'fileChange','status':'completed' if allowed else 'declined','changes':changes}}})
  out({'method':'turn/completed','params':{'threadId':'native-thread','turn':{'id':'native-turn','status':'completed'}}})
  continue
 if m=='initialize':result(req,{'userAgent':'deck2/0.1.0 (fake)' if mode=='protocol' else 'deck2/0.166.0 (fake)'})
 elif m=='initialized':pass
 elif m=='account/read':
  if mode=='stream':
   while not (root/'allow-prepare').exists(): time.sleep(.01)
  result(req,{'account':None if mode=='auth' else {'type':'chatgpt'}})
 elif m=='model/list':result(req,{'data':[{'model':'gpt-6.1-sol','supportedReasoningEfforts':[{'reasoningEffort':'high'}]}],'nextCursor':None})
 elif m=='environment/status':result(req,{'status':'ready'})
 elif m=='config/read':result(req,{'config':{'agents':{'enabled':'agents.enabled=false' not in sys.argv},'features':features,'notify':[],'mcp_servers':{'inherited-writer':{'command':'must-never-run'}}}})
 elif m in ['thread/start','thread/resume']:
  assert p['config']['mcp_servers']['inherited-writer']['enabled'] is False
  assert p['permissions']==':read-only' and p['approvalPolicy']==('on-request' if mode.startswith('edit') else 'never')
  project=p['cwd']
  assert p['environments']==[{'environmentId':'local','cwd':p['cwd']}] and (m=='thread/resume' or isinstance(p['ephemeral'],bool))
  assert 'Code Economy' in p['developerInstructions']
  result(req,{'thread':{'id':'native-thread'},'activePermissionProfile':{'id':':read-only'},'sandbox':{'type':'readOnly','networkAccess':mode=='unsafe'},'approvalPolicy':p['approvalPolicy'],'approvalsReviewer':'user','cwd':p['cwd'],'model':p.get('model','fixture-model')})
 elif m=='mcpServerStatus/list':result(req,{'data':[{'runtimeStatus':'connected','tools':{}}] if mode=='mcp' else [],'nextCursor':None})
 elif m=='turn/start':
  assert p['permissions']==':read-only'
  with (root/'dispatches').open('a') as f:f.write('dispatch\n')
  if mode=='lost-ack':sys.exit(0)
  if mode=='early':out({'method':'item/agentMessage/delta','params':{'threadId':'native-thread','delta':'early output'}})
  result(req,{'turn':{'id':'native-turn'}})
  if mode=='edit-question':
   out({'id':80,'method':'item/tool/requestUserInput','params':{'threadId':'native-thread','turnId':'native-turn','itemId':'question-item','questions':[{'id':'word','header':'Word','question':'Which word?','options':[]}]}})
  elif mode.startswith('edit'):
   target=pathlib.Path(project)/'example.txt'
   changes=[{'path':str(target),'kind':{'type':'update','move_path':None},'diff':'@@ -1 +1 @@\n-before\n+after\n'}]
   out({'method':'item/started','params':{'threadId':'native-thread','turnId':'native-turn','item':{'id':'file-item','type':'fileChange','changes':changes}}})
   out({'id':80,'method':'item/fileChange/requestApproval','params':{'threadId':'native-thread','turnId':'native-turn','itemId':'file-item','grantRoot':None}})
  elif mode=='malformed':print('{bad json',flush=True)
  elif mode=='request':out({'id':80,'method':'item/commandExecution/requestApproval','params':{}})
  elif mode=='images':
   import hashlib
   images=[v for v in p['input'] if v['type']=='localImage']
   assert images,'image parts must reach default native composition'
   records=[]
   for image in images:
    data=pathlib.Path(image['path']).read_bytes()
    assert data.startswith(b'\x89PNG\r\n\x1a\n')
    records.append({'digest':hashlib.sha256(data).hexdigest(),'size':len(data)})
   with (root/'image-dispatches').open('a') as f:f.write(json.dumps(records)+'\n')
   out({'method':'item/agentMessage/delta','params':{'threadId':'native-thread','delta':'Image parts received by native fixture.'}})
   out({'method':'turn/completed','params':{'threadId':'native-thread','turn':{'id':'native-turn','status':'completed'}}})
  elif mode=='stream':
   def stream():
    for i in range(40):
     out({'method':'item/agentMessage/delta','params':{'threadId':'native-thread','delta':'stream-'+str(i)+' '}})
     time.sleep(.3)
   threading.Thread(target=stream,daemon=True).start()
  elif mode=='format':
   out({'method':'item/agentMessage/delta','params':{'threadId':'native-thread','delta':(root/'fixture.md').read_text()}})
   out({'method':'turn/completed','params':{'threadId':'native-thread','turn':{'id':'native-turn','status':'completed'}}})
  elif mode=='split':
   wire=json.dumps({'method':'item/agentMessage/delta','params':{'threadId':'native-thread','delta':'split output'}})
   prefix=wire[:40];suffix=wire[40:]
   sys.stdout.write(prefix);sys.stdout.flush()
   (root/'partial-written').write_text('ready')
  elif mode!='hold':
   out({'method':'item/agentMessage/delta','params':{'threadId':'native-thread','delta':'Real boundary output'}})
   out({'method':'turn/completed','params':{'threadId':'native-thread','turn':{'id':'wrong-turn' if mode=='wrong-turn' else 'native-turn','status':'failed' if mode=='failed' else 'completed'}}})
 elif m=='turn/interrupt':
  if mode=='split':sys.stdout.write(suffix+'\n');sys.stdout.flush()
  out({'method':'turn/completed','params':{'threadId':'native-thread','turn':{'id':'native-turn','status':'interrupted'}}})
  result(req,{})
