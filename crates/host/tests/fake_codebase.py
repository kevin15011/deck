#!/usr/bin/env python3
"""External MCP edge for deterministic freshness races; no host logic is mocked."""
import json, os, sys, pathlib, re, time
root=pathlib.Path(os.environ['FIXTURE_ROOT'])
# Supported backend: an empty configured cache falls back to the home cache.
cache=pathlib.Path(os.environ.get('CBM_CACHE_DIR') or str(pathlib.Path(os.environ['HOME'])/'.cache/codebase-memory-mcp'))
failure=os.environ.get('FIXTURE_FAILURE')
if failure:
 ready,notify=os.pipe()
 child=os.fork()
 if child==0:
  os.close(ready);os.write(notify,b'ready');os.close(notify)
  while True:time.sleep(60)
 os.close(notify);os.read(ready,5);os.close(ready)
 (cache/'owned-pids').write_text(json.dumps([os.getpid(),child]))
def write(v):print(json.dumps(v),flush=True)
def result(v):return {'content':[{'type':'text','text':json.dumps(v)}],'structuredContent':v}
def name(path):
 text=''.join(chr(b) if chr(b).isascii() and (chr(b).isalnum() or chr(b) in '._-') else format(b,'02x') if b>=128 else '-' for b in str(path).encode());return re.sub(r'\.+','.',re.sub('-+','-',text)).lstrip('-.').rstrip('-')
for line in sys.stdin:
 v=json.loads(line);m=v.get('method');p=v.get('params',{});r={}
 if failure==m:
  write({'jsonrpc':'2.0','id':v['id'],'error':{'code':-32603,'message':'synthetic startup fault'}});continue
 if m=='initialize' and failure in ['protocol','version']:
  write({'jsonrpc':'2.0','id':v['id'],'result':{'protocolVersion':'invalid' if failure=='protocol' else '2025-11-25','serverInfo':{'version':'test'} if failure!='version' else {}}});continue
 if m=='tools/list' and failure=='inventory-shape':
  write({'jsonrpc':'2.0','id':v['id'],'result':{}});continue
 if m=='initialize':r={'protocolVersion':'2025-11-25','serverInfo':{'version':'0.12.1'}}
 elif m=='tools/list':r={'tools':[{'name':n,'inputSchema':{'type':'object','properties':{}}} for n in ['search_graph','index_status','list_projects','index_repository','delete_project']]}
 elif m=='tools/call':
  tool=p['name'];args=p.get('arguments',{})
  if tool=='index_status':
   if not (cache/'existing').exists():r={'isError':True,'content':[{'type':'text','text':'missing'}]}
   else:r=result({'project':name(root),'root_path':str(root)+'/foreign' if (root/'foreign').exists() else str(root),'status':'ready','indexed_at':'generation-'+str((cache/'effects').stat().st_size if (cache/'effects').exists() else 0),'watch':{'watched':True}})
  elif tool=='index_repository' and args.get('status'):r=result({'project':name(root),'state':'idle'})
  elif tool=='index_repository':
   with (cache/'effects').open('a') as f:f.write('refresh\n')
   while (root/'refresh-gate').exists():time.sleep(.005)
   graph=[{'name':n,'file_path':str(f.relative_to(root))} for f in root.glob('*.rs') for n in re.findall(r'fn (\w+)',f.read_text())]
   (cache/'graph.json').write_text(json.dumps(graph))
   if (root/'refresh-change').exists():
    (root/'refresh-change').unlink();(root/'handler.rs').write_text('fn changed_during_refresh() {}\n')
   r=result({'indexed':True})
  elif tool=='search_graph':
   if (root/'query-gate').exists():
    (root/'query-started').write_text('started')
    while (root/'query-gate').exists():time.sleep(.005)
   graph=json.loads((cache/'graph.json').read_text());r=result({'nodes':[n for n in graph if re.search(args.get('name_pattern','.*'),n['name'])]})
   if (root/'query-change').exists():
    (root/'query-change').unlink();(root/'handler.rs').write_text('fn changed_during_query() {}\n')
  else:r=result({})
 if 'id' in v:write({'jsonrpc':'2.0','id':v['id'],'result':r})
