#!/usr/bin/env python3
"""Actual S8c -> ordinary-v1 migration; predecessor refusal leaves bytes untouched.
Owned fixture only. A queued text command is never dispatched.
"""
import hashlib,json,pathlib,signal,sqlite3,subprocess,tempfile,time,urllib.request
repo=pathlib.Path(__file__).resolve().parents[1];out=repo/'target/ordinary/schema';out.mkdir(parents=True,exist_ok=True)
root=pathlib.Path(tempfile.mkdtemp(prefix='ordinary-schema-',dir=out));project=root/'project';project.mkdir();state=root/'state'
old=repo/'target/review-s8c-d096872c/deck2';new=repo/'dist/deck2';fake=root/'codex';fake.write_bytes((repo/'crates/host/tests/fake_native.py').read_bytes());fake.chmod(0o700);(root/'mode').write_text('normal')
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rows():
 with sqlite3.connect(f'file:{state}/state.db?mode=ro',uri=True) as c:return {t:c.execute(f'SELECT * FROM {t} ORDER BY rowid').fetchall() for t, in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")}
def start(binary,name,ready=True):
 log=(root/(name+'.log')).open('w');prior=(state/'launcher.json').read_bytes() if (state/'launcher.json').exists() else None
 p=subprocess.Popen([str(binary),'serve',*(['--foreground'] if binary == new else []),'--project',str(project),'--state-dir',str(state),'--codex',str(fake),'--no-open'],stdout=log,stderr=log)
 deadline=time.monotonic()+20
 while p.poll() is None and time.monotonic()<deadline:
  if (state/'launcher.json').exists() and (state/'launcher.json').read_bytes()!=prior:break
  time.sleep(.05)
 if ready:assert p.poll() is None and (state/'launcher.json').read_bytes()!=prior,name
 else:assert p.poll() not in [None,0],name
 return p,log
def stop(p,log):
 if p.poll() is None:p.send_signal(signal.SIGINT);p.wait(timeout=10)
 log.close()
def req(base,path,body,cookie=None):
 data=body.encode() if isinstance(body,str) else json.dumps(body).encode();headers={'Origin':base,'Content-Type':'application/json'}
 if cookie:headers['Cookie']=cookie
 return urllib.request.urlopen(urllib.request.Request(base+path,data=data,headers=headers),timeout=10)
result={'old':digest(old),'new':digest(new),'root':str(root)}
p,log=start(old,'old-create')
try:
 launcher=json.loads((state/'launcher.json').read_text());base='http://'+launcher['host'];link=json.load(req(base,'/launch',launcher['admin']))['url'];response=req(base,'/auth',link.split('#')[1]);cookie=response.headers['Set-Cookie'].split(';')[0]
 w=json.load(urllib.request.urlopen(urllib.request.Request(base+'/api/workspace',headers={'Cookie':cookie})))
 r=json.load(req(base,'/api/commands',{'api':7,'id':'legacy-text-command','prompt':'Preserve this text history without dispatch.','session':w['session'],'fresh':True,'queue':True},cookie));assert r['phase']=='queued'
finally:stop(p,log)
original=rows();assert dict(original['meta'])['schema']=='10'
p,log=start(new,'new-migrate');stop(p,log);migrated=rows();assert dict(migrated['meta'])['schema']=='13';assert migrated['receipts']==original['receipts']
for table,values in original.items():
 if table in ['definitions','configurations']:assert all(v in migrated[table] for v in values),table
 elif table!='meta':assert migrated[table]==values,table
before=digest(state/'state.db');p,log=start(old,'old-refusal',False);stop(p,log);assert digest(state/'state.db')==before and rows()==migrated
p,log=start(new,'new-reopen');stop(p,log);assert rows()==migrated
# Unsupported future state must also be rejected read-only by the new binary.
with sqlite3.connect(state/'state.db') as c:c.execute("UPDATE meta SET value='999' WHERE key='schema'")
before=digest(state/'state.db');p,log=start(new,'future-refusal',False);stop(p,log);assert digest(state/'state.db')==before
assert not (root/'dispatches').exists();result.update(passed=True,text_history_byte_preserved=True,old_refusal_byte_preserved=True,future_refusal_byte_preserved=True,no_dispatch=True);(out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
