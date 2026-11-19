#!/usr/bin/env python3
"""Owned packaged CLI check: reopening state preserves the browser draft origin."""
import json,subprocess,tempfile,time,signal,os
from pathlib import Path
root=Path(tempfile.mkdtemp(prefix='deck2-session-origin-'));project=root/'project';project.mkdir();state=root/'state'
binary=Path(os.environ.get('DECK2_BINARY',Path(__file__).resolve().parents[1]/'dist/deck2'))
def launch():
 p=subprocess.Popen([str(binary),'serve','--foreground','--project',str(project),'--state-dir',str(state),'--codex','/missing','--no-open'],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 deadline=time.monotonic()+10
 while time.monotonic()<deadline:
  try:
   record=json.loads((state/'launcher.json').read_text())
   if record['admin']!=previous:return p,record
  except (FileNotFoundError,ValueError):pass
  if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
  time.sleep(.05)
 p.kill();p.wait();raise TimeoutError('startup')
previous='';p,first=launch();p.send_signal(signal.SIGINT);p.wait(timeout=10)
previous=first['admin'];p,second=launch()
try:assert first['host']==second['host'],'Restart changed browser origin; session drafts are no longer reachable'
finally:p.send_signal(signal.SIGINT);p.wait(timeout=10)
print('PASS: same state reuses browser origin; no model dispatch')
