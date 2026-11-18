#!/usr/bin/env python3
"""Explicit protocol fake; FIFO controls the real host's Quality await."""
import json, os, pathlib, sys
home = pathlib.Path(__file__).parent
if '--version' in sys.argv:
    print('codex-cli 0.166.0'); sys.exit()
features = {sys.argv[i+1]: a == '--enable' for i,a in enumerate(sys.argv[:-1]) if a in ['--disable','--enable']}
def emit(v): print(json.dumps(v), flush=True)
def result(q,v): emit({'id':q['id'],'result':v})
def tool(wire, action, **kw):
    emit({'id':wire,'method':'item/tool/call','params':{'threadId':thread,'turnId':'turn','namespace':None,'tool':'deck_change','callId':str(wire),'arguments':{'action':action,'revision':1,**kw}}})
def done(): emit({'method':'turn/completed','params':{'threadId':thread,'turn':{'id':'turn','status':'completed'}}})
for line in sys.stdin:
    q=json.loads(line); m=q.get('method',''); p=q.get('params',{})
    if m=='initialize': result(q,{'userAgent':'deck2/0.166.0 (protocol fake)'})
    elif m=='initialized': pass
    elif m=='account/read': result(q,{'account':{'type':'fixture'}})
    elif m=='environment/status': result(q,{'status':'ready'})
    elif m=='config/read': result(q,{'config':{'agents':{'enabled':'agents.enabled=false' not in sys.argv},'features':features,'notify':[],'mcp_servers':{}}})
    elif m=='thread/start':
        lead='dynamicTools' in p; project=p['cwd']; thread=('lead-' if lead else 'quality-')+str(os.getpid())
        result(q,{'thread':{'id':thread},'activePermissionProfile':{'id':':read-only'},'sandbox':{'type':'readOnly','networkAccess':False},'approvalPolicy':p['approvalPolicy'],'approvalsReviewer':'user','cwd':project,'model':'gpt-6.1-sol'})
    elif m=='mcpServerStatus/list': result(q,{'data':[],'nextCursor':None})
    elif m=='turn/start':
        result(q,{'turn':{'id':'turn'}})
        if lead:
            correction=(home/'lead-first').exists()
            (home/'lead-first').write_text('started')
            tool(100,'inspect')
        else:
            first=not (home/'quality-first').exists()
            if first: (home/'quality-first').write_text('started')
            item={'type':'commandExecution','id':'check','command':"/bin/bash -c '/usr/bin/python3 -I -B checks.py'",'cwd':project}
            emit({'method':'item/started','params':{'threadId':thread,'turnId':'turn','item':item}})
            if first:
                (home/'quality-ready').write_text(thread)
                with (home/'release').open() as barrier: barrier.read(1)
            emit({'method':'item/completed','params':{'threadId':thread,'turnId':'turn','item':{**item,'exitCode':1 if first else 0,'durationMs':1,'status':'completed'}}})
            verdict={'adequate':not first,'findings':[{'id':'failed-case','severity':'major','text':'Fixture failed check'}] if first else [],'resolves':[] if first else json.loads((home/'resolves.json').read_text())}
            emit({'method':'item/agentMessage/delta','params':{'threadId':thread,'turnId':'turn','delta':json.dumps(verdict)}})
            done()
    elif not m:
        with (home/'responses.jsonl').open('a') as f: f.write(json.dumps(q)+'\n')
        if not q.get('result',{}).get('success'): done(); continue
        v=json.loads(q['result']['contentItems'][0]['text'])
        if q['id']==100:
            if correction:
                (home/'resolves.json').write_text(json.dumps([f['id'] for f in v['change']['findings']]))
                tool(101,'artifact',artifact='review.md',body='Queued correction retains scoped Lead authority.\n')
            else: tool(102,'review')
        elif q['id']==101: tool(102,'review')
        elif q['id']==102: tool(103,'treat',review=v['id'],reason='Observed exact fixture report and check outcome')
        elif q['id']==103: tool(104,'complete')
        else: done()
