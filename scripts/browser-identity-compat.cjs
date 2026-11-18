// Oracle: original browser credential, worker, cache, appearance and session URL
// survive a same-origin packaged host replacement. All effects are disposable.
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),http=require('http'),assert=require('assert/strict'),{spawn,spawnSync}=require('child_process'),{chromium}=require('playwright');
const binary=path.resolve(process.argv[2]||'dist/deck2'),out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/browser-identity-compat');fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-identity-')),source=path.join(root,'original'),project=path.join(root,'project'),state=path.join(root,'state'),home=path.join(root,'home'),sid='original-browser-session';
const wait=ms=>new Promise(r=>setTimeout(r,ms)),digest=b=>crypto.createHash('sha256').update(b).digest('hex'),token=crypto.randomBytes(32).toString('base64url'),pid='project-'+digest(project).slice(0,24);
function dir(p){fs.mkdirSync(p,{recursive:true,mode:0o700});}function write(p,v){dir(path.dirname(p));fs.writeFileSync(p,typeof v==='string'?v:JSON.stringify(v),{mode:0o600});}
let host,browser,originalServer,base,logs='';const result={binary:digest(fs.readFileSync(binary)),passed:false,checks:[]},started=performance.now();
(async()=>{try{
 dir(project);dir(home);dir(state);
 write(path.join(source,'projects.json'),{v:1,projects:[{projectId:pid,path:project,name:'Existing project',createdAt:'2026-01-01T00:00:00Z'}]});
 write(path.join(source,'sessions',sid,'session.json'),{v:1,sessionId:sid,projectRoot:project,projectId:pid,title:'Existing browser conversation',createdAt:'2026-01-01T00:00:00Z',members:{lead:{runnerId:'claude-code',modelId:'original-model'}},approvals:'relay'});
 write(path.join(source,'sessions',sid,'events/000001.jsonl'),JSON.stringify({v:1,sessionId:sid,seq:1,ts:'2026-01-01T00:00:00Z',kind:'message.completed',source:{taskId:'lead',memberId:'lead',runnerId:'claude-code',attempt:1},data:{role:'assistant',text:'Original browser history survives replacement.'}})+'\n');
 const records=[{id:'original-device',name:'Existing browser',createdAt:'2026-01-01T00:00:00Z',hash:digest(token),future:{preserved:true}}];
 write(path.join(source,'web/devices.json'),records);write(path.join(source,'web/push.json'),{v:1,keys:{publicKey:'fixture-inert-public',privateKey:'fixture-inert-private'},subscriptions:[{deviceId:'original-device',origin:'https://fixture.invalid',subscription:{endpoint:'https://fixture.invalid/never-send'}}]});write(path.join(source,'web/lead-replies.json'),{v:1,id:'fixture-inert-receipts'});
 // Exact original worker and generated manifest/icons, supplied by canonical sources.
 const oldWorker=fs.readFileSync(path.join(__dirname,'fixtures/original-service-worker.js'));
 const publicDir=path.resolve(__dirname,'../frontend/public');
 originalServer=http.createServer((req,res)=>{const name=new URL(req.url,'http://fixture').pathname.slice(1);if(name==='service-worker.js'){res.setHeader('Content-Type','text/javascript');res.end(oldWorker);}else if(['manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','apple-touch-icon.png'].includes(name)){res.setHeader('Content-Type',name.endsWith('webmanifest')?'application/manifest+json':name.endsWith('svg')?'image/svg+xml':'image/png');res.end(fs.readFileSync(path.join(publicDir,name)));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Original fixture origin</title><p>Existing browser profile</p>');}});
 await new Promise(r=>originalServer.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+originalServer.address().port;
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||chromium.executablePath(),headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1365,height:900},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(12000);
 await context.addCookies([{name:'deck_device',value:token,url:base,httpOnly:true,sameSite:'Strict'}]);await page.goto(base+'/?session='+sid);
 await page.evaluate(async()=>{localStorage.setItem('deck.theme','github-light');localStorage.setItem('deck.font','lora');const cache=await caches.open('deck-notification-preferences');await cache.put('/__deck_notification_preferences__',new Response(JSON.stringify({approvalActions:true,unknown:'keep'}),{headers:{'Content-Type':'application/json'}}));await navigator.serviceWorker.register('/service-worker.js',{scope:'/'});await navigator.serviceWorker.ready;});
 const registration=await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration('/');return{scope:r.scope,script:r.active.scriptURL};});
 const before=Object.fromEntries(['projects.json','web/devices.json','web/push.json','web/lead-replies.json','sessions/'+sid+'/session.json','sessions/'+sid+'/events/000001.jsonl'].map(p=>[p,digest(fs.readFileSync(path.join(source,p)))]));
 await new Promise(r=>originalServer.close(r));originalServer=undefined;
 const fake=path.join(root,'fake-codex');fs.copyFileSync(path.join(__dirname,'../crates/host/tests/fake_native.py'),fake);fs.chmodSync(fake,0o700);
 write(path.join(state,'launcher.json'),{host:new URL(base).host,admin:'discarded-fixture-launcher',project});
 const env={...process.env,HOME:home,XDG_CONFIG_HOME:path.join(root,'config'),XDG_STATE_HOME:path.join(root,'xdg-state'),CODEX_HOME:path.join(root,'native')};
 async function start(expected=200){host=spawn(binary,['serve','--project',project,'--state-dir',state,'--history-root',source,'--no-open','--codex',fake],{env,stdio:['ignore','pipe','pipe']});host.stdout.on('data',b=>logs+=b);host.stderr.on('data',b=>logs+=b);for(let i=0;i<500;i++){try{const response=await fetch(base+'/api/workspace',{headers:{Cookie:'deck_device='+token}});if(response.status===expected)return;}catch{}if(host.exitCode!==null)throw Error('Fixture host exited');await wait(20);}throw Error('Original device credential was not accepted by packaged replacement');}
 async function stop(){host.kill('SIGINT');await Promise.race([new Promise(r=>host.once('exit',r)),wait(4000)]);assert.notEqual(host.exitCode,null);host=undefined;}
 await start();await page.goto(base);await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));result.checks.push('existing original credential opens the root workspace without launcher or enrollment');
 await page.goto(base+'/?session='+sid);await page.getByRole('heading',{name:'Existing browser conversation',exact:true}).waitFor();await page.getByText('Original browser history survives replacement.',{exact:true}).waitFor();
 assert.equal(new URL(page.url()).searchParams.get('session'),sid);assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'github-light');assert.equal(await page.evaluate(()=>document.documentElement.dataset.font),'lora');
 await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration('/');await r.update();});
 await page.waitForFunction(async()=>{const r=await navigator.serviceWorker.getRegistration('/');return r?.active?.scriptURL===location.origin+'/service-worker.js'&&!r.installing&&!r.waiting;});
 assert.deepEqual(await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration('/');return{scope:r.scope,script:r.active.scriptURL};}),registration);
 assert.deepEqual(await page.evaluate(async()=>{const c=await caches.open('deck-notification-preferences');return(await c.match('/__deck_notification_preferences__')).json();}),{approvalActions:true,unknown:'keep'});
 const manifest=await(await page.request.get(base+'/manifest.webmanifest')).json();assert.equal(manifest.id,'/');assert.equal(manifest.scope,'/');assert.equal(manifest.start_url,'/');for(const icon of manifest.icons)assert.equal((await page.request.get(base+icon.src)).status(),200);
 result.checks.push('original session URL opens original history; original appearance and active worker/cache identity survive replacement');
 const worker=context.serviceWorkers().filter(w=>w.url()===base+'/service-worker.js').at(-1);assert(worker);
 const acknowledged=await worker.evaluate(async(id)=>{const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true}),client=clients[0];if(!client)return false;const channel=new MessageChannel();return new Promise(resolve=>{const timer=setTimeout(()=>{channel.port1.close();resolve(false);},1500);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data?.opened===true);};client.postMessage({type:'deck.open-session',sessionId:id},[channel.port2]);});},sid);assert.equal(acknowledged,true);
 result.checks.push('active original-compatible worker opens session through actual client message channel and receives acknowledgment');
 await page.reload();await page.getByRole('heading',{name:'Existing browser conversation',exact:true}).waitFor();await stop();await start();await page.reload();await page.getByRole('heading',{name:'Existing browser conversation',exact:true}).waitFor();
 assert.equal((await context.cookies()).filter(c=>c.name==='deck_device').length,1);assert.equal((await context.cookies()).filter(c=>c.name.startsWith('deck2_')).length,0);result.checks.push('reload and packaged restart retain credential and deep-link identity');
 const record=JSON.parse(fs.readFileSync(path.join(state,'launcher.json'))),link=await(await fetch(base+'/launch',{method:'POST',body:record.admin})).json(),experimental=await fetch(base+'/auth',{method:'POST',headers:{Origin:base},body:new URL(link.url).hash.slice(1)}),extra=experimental.headers.get('set-cookie').split(';')[0];
 const request=(headers={},method='GET',url='/api/workspace',body)=>new Promise((resolve,reject)=>{const r=http.request(base+url,{method,agent:false,headers:{Cookie:'deck_device='+token,...headers}},response=>{response.resume();resolve({status:response.statusCode});});r.on('error',reject);r.end(body);});
 for(const change of [{revokedAt:'2026-01-01T00:00:00Z'},{expiresAt:'2000-01-01T00:00:00Z'},{hash:digest('wrong')},{hash:'invalid'}]){
  write(path.join(source,'web/devices.json'),[{...records[0],...change}]);assert.equal((await request()).status,403);assert.equal((await request({Cookie:'deck_device='+token+'; '+extra})).status,403);
  assert.equal((await request({Origin:base,'Content-Type':'application/json'},'POST','/api/local-access','{}')).status,403);
 }
 write(path.join(source,'web/devices.json'),[]);assert.equal((await request()).status,403);fs.unlinkSync(path.join(source,'web/devices.json'));assert.equal((await request()).status,403);write(path.join(source,'web/devices.json'),records);
 for(const headers of [{Host:'attacker.invalid'},{Origin:'https://attacker.invalid'},{'X-Forwarded-Host':new URL(base).host},{'Tailscale-Funnel-Request':'true'}])assert.equal((await request(headers)).status,403,'Reject header partition '+Object.keys(headers).join(','));
 // Request mutation is not authorized by a spoofed Serve header or a missing credential.
 assert.equal((await request({Cookie:'',Origin:base,'Tailscale-User-Login':'spoofed@example.test'})).status,403);
 result.checks.push('revoked/expired/wrong/malformed/missing source deny; experimental cookie cannot override; local-access cannot silently re-enroll; spoofed boundaries deny');
 for(const [p,hash]of Object.entries(before))assert.equal(digest(fs.readFileSync(path.join(source,p))),hash,p+' must remain unchanged');
 await page.screenshot({path:path.join(out,'same-origin-replacement.png')});result.checks.push('original data, device record, inert push keys/subscriptions and receipt metadata preserved byte-for-byte');
 // Config discovery is part of production composition, not injected policy.
 await stop();
 write(path.join(env.XDG_CONFIG_HOME,'deck/config.json'),{version:1,crossRunner:{web:{trustedProxy:'127.0.0.1',allowedOrigins:['https://deck.tail123.ts.net'],tailscaleServeAccess:true,allowFunnel:false}}});
 await start();const serveHeaders={Host:'deck.tail123.ts.net',Origin:'https://deck.tail123.ts.net','X-Forwarded-Proto':'https','Tailscale-User-Login':'verified@example.test'};
 write(path.join(source,'web/devices.json'),[{...records[0],tailscaleIdentity:digest(JSON.stringify(['https://deck.tail123.ts.net','verified@example.test']))}]);
 assert.equal((await request(serveHeaders)).status,200);
 for(const extra of [{'Tailscale-User-Login':'spoofed@example.test'},{'Tailscale-Funnel-Request':'true'},{Origin:'https://unlisted.ts.net'}])assert.equal((await request({...serveHeaders,...extra})).status,403);
 write(path.join(source,'web/devices.json'),records);
 result.checks.push('canonical isolated config discovery enables exact trusted Serve origin and bound login; changed login/Funnel/origin deny');
 function cli(args){const r=spawnSync(binary,['web','--state-dir',state,...args],{env,encoding:'utf8',timeout:5000});assert.equal(r.status,0,'Native device control succeeds');return JSON.parse(r.stdout);}
 const listed=cli(['devices']);assert(!JSON.stringify(listed).includes(records[0].hash));assert(!JSON.stringify(listed).includes('tailscaleIdentity'));
 const pairing=cli(['pair']),paired=await browser.newContext(),pairedPage=await paired.newPage();await pairedPage.goto(pairing.url);await pairedPage.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 assert.equal(new URL(pairedPage.url()).hash,'');const pairedCookie=(await paired.cookies()).find(c=>c.name==='deck_device');assert(pairedCookie&&pairedCookie.httpOnly&&pairedCookie.sameSite==='Strict');
 const added=JSON.parse(fs.readFileSync(path.join(source,'web/devices.json'))).find(d=>d.id!=='original-device');assert(added);
 assert.equal((await fetch(base+'/pair',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(pairing.url).hash.slice(6)})})).status,401);
 cli(['revoke',added.id]);assert.equal((await pairedPage.request.get(base+'/api/workspace')).status(),403);assert.equal((await request()).status,200);
 await paired.close();cli(['revoke','original-device']);assert.equal((await request()).status,403);await stop();await start(403);assert.equal((await request()).status,403);assert.equal((await request({Origin:base,'Content-Type':'application/json'},'POST','/api/local-access','{}')).status,403);result.checks.push('native listing redacts credentials; original single-use pairing fragment enrolls; native revoke blocks paired credential without revoking another device; revoked original credential stays blocked after restart');
 // Already-subscribed transports and receipts remain inert until notification migration.
 assert.equal(digest(fs.readFileSync(path.join(source,'web/push.json'))),before['web/push.json']);assert.equal(digest(fs.readFileSync(path.join(source,'web/lead-replies.json'))),before['web/lead-replies.json']);
 result.passed=true;
}catch(e){result.error=e.stack;process.exitCode=1;}finally{if(browser)await browser.close();if(originalServer)await new Promise(r=>originalServer.close(r));if(host){host.kill('SIGINT');await Promise.race([new Promise(r=>host.once('exit',r)),wait(4000)]);if(host.exitCode===null)host.kill('SIGKILL');}result.seconds=(performance.now()-started)/1000;fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(out,'host.log'),logs);console.log(JSON.stringify(result));fs.rmSync(root,{recursive:true,force:true});}})();
