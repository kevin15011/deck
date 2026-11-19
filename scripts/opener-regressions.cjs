// Protects packaged opener selection, argument fidelity, timeout and exact-state recovery.
// The opener is the only fake effect. No browser or live-user host is touched.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile),binary=path.resolve(process.argv[2]||'dist/deck2');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-opener-')),state=path.join(root,"state ' $() ` ; space"),bin=path.join(root,'bin'),capture=path.join(root,'capture');
fs.mkdirSync(bin);fs.mkdirSync(path.join(root,'project'));
const fake=path.join(root,'codex');fs.copyFileSync('crates/host/tests/fake_native.py',fake);fs.chmodSync(fake,0o700);fs.writeFileSync(path.join(root,'mode'),'normal');
const host=spawn(binary,['serve','--foreground','--project',path.join(root,'project'),'--state-dir',state,'--codex',fake,'--no-open'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const env={...process.env,PATH:bin,WSL_DISTRO_NAME:'DeckOwnedFixture',DECK2_CAPTURE:capture};
const opener=(name,body)=>fs.writeFileSync(path.join(bin,name),'#!/usr/bin/python3\nimport sys,os,time,json\n'+body,{mode:0o700});
const checks=[];
(async()=>{try{
 for(let i=0;i<100&&!fs.existsSync(path.join(state,'launcher.json'));i++)await wait(100);
 assert(fs.existsSync(path.join(state,'launcher.json')));
 // Missing Linux opener, available WSL opener: predecessor must fail this oracle.
 opener('wslview','with open(os.environ["DECK2_CAPTURE"],"w") as f: json.dump(sys.argv[1:],f)\n');
 await run(binary,['open','--state-dir',state],{env,timeout:7000});
 const args=JSON.parse(fs.readFileSync(capture));assert.equal(args.length,1);assert.match(args[0],/^http:\/\/127\.0\.0\.1:\d+\/#.+$/);
 assert.equal(new URL(args[0]).hash.length,65);checks.push('missing Linux opener selects WSL opener and preserves one fragment argument');
 opener('xdg-open','sys.exit(4)\n');
 let error;try{await run(binary,['open','--state-dir',state],{env,timeout:7000});}catch(e){error=e;}
 assert(error&&error.code===1);assert(!error.stderr.includes(new URL(args[0]).hash.slice(1)));
 // Execute the advertised quoted recovery command to prove path fidelity and no interpolation.
 const command=error.stderr.split('\n').find(l=>l.startsWith('Manual private link: '))?.slice('Manual private link: '.length);
 assert(command,'failure must supply exact executable/state recovery command');
 const printed=await run('/bin/sh',['-c',command],{env,timeout:7000});assert.match(printed.stdout,/^http:\/\/127\.0\.0\.1:\d+\/#.+\n$/);checks.push('failed opener gives executable, safely quoted state and working explicit private fallback');
 opener('xdg-open','with open(os.environ["DECK2_CAPTURE"],"w") as f: json.dump(sys.argv[1:],f)\n');
 await run(binary,['open','--state-dir',state],{env:{...env,WSL_DISTRO_NAME:'',WSL_INTEROP:''},timeout:7000});checks.push('native Linux opener succeeds');
 fs.unlinkSync(path.join(bin,'xdg-open'));
 const linuxEnv={...env};delete linuxEnv.WSL_DISTRO_NAME;delete linuxEnv.WSL_INTEROP;
 error=undefined;try{await run(binary,['open','--state-dir',state],{env:linuxEnv,timeout:7000});}catch(e){error=e;}
 assert(error&&error.code===1);assert.match(error.stderr,/No supported browser opener/);checks.push('missing native opener fails with manual recovery');
 opener('xdg-open','import subprocess\np=subprocess.Popen(["/bin/sleep","30"])\nwith open(os.environ["DECK2_CAPTURE"],"w") as f: f.write(str(p.pid))\ntime.sleep(30)\n');const start=Date.now();error=undefined;
 try{await run(binary,['open','--state-dir',state],{env,timeout:7000});}catch(e){error=e;}
 assert(error&&error.code===1);assert(Date.now()-start<6000);assert.match(error.stderr,/timed out/);const pid=fs.readFileSync(capture,'utf8');if(fs.existsSync('/proc/'+pid+'/stat'))assert.equal(fs.readFileSync('/proc/'+pid+'/stat','utf8').split(' ')[2],'Z','descendant must not remain running');checks.push('hung opener fails within bound');
 const record=JSON.parse(fs.readFileSync(path.join(state,'launcher.json'))),base='http://'+record.host;
 const response=await fetch(base+'/api/workspace');const problem=await response.json();assert.equal(response.status,403);assert(problem.message.includes(state.replaceAll("'","'\\''")));assert(problem.message.includes(binary));checks.push('unauthenticated response selects exact host state');
 host.kill('SIGINT');await new Promise(r=>host.once('exit',r));
 error=undefined;try{await run(binary,['open','--state-dir',state],{env,timeout:7000});}catch(e){error=e;}
 assert(error&&error.code===1);assert.match(error.stderr,/Host is not running/);assert(error.stderr.includes(command));checks.push('stopped custom host reports restart requirement with same exact recovery command');
 console.log(JSON.stringify({passed:true,checks},null,2));
}finally{host.kill('SIGINT');fs.rmSync(capture,{force:true});}})().catch(e=>{console.error(e.message.replace(/http:\/\/127\.0\.0\.1:\d+\/#[^\s]+/g,'[private link redacted]'));process.exitCode=1;});
