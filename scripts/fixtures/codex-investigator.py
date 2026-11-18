#!/usr/bin/python3
"""Native protocol edge only; no network, credentials or updater effects."""
import json,sys,pathlib
base=pathlib.Path(__file__).parent
case=(base/'case').read_text().strip()
if '--version' in sys.argv: print('codex-cli 0.166.0');sys.exit()
features={sys.argv[i+1]:v=='--enable' for i,v in enumerate(sys.argv[:-1]) if v in ['--enable','--disable']}
thread='investigator-thread';turn='investigator-turn';tools=[];step=0

def send(v):print(json.dumps(v),flush=True)
def reply(q,v):send({'id':q['id'],'result':v})
def next_tool():
 global step
 sequence=[('graph_search',{'name_pattern':'handler'}),('read',{'path':'file'}),('read',{'path':'foreign'}),('graph_trace',{'function_name':'handler','direction':'inbound'})]
 if step==len(sequence):
  send({'method':'item/agentMessage/delta','params':{'threadId':thread,'turnId':turn,'delta':'Evidence delivered with scoped fallback.'}})
  send({'method':'turn/completed','params':{'threadId':thread,'turn':{'id':turn,'status':'completed'}}});return
 name,args=sequence[step];step+=1
 send({'id':100+step,'method':'item/tool/call','params':{'threadId':'foreign' if case=='foreign-thread' else thread,'turnId':'foreign' if case=='foreign-turn' else turn,'callId':'repeat' if case=='repeat' else f'call-{step}','tool':name,'arguments':args}})
for line in sys.stdin:
 q=json.loads(line);m=q.get('method','');p=q.get('params',{})
 with (base/'native.jsonl').open('a') as f:f.write(json.dumps(q)+'\n')
 if m=='initialize':reply(q,{'userAgent':'deck2/0.166.0 (protocol fake)'})
 elif m=='initialized':pass
 elif m=='account/read':reply(q,{'account':{'type':'fixture'}})
 elif m=='environment/status':reply(q,{'status':'ready'})
 elif m=='config/read':reply(q,{'config':{'agents':{'enabled':'agents.enabled=false' not in sys.argv},'features':features,'notify':[],'mcp_servers':{}}})
 elif m=='thread/start':
  tools=p['dynamicTools']
  reply(q,{'thread':{'id':thread},'activePermissionProfile':{'id':':read-only'},'sandbox':{'type':'readOnly','networkAccess':False},'approvalPolicy':'never','approvalsReviewer':'user','cwd':p['cwd'],'model':p['model']})
 elif m=='mcpServerStatus/list':reply(q,{'data':[],'nextCursor':None})
 elif m=='turn/start':reply(q,{'turn':{'id':turn}});next_tool()
 elif not m and 'result' in q:next_tool()
