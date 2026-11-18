// Read-only qualification of default production composition with an existing Deck1 model.
// All host writes and the external engine fake are confined to a disposable HOME.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),crypto=require('crypto'),{spawn}=require('child_process');
const binary=path.resolve(process.argv[2]||'dist/deck2'),state=process.env.DECK2_TEST_SOURCE_STATE;
if(!state||!path.isAbsolute(state))throw Error('Set DECK2_TEST_SOURCE_STATE to an existing absolute Deck1 XDG state root; no model is copied or downloaded');
const out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/dictation-compat/packaged');fs.mkdirSync(out,{recursive:true});
const source=path.join(state,'deck/dictation'),model=path.join(source,'models/ggml-large-v3-turbo-q5_0.bin'),settings=path.join(source,'settings.json');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),identity=p=>{const s=fs.statSync(p);return {dev:s.dev,ino:s.ino,size:s.size,mode:s.mode,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs}};
const before={model:identity(model),settings:hash(settings),entries:fs.readdirSync(source).sort()};assert.equal(before.model.size,574041195);const preferences=JSON.parse(fs.readFileSync(settings));assert.equal(preferences.selected,'large-v3-turbo-q5_0');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-dictation-compat-'));let host;const wait=ms=>new Promise(r=>setTimeout(r,ms));const started=performance.now(),result={passed:false,binarySha256:hash(binary),modelCopied:false,engine:'fake external process; real model verification and HTTP/default composition',checks:[]};
async function start(isolated){
 const owned=path.join(root,'home/.local/share/deck2-managed-v1/dictation');fs.mkdirSync(path.join(owned,'models'),{recursive:true,mode:0o700});fs.writeFileSync(path.join(owned,'models/ggml-large-v3-turbo-q5_0.bin'),'obsolete',{mode:0o600});fs.writeFileSync(path.join(owned,'settings.json'),JSON.stringify({selected:null,language:'auto'}),{mode:0o600});
 const project=path.join(root,'project');fs.mkdirSync(project,{recursive:true});const hostState=path.join(root,isolated?'isolated-state':'state');
 host=spawn(binary,['serve','--project',project,'--state-dir',hostState,'--no-open','--codex',path.join(root,'missing-codex'),...(isolated?['--artifact-store',path.join(root,'isolated')]:[])],{stdio:'ignore',env:{...process.env,HOME:path.join(root,'home'),XDG_STATE_HOME:state,CODEX_HOME:path.join(root,'native'),DECK_WHISPER_CLI:path.join(root,'whisper-cli')}});
 for(let i=0;i<200&&!fs.existsSync(path.join(hostState,'launcher.json'));i++)await wait(50);
 const launcher=JSON.parse(fs.readFileSync(path.join(hostState,'launcher.json'))),base='http://'+launcher.host,link=await(await fetch(base+'/launch',{method:'POST',body:launcher.admin})).json();
 const auth=await fetch(base+'/auth',{method:'POST',headers:{Origin:base},body:new URL(link.url).hash.slice(1)});assert.equal(auth.status,204);const cookie=auth.headers.get('set-cookie').split(';')[0];
 const call=async(route,method='GET',body,kind='application/json')=>{const response=await fetch(base+'/api/dictation'+route,{method,headers:{Cookie:cookie,Origin:base,'Content-Type':kind},body,signal:AbortSignal.timeout(30000)});return {status:response.status,value:await response.json()}};
 return {call,owned};
}
async function stop(){if(!host)return;host.kill('SIGINT');await Promise.race([new Promise(r=>host.once('exit',r)),wait(5000)]);assert.notEqual(host.exitCode,null,'Fixture host must settle');host=undefined;}
(async()=>{try{
 fs.writeFileSync(path.join(root,'whisper-cli'),`#!/usr/bin/python3
import sys,json,pathlib,os
if '-h' in sys.argv:
 print('-m -f -l -t -nt -np -mc -sns -oj -of');sys.exit(0)
m=pathlib.Path(sys.argv[sys.argv.index('-m')+1]);s=m.stat()
pathlib.Path(__file__).with_name('observed.json').write_text(json.dumps({'ino':s.st_ino,'dev':s.st_dev,'bytes':s.st_size,'language':sys.argv[sys.argv.index('-l')+1]}))
pathlib.Path(sys.argv[sys.argv.index('-of')+1]+'.json').write_text(json.dumps({'transcription':[{'text':'fixture transcript'}]}))
`,{mode:0o700});
 const {call,owned}=await start(false);let r=await call('');assert.equal(r.status,200);assert.equal(r.value.available,true);assert.equal(r.value.language,preferences.language);assert.equal(r.value.models[0].source,'deck1');
 const wav=Buffer.alloc(44+32000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
 r=await call('/transcriptions','POST',wav,'audio/wav');assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.value.text,'fixture transcript');
 const observed=JSON.parse(fs.readFileSync(path.join(root,'observed.json')));assert.deepEqual(observed,{ino:before.model.ino,dev:before.model.dev,bytes:before.model.size,language:preferences.language});assert.deepEqual(fs.readdirSync(path.join(owned,'tmp')),[]);
 assert.equal((await call('/models/large-v3-turbo-q5_0','DELETE')).value.code,'dictation-model-source-owned');
 assert.equal((await call('/settings','PUT',JSON.stringify({language:'en'}))).status,200);assert.equal((await call('')).value.language,'en');
 assert.equal(fs.readFileSync(path.join(owned,'models/ggml-large-v3-turbo-q5_0.bin'),'utf8'),'obsolete');assert.equal(fs.readdirSync(path.join(owned,'models')).length,1);
 result.checks.push('Default artifact-root composition verifies existing Deck1 model, ignores obsolete Deck2 model/preferences, passes the same inode and inherited language to native edge, cleans owned audio, saves explicit preferences, refuses source deletion');await stop();
 const isolated=await start(true);r=await isolated.call('');assert.equal(r.status,200);assert.equal(r.value.available,false);assert.equal(r.value.models[0].state,'absent');result.checks.push('Explicit artifact store remains isolated despite an available Deck1 model');await stop();
 assert.deepEqual(identity(model),before.model);assert.equal(hash(settings),before.settings);assert.deepEqual(fs.readdirSync(source).sort(),before.entries);result.checks.push('Source model identity, settings bytes and directory entries unchanged');result.passed=true;
 }finally{await stop();fs.rmSync(root,{recursive:true,force:true});result.duration_s=(performance.now()-started)/1000;result.cleanup='Only disposable HOME, process and audio state removed';fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}})().catch(e=>{console.error(e);process.exitCode=1});
