// Defense in depth inside an unshare -rn child. No socket is used for eval HTTP.
const Module=require('node:module');const fs=require('node:fs');
const deny=(effect='socket')=>()=>{const start=performance.now();const error=new Error('native_network_effect_blocked');process.send?.({kind:'eval-fence-blocked',effect,durationMs:performance.now()-start});throw error;};
for(const name of ['node:net','node:tls','node:http','node:https','node:dgram','node:http2']){
 const mod=require(name);for(const key of ['connect','createConnection','request','get','createSocket','createServer','createSecureServer'])if(typeof mod[key]==='function')mod[key]=deny(name==='node:http2'?'http2':'socket');
}
require('node:net').Socket.prototype.connect=deny('socket');
require('node:net').Server.prototype.listen=deny('socket');
const dns=require('node:dns');for(const owner of [dns,dns.promises,dns.Resolver?.prototype,dns.promises?.Resolver?.prototype])if(owner)for(const key of Object.getOwnPropertyNames(owner))if(/^(?:lookup|resolve|reverse)/.test(key)&&typeof owner[key]==='function')owner[key]=deny('dns');
const cp=require('node:child_process');
const safeGit=(file,args=[])=>['git','/usr/bin/git','/bin/git'].includes(file)&&/^(?:rev-parse(?: [a-zA-Z0-9_./= -]+)?|remote get-url (?:--all )?origin|config(?: --get)? (?:user\.(?:email|name)|remote\.origin\.url)|worktree list(?: --porcelain)?)$/.test(args.join(' '));
const execSync=cp.execSync,execFileSync=cp.execFileSync,spawnSync=cp.spawnSync;
cp.execSync=(command,options)=>{if(typeof command!=='string'||/[;&|<>$`\r\n]/.test(command)||!command.startsWith('git ')||!safeGit('git',command.slice(4).split(' ')))return deny('child_process')();return execSync(command,options);};
cp.execFileSync=(file,args,options)=>{if(!safeGit(file,args))return deny('child_process')();return execFileSync(file,args,options);};
cp.spawnSync=(file,args,options)=>{if(!safeGit(file,args))return deny('child_process')();return spawnSync(file,args,options);};
for(const key of ['exec','execFile','spawn','fork'])cp[key]=deny('child_process');
Module.syncBuiltinESMExports();
process.send?.({kind:'eval-isolation',netNamespace:fs.readlinkSync('/proc/self/ns/net'),uid:process.getuid(),node:process.version});
let seq=0;const waiting=new Map();
process.on('message',m=>{if(m?.kind!=='eval-http-result')return;const p=waiting.get(m.id);if(!p)return;waiting.delete(m.id);clearTimeout(p.timer);p.cleanup();p.resolve(new Response([204,205].includes(m.status)?null:m.body,{status:m.status,headers:m.headers}));});
globalThis.fetch=async(input,init={})=>{
 const request=new Request(input,init);const url=new URL(request.url);if(url.origin!==process.env.DECK_EVAL_GATEWAY)return deny('origin')();
 const body=await request.text(),id=++seq;
 return new Promise((resolve,reject)=>{
  const cleanup=()=>request.signal.removeEventListener('abort',abort);
  const abort=()=>{waiting.delete(id);clearTimeout(timer);cleanup();process.send?.({kind:'eval-http-abort',id});reject(new DOMException('Native request aborted','AbortError'));};
  const timer=setTimeout(abort,65000);waiting.set(id,{resolve,reject,timer,cleanup});request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted){abort();return;}
  process.send({kind:'eval-http',id,url:request.url,method:request.method,headers:Object.fromEntries(request.headers),body});
 });
};
process.channel?.unref();
