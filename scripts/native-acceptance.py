#!/usr/bin/env python3
"""Opt-in real native acceptance on an owned disposable project. No secrets printed."""
import json,pathlib,tempfile,subprocess,urllib.request,time,signal,sys
repo=pathlib.Path(__file__).resolve().parents[1]
root=pathlib.Path(tempfile.mkdtemp(prefix='deck2-acceptance-'))
project=root/'project';project.mkdir();(project/'example.txt').write_text('Project motto: copper-otter-317. Deck is a local workspace for read-only project conversations.\n')
state=root/'state'
binary=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else repo/'dist/deck2'
p=subprocess.Popen([str(binary),'serve','--project',str(project),'--state-dir',str(state),'--codex','/home/kevin15011/.local/bin/codex','--no-open'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
def request(path,body=None,cookie=None):
 launch=json.loads((state/'launcher.json').read_text());base='http://'+launch['host']
 headers={'Origin':base}
 if cookie:headers['Cookie']=cookie
 if body is not None:
  if isinstance(body,dict):body=json.dumps(body);headers['Content-Type']='application/json'
  body=body.encode()
 res=urllib.request.urlopen(urllib.request.Request(base+path,data=body,headers=headers),timeout=10)
 return res,res.read()
try:
 first=p.stdout.readline();assert 'Deck listening' in first,first
 launch=json.loads((state/'launcher.json').read_text())
 _,body=request('/launch',launch['admin']);url=json.loads(body)['url']
 res,_=request('/auth',url.split('#')[1]);cookie=res.headers['Set-Cookie'].split(';')[0]
 cmd={'api':1,'id':'native-acceptance-command','prompt':'Read example.txt, quote its exact project motto, and explain it in one concise sentence. Do not modify files or use external integrations.'}
 start=time.monotonic();_,body=request('/api/commands',cmd,cookie)
 seen=[]
 while time.monotonic()-start<180:
  _,raw=request('/api/workspace',cookie=cookie);w=json.loads(raw);r=w['receipts'][0]
  if r['phase'] not in seen:seen.append(r['phase']);print('native phase:',r['phase'],flush=True)
  if r['phase'] in ['completed','cancelled','failed','uncertain']:break
  time.sleep(.2)
 else:raise AssertionError('native acceptance timed out')
 # Same ID must return the same receipt without a second dispatch.
 _,raw=request('/api/commands',cmd,cookie);retry=json.loads(raw);assert retry['id']==r['id'] and retry['dispatch_ms']==r['dispatch_ms']
 assert (project/'example.txt').read_text()=='Project motto: copper-otter-317. Deck is a local workspace for read-only project conversations.\n'
 evidence={'project':str(project),'state':str(state),'phases':seen,'duration_s':round(time.monotonic()-start,3),'receipt':r,'file_unchanged':True}
 (repo/'target/native-acceptance.json').write_text(json.dumps(evidence,indent=2))
 print(json.dumps(evidence,indent=2),flush=True)
 assert r['phase']=='completed' and 'copper-otter-317' in r['text'] and r['local_tool_calls']>0,'Native did not demonstrate reading the sample file'
finally:
 p.send_signal(signal.SIGINT)
 try:p.wait(timeout=10)
 except subprocess.TimeoutExpired:p.kill();p.wait()
