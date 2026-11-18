#!/usr/bin/env python3
"""Isolated native transport witness. Never records headers, config or credentials."""
import json,os,pathlib,subprocess,sys,threading
root=pathlib.Path(__file__).parent
p=subprocess.Popen([os.environ['DECK2_REAL_CODEX'],*sys.argv[1:]],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
def transmit():
 try:
  for line in sys.stdin.buffer:p.stdin.write(line);p.stdin.flush()
 except (BrokenPipeError,ValueError):pass
 finally:
  try:p.stdin.close()
  except (BrokenPipeError,ValueError):pass
threading.Thread(target=transmit,daemon=True).start()
for line in p.stdout:
 try:
  v=json.loads(line);method=v.get('method','');params=v.get('params',{});item=params.get('item',{})
  evidence=None
  if method in ['item/started','item/completed'] and item.get('type')=='mcpToolCall':
   evidence={'method':method,'type':'mcpToolCall','server':item.get('server'),'tool':item.get('tool'),'status':item.get('status')}
   if item.get('server')=='codebase-memory' and item.get('tool') in ['search_graph','index_status','check_index_coverage']:
    evidence['result']=item.get('result');evidence['error']=item.get('error')
  if method in ['item/started','item/completed'] and item.get('type')=='commandExecution':
   command=item.get('command','')
   if 'git status' in command:evidence={'method':method,'type':'commandExecution','command':command,'output':item.get('aggregatedOutput'),'status':item.get('status'),'exitCode':item.get('exitCode')}
  if method.startswith('hook/') or method.startswith('hooks/'):
   evidence={'method':method,'event':params.get('eventName'),'status':params.get('status')}
  if evidence:
   with (root/'native-witness.jsonl').open('a') as f:f.write(json.dumps(evidence)+'\n')
 except (ValueError,TypeError):pass
 sys.stdout.buffer.write(line);sys.stdout.buffer.flush()
sys.exit(p.wait())
