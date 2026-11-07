import {expect,test} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {startDaemon} from '../daemon';
import {ControlClient} from '../control-client';
import {resolveStatePaths} from '../paths';
// Protects the default production composition; no injected DictationService or real user daemon.
test('daemon web composition exposes the local model catalog without acquisition',async()=>{
 const root=mkdtempSync('/tmp/deck-dictation-daemon-'),paths=resolveStatePaths({env:{XDG_STATE_HOME:join(root,'state')}});
 const result=await startDaemon({paths,version:'test',anchorCommand:['unused'],recoverOnStart:false,idleShutdown:false,web:{config:{port:0,trustedProxy:null,allowedOrigins:[],allowFunnel:false},autoStart:false}});
 if(!result.ok)throw Error('daemon unavailable');const client=await ControlClient.connect(paths.socket.path);
 try{await client.hello('test');const enabled=await client.query('web.enable') as any;expect(enabled.ok).toBe(true);const paired=await client.query('web.pair') as any;const url=paired.data.url as string,base=new URL(url).origin;
  const pair=await fetch(base+'/pair',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(url).hash.slice(6),name:'composition-test'})});expect(pair.status).toBe(200);
  const response=await fetch(base+'/api/dictation',{headers:{Cookie:pair.headers.get('set-cookie')!.split(';')[0]!}});expect(response.status).toBe(200);const summary=await response.json();expect(summary.models).toHaveLength(1);expect(summary.models.every((m:any)=>m.state==='absent')).toBe(true);expect(summary.selected).toBeNull();
 }finally{client.close();await result.daemon.stop('test');rmSync(root,{recursive:true,force:true});}
});
