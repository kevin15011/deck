#!/usr/bin/env python3
"""External native HTTP/process oracle; never contacts a provider."""
import sys,json,os,pathlib,threading,queue,time,base64,socket
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
root=pathlib.Path(__file__).parent
sys.stderr=(root/'fixture-stderr').open('a',buffering=1)
def stage(name):
 with (root/'fixture-stages').open('a') as f:f.write(json.dumps({'time':time.monotonic(),'pid':os.getpid(),'stage':name})+'\n')
stage('start '+repr(sys.argv[1:]))
if '--version' in sys.argv: print('1.19.1');sys.exit()
if sys.argv[1:]==['models','--verbose']:
 for provider,variants in [('a',['deep','fast/native']),('b',['slow'])]:
  print(provider+'/model/revision'); print(json.dumps({'providerID':provider,'variants':{v:{} for v in variants}}))
 sys.exit()
assert sys.argv[1:]==['serve','--hostname','127.0.0.1','--port','0'],sys.argv
config=json.loads(os.environ['OPENCODE_CONFIG_CONTENT']);events=queue.Queue();answers={};changed=threading.Condition();serial=0
if (root/'fail-start').exists():
 (root/'failed-tool-runtime').write_text(config['mcp']['deck-codebase-memory']['environment']['CBM_RUNTIME_DIR'])
 sys.exit(1)

native=pathlib.Path(os.environ['XDG_DATA_HOME'])/'opencode';native.mkdir(parents=True,exist_ok=True)
sessions=native/'fixture-sessions.json'
def log(v):
 with (root/'opencode-wire').open('a') as f: f.write(json.dumps(v)+'\n')
def emit(v):events.put(v)
def mcp(name,args):
 import urllib.request
 spec=config['mcp']['deck'];headers={'Content-Type':'application/json',**spec['headers']}
 request=urllib.request.Request(spec['url'],data=json.dumps({'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':name,'arguments':args}}).encode(),headers=headers)
 return json.load(urllib.request.urlopen(request,timeout=5))
class Handler(BaseHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args):pass
 def reply(self,v,status=200):
  body=json.dumps(v).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def auth(self):
  expected='Basic '+base64.b64encode(('opencode:'+os.environ['OPENCODE_SERVER_PASSWORD']).encode()).decode()
  if self.headers.get('Authorization')!=expected:self.reply({},401);return False
  return True
 def do_GET(self):
  if not self.auth():return
  stage(self.command+' '+self.path)
  if self.path=='/global/health':return self.reply({'healthy':True,'version':'1.19.1'})
  if self.path=='/config':return self.reply(config)
  if self.path=='/mcp':return self.reply({'deck':{'status':'connected'}})
  if self.path=='/agent':
   return self.reply([{'name':name,'prompt':v['prompt'],'permission':[{'permission':'*','pattern':'*','action':'allow'},{'permission':'bash','pattern':'protected*','action':'deny'}]+[{'permission':k,'pattern':'*','action':a} for k,a in v.get('permission',{}).items()]}for name,v in config['agent'].items()])
  if self.path.startswith('/session/'):
   data=json.loads(sessions.read_text()) if sessions.exists() else {}
   return self.reply({'id':self.path.split('/')[-1],'directory':data[self.path.split('/')[-1]]}) if self.path.split('/')[-1] in data else self.reply({},404)
  if self.path=='/event':
   self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers();self.wfile.write(b': connected\n\n');self.wfile.flush()
   try:
    while True:
     try:v=events.get(timeout=1)
     except queue.Empty:self.wfile.write(b': keepalive\n\n');self.wfile.flush();continue
     self.wfile.write(('data: '+json.dumps(v)+'\n\n').encode());self.wfile.flush()
   except (BrokenPipeError,ConnectionResetError):pass
   return
  self.reply({},404)
 def do_PATCH(self):
  if not self.auth():return
  stage(self.command+' '+self.path)
  body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}');log({'path':self.path,'body':body});self.reply({'id':self.path.split('/')[-1],'directory':os.getcwd()})
 def do_POST(self):
  if not self.auth():return
  stage(self.command+' '+self.path)
  global serial
  body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}');log({'path':self.path,'body':body})
  if self.path=='/session':
   data=json.loads(sessions.read_text()) if sessions.exists()else{};sid='ses_opaque_'+str(len(data)+1);data[sid]=os.getcwd();sessions.write_text(json.dumps(data));return self.reply({'id':sid,'directory':os.getcwd()})
  if self.path.startswith('/permission/')or self.path.startswith('/question/'):
   with changed:answers[self.path.split('/')[2]]=body;changed.notify_all()
   return self.reply(True)
  if self.path.endswith('/abort'):
   if (root/'abort-child-pid').exists():
    (root/'abort-entered').touch()
    while True:time.sleep(1)
   return self.reply(True)
  if self.path.endswith('/message'):
   sid=self.path.split('/')[2];mid=body['messageID'];aid='msg_assistant_'+mid
   text='\n'.join(p.get('text','')for p in body['parts']);log({'mcp':mcp('deck_session_history',{})})
   emit({'type':'message.updated','properties':{'info':{'sessionID':sid,'id':aid,'role':'assistant','parentID':mid}}})
   if 'LOST_ACK' in text:self.connection.shutdown(socket.SHUT_RDWR);self.connection.close();return
   if text.rsplit('Current input: ',1)[-1].strip()=='HANG_ABORT':
    import subprocess
    child=subprocess.Popen(['/usr/bin/python3','-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(120)'])
    pending=root/'abort-child-pid.pending'
    pending.write_text(str(child.pid))
    pending.replace(root/'abort-child-pid')
    while True:time.sleep(1)
   if 'NATIVE_PERMISSION' in text:
    pid='per_'+mid;emit({'type':'permission.asked','properties':{'id':pid,'sessionID':sid,'tool':{'messageID':aid,'callID':'call_current'},'permission':'bash','patterns':['protected-file' if 'NATIVE_DENY' in text else 'fixture-command'],'always':['fixture-command']}})
    with changed:
     assert changed.wait_for(lambda:pid in answers,timeout=20),'permission did not settle'
    log({'delivered':answers[pid]})
   if text.rsplit('Current input: ',1)[-1].strip()=='DELEGATE_OPENCODE' and body['agent']=='lead':
    log({'delegate':mcp('deck_delegate',{'agent':'apply-deep','task':'Perform fixture work','acceptance':{'items':[{'id':'A1','text':'Return fixture result'}]}})})
   current=text.rsplit('Current input: ',1)[-1].strip()
   if current.startswith('CONTINUE_MIXED ') and body['agent']=='lead':
    log({'continued':mcp('deck_delegate',{'agent':'apply-deep','continueTaskId':current.split()[1],'task':'Return second fixture report','continuity':'fresh'})})
   report='Connected OpenCode '+body['model']['providerID']+'/'+body['model']['modelID']
   return self.reply({'info':{'sessionID':sid,'id':aid,'role':'assistant','parentID':mid},'parts':[{'sessionID':sid,'messageID':aid,'type':'text','text':report}]})
  self.reply({},404)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=True
print('opencode server listening on http://127.0.0.1:'+str(server.server_port),flush=True)
stage('listening')
server.serve_forever()
