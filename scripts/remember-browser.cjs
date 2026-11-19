/* Protects opt-in, browser/host restart continuity and server-side revocation at
 * the production HTTP boundary. All profiles, state and runner effects are disposable. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const {spawn,execFile}=require('node:child_process');
const run=require('node:util').promisify(execFile);
const {chromium}=require('playwright');
const binary=path.resolve(process.argv[2]||'target/debug/deck2');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-remember-'));
const state=path.join(root,'state');
const env={...process.env,HOME:root,XDG_CONFIG_HOME:path.join(root,'config'),XDG_STATE_HOME:path.join(root,'xdg'),CODEX_HOME:path.join(root,'codex')};
const project=path.join(root,'project');
const fake=path.join(root,'fake-codex');
fs.copyFileSync(path.resolve(__dirname,'../crates/host/tests/fake_native.py'),fake);
fs.chmodSync(fake,0o700);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let host,base,profile;
fs.mkdirSync(project);

async function start(){
 host=spawn(binary,['serve','--foreground','--no-open','--no-history','--project',project,'--state-dir',state,'--codex',fake],{env,stdio:'ignore'});
 for(let i=0;i<250;i++){
  try{
   const record=JSON.parse(fs.readFileSync(path.join(state,'launcher.json')));
   const address='http://'+record.host;
   const response=await fetch(address+'/manifest.webmanifest');
   if(response.ok){
    if(base)assert.equal(address,base);
    base=address;
    return;
   }
  }catch(error){if(error instanceof assert.AssertionError)throw error;}
  if(host.exitCode!==null)throw Error('Fixture host exited');
  await wait(20);
 }
 throw Error('Fixture host unavailable');
}
async function stop(){
 if(!host||host.exitCode!==null)return;
 const exited=new Promise(resolve=>host.once('exit',resolve));
 host.kill('SIGINT');
 if(!await Promise.race([exited.then(()=>true),wait(3000).then(()=>false)])){
  host.kill('SIGKILL');
  await exited;
 }
}
async function launcher(){
 const {admin}=JSON.parse(fs.readFileSync(path.join(state,'launcher.json')));
 const response=await fetch(base+'/launch',{method:'POST',body:admin});
 assert.equal(response.status,200);
 return (await response.json()).url;
}
async function openProfile(name){
 profile=await chromium.launchPersistentContext(path.join(root,name),{
  ...(process.env.DECK2_CHROMIUM?{executablePath:process.env.DECK2_CHROMIUM}:{channel:'chromium'}),
  headless:true,args:['--no-sandbox'],reducedMotion:'reduce',viewport:{width:1100,height:800}
 });
 profile.setDefaultTimeout(7000);
 return profile.pages()[0];
}
function api(endpoint='/api/workspace',options={}){
 return fetch(base+endpoint,options);
}
function workspaceStatus(headers){
 return new Promise((resolve,reject)=>{
  const request=http.get(base+'/api/workspace',{headers},response=>{
   response.resume();
   resolve(response.statusCode);
  });
  request.on('error',reject);
 });
}
async function until(check,message){
 const deadline=Date.now()+7000;
 while(Date.now()<deadline){
  if(await check())return;
  await wait(100);
 }
 assert.fail(message);
}
async function connected(page){
 await until(async()=>(await page.request.get(base+'/api/workspace')).ok(),'Browser could not open the authorized workspace');
}
async function application(page){
 await page.getByRole('button',{name:'Settings',exact:true}).filter({visible:true}).click();
 await page.getByRole('button',{name:'Application',exact:true}).click();
}
(async()=>{try{
 await start();
 assert.equal((await api()).status,403);
 const status=await api('/api/browser-device');
 assert.equal(status.status,403,'A browser without authority cannot inspect remembered access');
 for(const endpoint of ['/api/browser-device','/api/local-access']){
  const response=await api(endpoint,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({remember:true})});
  assert.equal(response.status,403);
  assert.equal(response.headers.has('set-cookie'),false);
 }
 let page=await openProfile('remembered');
 const launch=await launcher();
 await page.goto(launch);
 await connected(page);
 await page.getByRole('button',{name:'Remember this device',exact:true}).click();
 await until(async()=>(await(await page.request.get(base+'/api/browser-device')).json()).remembered,'Browser did not retain the opted-in credential');
 assert.equal(new URL(page.url()).hash,'');
 const remembered=(await profile.cookies()).find(c=>c.name.startsWith('deck_device_'));
 assert(remembered?.httpOnly&&remembered.sameSite==='Strict');
 assert(remembered.expires>Date.now()/1000+179*86400);
 assert(!await page.evaluate(()=>document.cookie.includes('deck_device_')));
 assert.notEqual(await page.evaluate(()=>Notification.permission),'granted');
 const file=path.join(state,'local-devices.json');
 assert.equal(fs.statSync(file).mode&0o777,0o600);
 assert(!fs.readFileSync(file,'utf8').includes(remembered.value));
 const token=launch.split('#')[1];
 assert.equal((await api('/auth',{method:'POST',headers:{Origin:base},body:token})).status,403);
 const cookie=remembered.name+'='+remembered.value;
 for(const headers of [{Origin:'https://untrusted.invalid'},{Host:new URL(base).host.replace('127.0.0.1','localhost')},{'X-Forwarded-Host':new URL(base).host}]){
  assert.equal(await workspaceStatus({Cookie:cookie,...headers}),403,Object.keys(headers)[0]);
 }
 await profile.close();profile=undefined;
 await stop();await start();
 const manifest=await(await api('/manifest.webmanifest')).json();
 page=await openProfile('remembered');
 await page.goto(base+manifest.start_url);
 await connected(page);
 await application(page);
 await page.getByRole('button',{name:'Forget this device',exact:true}).click();
 await until(async()=>(await page.request.get(base+'/api/workspace')).status()===403,'Forgotten browser still has access');
 assert.equal((await api('/api/workspace',{headers:{Cookie:cookie}})).status,403);
 await profile.close();profile=undefined;
 page=await openProfile('session');
 await page.goto(await launcher());
 await connected(page);
 await page.getByRole('button',{name:'Use this session only',exact:true}).click();
 const sessionCookies=await profile.cookies();
 assert(sessionCookies.every(c=>!c.name.startsWith('deck_device_')));
 assert.equal(sessionCookies.find(c=>c.name.startsWith('deck2_')).expires,-1);
 await stop();await start();
 assert.equal((await page.request.get(base+'/api/workspace')).status(),403);
 await page.goto(await launcher());
 await connected(page);
 await page.getByRole('button',{name:'Use this session only',exact:true}).click();
 await application(page);
 await page.getByRole('button',{name:'Remember this device',exact:true}).click();
 await page.getByRole('button',{name:'Forget this device',exact:true}).waitFor();
 const second=(await profile.cookies()).find(c=>c.name.startsWith('deck_device_'));
 const secondCookie=second.name+'='+second.value;
 const {stdout}=await run(binary,['web','--state-dir',state,'devices'],{env});
 const listed=JSON.parse(stdout).devices;
 assert.equal(listed.length,1);
 assert(!/hash|tailscaleIdentity/.test(stdout));
 const liveRecords=fs.readFileSync(file);
 const expired=JSON.parse(liveRecords);
 expired[0].expiresAt='2000-01-01T00:00:00Z';
 fs.writeFileSync(file,JSON.stringify(expired));
 assert.equal((await api('/api/workspace',{headers:{Cookie:secondCookie}})).status,403);
 fs.writeFileSync(file,liveRecords);
 await run(binary,['web','--state-dir',state,'revoke',listed[0].id],{env});
 assert.equal((await api('/api/workspace',{headers:{Cookie:secondCookie}})).status,403);
 await page.goto(await launcher());
 await connected(page);
 console.log('Passed first-launch opt-in, session-only, settings opt-in, browser/host restart, scope, and revocation.');
}finally{
 try{await profile?.close();}finally{
  await stop();
  fs.rmSync(root,{recursive:true,force:true});
 }
}})().catch(error=>{console.error(error.message, error.stack?.split('\n').find(line=>line.includes(__filename)));process.exitCode=1;});
