#!/usr/bin/env python3
"""Owned packaged recovery fault: an unfinished native rollout cannot resume implicitly."""
import json,os,signal,sqlite3,subprocess,tempfile,time,urllib.request
from pathlib import Path
repo=Path(__file__).resolve().parents[1];root=Path(tempfile.mkdtemp(prefix='deck2-s3-recovery-'));project=root/'project';project.mkdir();state=root/'state';native=root/'codex';native.write_bytes((repo/'crates/host/tests/fake_native.py').read_bytes());native.chmod(0o700);(root/'mode').write_text('lost-ack');binary=os.environ.get('DECK2_BINARY',str(repo/'dist/deck2'));previous='';p=None

def start():
 global p,previous,base,cookie
 p=subprocess.Popen([binary,'serve','--foreground','--project',str(project),'--state-dir',str(state),'--codex',str(native),'--no-open'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 for _ in range(100):
  try:
   record=json.loads((state/'launcher.json').read_text())
   if record['admin']!=previous:break
  except (FileNotFoundError,ValueError):pass
  time.sleep(.05)
 else:raise TimeoutError('owned host startup')
 previous=record['admin'];base='http://'+record['host'];cookie=''
 token=request('/launch',record['admin'])['url'].split('#')[1]
 req=urllib.request.Request(base+'/auth',data=token.encode(),headers={'Origin':base});res=urllib.request.urlopen(req);cookie=res.headers['Set-Cookie'].split(';')[0]

def request(path,body=None):
 headers={'Origin':base,'Cookie':cookie}
 if body is not None:
  if not isinstance(body,str):body=json.dumps(body);headers['Content-Type']='application/json'
  body=body.encode()
 with urllib.request.urlopen(urllib.request.Request(base+path,data=body,headers=headers),timeout=10) as r:return json.loads(r.read())

def stop():
 if p is not None and p.poll() is None:p.send_signal(signal.SIGINT);p.wait(timeout=10)
def phase(identity,expected):
 for _ in range(200):
  w=request('/api/workspace');r=next(r for r in w['receipts'] if r['id']==identity)
  if r['phase']==expected:return r
  time.sleep(.05)
 raise AssertionError((identity,expected,r))
try:
 start();session=request('/api/workspace')['session']
 request('/api/commands',dict(api=6,session=session,id='lost-ack-command',prompt='fixture',fresh=False));phase('lost-ack-command','uncertain')
 request('/api/commands',dict(api=6,session=session,id='queued-after-recovery',prompt='fixture',queue=True,fresh=False));stop()
 subprocess.run([binary,'recover','--state-dir',str(state),'--confirm-native-stopped'],check=True,stdout=subprocess.DEVNULL)
 with sqlite3.connect(state/'state.db') as c:
  context=json.loads(c.execute('SELECT body FROM sessions WHERE id=?',(session,)).fetchone()[0])['native']
 assert context is None,'Operator recovery retained unfinished native context; continuation could replay its incomplete turn'
 (root/'mode').write_text('normal');start();w=request('/api/workspace');assert w['queue_paused'];assert next(r for r in w['receipts'] if r['id']=='queued-after-recovery')['phase']=='queued'
 request('/api/queue',dict(api=6,paused=False));r=phase('queued-after-recovery','failed');assert r['dispatch_ms'] is None
 assert len((root/'dispatches').read_text().splitlines())==1
 request('/api/commands',dict(api=6,session=session,id='explicit-new-execution',prompt='fixture',fresh=True));phase('explicit-new-execution','completed');assert len((root/'dispatches').read_text().splitlines())==2
 print('PASS: lost ack and operator recovery never replay; unfinished context released; queue paused; explicit new execution required')
finally:stop()
