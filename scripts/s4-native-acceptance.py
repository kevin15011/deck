#!/usr/bin/env python3
"""Owned fixture: actual production host, real Codex/OpenCode, no installed host use."""
import json,os,pathlib,re,signal,subprocess,tempfile,time,urllib.request,http.cookiejar,sys
base=pathlib.Path(__file__).resolve().parent.parent
root=pathlib.Path(tempfile.mkdtemp(prefix='journey-',dir=base/'target/s4-verification'))
project=root/'project';project.mkdir();(project/'queue.rs').write_text('pub fn cancel_waiting(is_queued: bool) -> bool { is_queued }\npub fn dispatch(cancelled: bool) -> bool { !cancelled }\n')
state=root/'state';state.mkdir(mode=0o700)
log=(root/'host.log').open('w+')
binary=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else base/'target/debug/deck2'
p=subprocess.Popen([str(binary),'serve','--project',str(project),'--state-dir',str(state),'--no-open','--codex','/home/kevin15011/.local/bin/codex','--opencode','/home/kevin15011/.opencode/bin/opencode','--investigator-model','minimax-coding-plan/MiniMax-M2.7'],stdout=log,stderr=log,start_new_session=True)
result={'binary':str(binary),'root':str(root)}
try:
 for _ in range(300):
  if (state/'launcher.json').exists() and 'Investigator' in (root/'host.log').read_text(errors='replace'): break
  if p.poll() is not None: raise RuntimeError('host exited')
  time.sleep(.1)
 else: raise RuntimeError('host startup deadline')
 launch=json.loads((state/'launcher.json').read_text());url='http://'+launch['host']
 cookies=http.cookiejar.CookieJar();http=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
 def request(path,body=None,raw=False):
  data=(body.encode() if raw else json.dumps(body).encode()) if body is not None else None
  req=urllib.request.Request(url+path,data=data,headers={'Origin':url,'Content-Type':'text/plain' if raw else 'application/json'})
  with http.open(req,timeout=20) as r: return json.loads(r.read() or 'null')
 capability=request('/launch',launch['admin'],True)['url'].split('#')[1];request('/auth',capability,True)
 w=request('/api/workspace');result['team_availability']=w['team_availability']
 if w['team_availability']:raise RuntimeError(w['team_availability'])
 prompt='Use deck_delegate to ask the OpenCode investigator to trace queue.rs and explain cancellation vs dispatch. Scope exactly ["queue.rs"]. Acceptance: cite both functions and identify one limitation. Retrieve the exact attempt until terminal; then explicitly treat the exact report digest as followup_required, with a reason. Use deck_task_followup for the SAME task and owner asking whether false cancellation permits dispatch; retrieve the new exact attempt and treat its report as adopted with a reason. Do not use any native tools; use only the five deck tools. Wait for both real reports. Finish by summarizing evidence and limitations. Do not claim independent verification.'
 start=time.monotonic();r=request('/api/commands',{'api':w['api'],'id':'s4-real-team-journey','session':w['session'],'prompt':prompt,'mode':'team','fresh':True,'queue':False});result['admission_ms']=round((time.monotonic()-start)*1000)
 for _ in range(1800):
  w=request('/api/workspace');r=next(x for x in w['receipts'] if x['id']=='s4-real-team-journey')
  if not r['phase'] in ['accepted','preparing','dispatching','running','cancelling']:break
  time.sleep(.2)
 else: raise RuntimeError('journey deadline')
 result['receipt']=r;result['tasks']=w['tasks'];result['elapsed_ms']=round((time.monotonic()-start)*1000)
 if r['phase']!='completed':raise RuntimeError('root did not complete: '+r['detail'])
 if not w['tasks'] or len(w['tasks'][0]['attempts'])!=2 or any(a['phase']!='completed' or not a['treatments'] for a in w['tasks'][0]['attempts']):raise RuntimeError('exact report/followup treatment incomplete')
 result['passed']=True
except Exception as e:result['error']=str(e)
finally:
 try:os.killpg(p.pid,signal.SIGTERM)
 except ProcessLookupError:pass
 try:p.wait(timeout=10)
 except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=5)
 log.close();result['exit']=p.returncode
 # No launch tokens, headers, account content, or raw native errors are exported.
 (base/'target/s4-verification/native-journey.json').write_text(json.dumps(result,indent=2))
 print(json.dumps({k:v for k,v in result.items() if k not in ['receipt','tasks']},indent=2))
 if not result.get('passed'):sys.exit(1)
