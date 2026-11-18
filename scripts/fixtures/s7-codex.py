#!/usr/bin/python3
"""Protocol fake. No provider/network/credential operations. Exact-boundary oracle."""
import json,sys,pathlib
base=pathlib.Path(__file__).parent
with (base/'invocations.jsonl').open('a') as f:f.write(json.dumps(sys.argv[1:])+'\n')
case=(base/'case').read_text().strip() if (base/'case').exists() else 'ready'
if sys.argv[1:]==['update','--help']:
 if case=='update-help-timeout':
  import time
  time.sleep(30)
 print('Usage: codex update [OPTIONS]');sys.exit(1 if case=='update-help-failure' else 0)
if '--version' in sys.argv:
 print('codex-cli '+('9.0.0' if case=='version' else '0.166.0'));sys.exit()
features={sys.argv[i+1]:v=='--enable' for i,v in enumerate(sys.argv[:-1]) if v in ['--enable','--disable']}
if case=='restriction': features['hooks']=True
auth=case not in ['missingauth','complete','failure','cancel','race','deadline','malicious']
def send(v):print(json.dumps(v),flush=True)
def reply(q,v):send({'id':q['id'],'result':v})
for line in sys.stdin:
 q=json.loads(line);m=q.get('method','');p=q.get('params',{})
 with (base/'calls.jsonl').open('a') as f:f.write(json.dumps({'method':m,'params':p})+'\n')
 if m=='initialize':reply(q,{'userAgent':'deck2/0.166.0 (explicit protocol fake)'})
 elif m=='initialized':pass
 elif m=='account/read':reply(q,{'account':{'type':'fixture'} if auth else None})
 elif m=='environment/status':reply(q,{'status':'error' if case=='environment' else 'ready'})
 elif m=='config/read':reply(q,{'config':{'agents':{'enabled':'agents.enabled=false' not in sys.argv},'features':features,'notify':[],'mcp_servers':{}}})
 elif m=='model/list':reply(q,{'data':[{'model':'gpt-6.1-sol' if not p.get('cursor') else 'unqualified-model','supportedReasoningEfforts':[]}],'nextCursor':'page2' if not p.get('cursor') else None})
 elif m=='account/login/start':
  result={'type':p['type'],'loginId':'fixture-login','authUrl':'https://auth.openai.com/oauth/authorize?fixture=SECRET-FIXTURE-URL','verificationUrl':'https://auth.openai.com/codex/device','userCode':'FIXTURE-CODE'}
  if case=='malicious':result['verificationUrl']='https://attacker.example/steal';result['authUrl']='http://auth.openai.com/'
  reply(q,result)
  if case in ['complete','failure']:
   send({'method':'account/login/completed','params':{'loginId':'wrong-login','success':True}})
   auth=case=='complete'
   send({'method':'account/login/completed','params':{'loginId':'fixture-login','success':auth,'error':'SECRET-FIXTURE-ERROR'}})
 elif m=='account/login/cancel':auth=case=='race';reply(q,{'status':'notFound' if auth else 'canceled'})
 elif m in ['thread/start','thread/resume']:
  reply(q,{'thread':{'id':p.get('threadId','fixture-thread')},'activePermissionProfile':{'id':':read-only'},'sandbox':{'type':'readOnly','networkAccess':False},'approvalPolicy':p['approvalPolicy'],'approvalsReviewer':'user','cwd':p['cwd'],'model':None if case=='missingmodel' else 'wrong-model' if case=='mismatch' else p.get('model','gpt-6.1-sol')})
 elif m=='mcpServerStatus/list':reply(q,{'data':[],'nextCursor':None})
 elif m=='turn/start':
  reply(q,{'turn':{'id':'fixture-turn'}})
  send({'method':'item/agentMessage/delta','params':{'threadId':'fixture-thread','turnId':'fixture-turn','delta':'Useful fake result'}})
  send({'method':'turn/completed','params':{'threadId':'fixture-thread','turn':{'id':'fixture-turn','status':'completed'}}})
