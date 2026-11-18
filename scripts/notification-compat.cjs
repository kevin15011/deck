// Oracle: original browser credential, worker, cache, appearance and session URL
// survive a same-origin packaged host replacement. All effects are disposable.
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),http=require('http'),assert=require('assert/strict'),{spawn,spawnSync}=require('child_process'),{chromium}=require('playwright');
const binary=path.resolve(process.argv[2]||'dist/deck2'),out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/notification-contract-green');fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-identity-')),source=path.join(root,'original'),project=path.join(root,'project'),state=path.join(root,'state'),home=path.join(root,'home'),sid='original-browser-session';
const wait=ms=>new Promise(r=>setTimeout(r,ms)),digest=b=>crypto.createHash('sha256').update(b).digest('hex'),token=crypto.randomBytes(32).toString('base64url'),pid='project-'+digest(project).slice(0,24);
function dir(p){fs.mkdirSync(p,{recursive:true,mode:0o700});}function write(p,v){dir(path.dirname(p));fs.writeFileSync(p,typeof v==='string'?v:JSON.stringify(v),{mode:0o600});}
let host,browser,originalServer,base,logs='';const result={binary:digest(fs.readFileSync(binary)),passed:false,checks:[]},started=performance.now();
(async()=>{try{
 dir(project);dir(home);dir(state);
 write(path.join(source,'projects.json'),{v:1,projects:[{projectId:pid,path:project,name:'Existing project',createdAt:'2026-01-01T00:00:00Z'}]});
 write(path.join(source,'sessions',sid,'session.json'),{v:1,sessionId:sid,projectRoot:project,projectId:pid,title:'Existing browser conversation',createdAt:'2026-01-01T00:00:00Z',members:{lead:{runnerId:'claude-code',modelId:'original-model'}},approvals:'relay'});
 const event=(seq,kind,data)=>({v:1,sessionId:sid,seq,ts:'2026-01-01T00:00:00Z',kind,source:{taskId:'lead',memberId:'lead',runnerId:'claude-code',attempt:1},data});
 const events=[event(1,'turn.started',{}),event(2,'message.completed',{role:'assistant',text:'Original browser history survives replacement.'}),event(3,'turn.completed',{status:'completed'})];
 for(let seq=4;seq<=90;seq++)events.push(event(seq,'message.completed',{role:'assistant',text:'Newer retained original message '+seq}));
 write(path.join(source,'sessions',sid,'events/000001.jsonl'),events.map(e=>JSON.stringify(e)).join('\n')+'\n');
 const records=[{id:'original-device',name:'Existing browser',createdAt:'2026-01-01T00:00:00Z',hash:digest(token),future:{preserved:true}}];
 write(path.join(source,'web/devices.json'),records);
 // Exact original worker and generated manifest/icons, supplied by canonical sources.
 const oldWorker=fs.readFileSync(path.join(__dirname,'fixtures/original-service-worker.js'));
 const publicDir=path.resolve(__dirname,'../frontend/public');
 originalServer=http.createServer((req,res)=>{const name=new URL(req.url,'http://fixture').pathname.slice(1);if(name==='service-worker.js'){res.setHeader('Content-Type','text/javascript');res.end(oldWorker);}else if(['manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','apple-touch-icon.png'].includes(name)){res.setHeader('Content-Type',name.endsWith('webmanifest')?'application/manifest+json':name.endsWith('svg')?'image/svg+xml':'image/png');res.end(fs.readFileSync(path.join(publicDir,name)));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Original fixture origin</title><p>Existing browser profile</p>');}});
 await new Promise(r=>originalServer.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+originalServer.address().port;
 const vapid=crypto.createECDH('prime256v1');vapid.generateKeys();
 const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-never-network',keys:{p256dh:vapid.getPublicKey().toString('base64url'),auth:crypto.randomBytes(16).toString('base64url')},expirationTime:null};
 const seed=spawnSync('bun',[path.join(__dirname,'fixtures/notification-original.ts'),path.join(source,'web'),base,JSON.stringify(subscription)],{encoding:'utf8',env:{...process.env,DECK1_ROOT:process.env.DECK1_ROOT||path.resolve(process.cwd(),'../deck')}});assert.equal(seed.status,0,seed.stderr);
 const originalPush=JSON.parse(fs.readFileSync(path.join(source,'web/push.json')));
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||chromium.executablePath(),headless:true,args:['--no-sandbox','--disable-features=NativeNotifications']});const context=await browser.newContext({viewport:{width:1365,height:900},reducedMotion:'no-preference'}),page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.addCookies([{name:'deck_device',value:token,url:base,httpOnly:true,sameSite:'Strict'}]);await page.goto(base+'/?session='+sid);
 await page.evaluate(async()=>{localStorage.setItem('deck.theme','github-light');localStorage.setItem('deck.font','lora');const cache=await caches.open('deck-notification-preferences');await cache.put('/__deck_notification_preferences__',new Response(JSON.stringify({approvalActions:true,unknown:'keep'}),{headers:{'Content-Type':'application/json'}}));await navigator.serviceWorker.register('/service-worker.js',{scope:'/'});await navigator.serviceWorker.ready;});
 const registration=await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration('/');return{scope:r.scope,script:r.active.scriptURL};});
 const before=Object.fromEntries(['projects.json','web/push.json','web/push-attention.json','web/push-attention.sqlite','web/lead-replies.sqlite','web/lead-replies.json','sessions/'+sid+'/session.json','sessions/'+sid+'/events/000001.jsonl'].map(p=>[p,digest(fs.readFileSync(path.join(source,p)))]));
 await new Promise(r=>originalServer.close(r));originalServer=undefined;
 const fake=path.join(root,'fake-codex');let nativeSource=fs.readFileSync(path.join(__dirname,'../crates/host/tests/fake_session_native.py'),'utf8');nativeSource=nativeSource.replace("  out({'method':'item/agentMessage/delta','params':{'threadId':thread,'turnId':'normal-turn','delta':'Connected reply'}})",`  if any('Final segment visibility oracle' in v.get('text','') for v in p['input']):
   commentary=('Progress 🙂 before the final answer.\\n\\n'*150)
   out({'method':'item/started','params':{'threadId':thread,'turnId':'normal-turn','item':{'type':'agentMessage','id':'progress'}}})
   out({'method':'item/agentMessage/delta','params':{'threadId':thread,'turnId':'normal-turn','delta':commentary}})
   out({'method':'item/completed','params':{'threadId':thread,'turnId':'normal-turn','item':{'type':'agentMessage','id':'progress','phase':'commentary','text':commentary}}})
  out({'method':'item/started','params':{'threadId':thread,'turnId':'normal-turn','item':{'type':'agentMessage','id':'final'}}})
  out({'method':'item/agentMessage/delta','params':{'threadId':thread,'turnId':'normal-turn','delta':'Connected reply'}})
  out({'method':'item/completed','params':{'threadId':thread,'turnId':'normal-turn','item':{'type':'agentMessage','id':'final','phase':'final_answer','text':'Connected reply'}}})`);fs.writeFileSync(fake,nativeSource);fs.chmodSync(fake,0o700);
 write(path.join(state,'launcher.json'),{host:new URL(base).host,admin:'discarded-fixture-launcher',project});
 const env={...process.env,HOME:home,XDG_CONFIG_HOME:path.join(root,'config'),XDG_STATE_HOME:path.join(root,'xdg-state'),CODEX_HOME:path.join(root,'native')};
 async function start(expected=200){host=spawn(binary,['serve','--project',project,'--state-dir',state,'--history-root',source,'--no-open','--codex',fake],{env,stdio:['ignore','pipe','pipe']});host.stdout.on('data',b=>logs+=b);host.stderr.on('data',b=>logs+=b);for(let i=0;i<500;i++){try{const response=await fetch(base+'/api/workspace',{headers:{Cookie:'deck_device='+token}});if(response.status===expected)return;}catch{}if(host.exitCode!==null)throw Error('Fixture host exited');await wait(20);}throw Error('Original device credential was not accepted by packaged replacement');}
 async function stop(){host.kill('SIGINT');await Promise.race([new Promise(r=>host.once('exit',r)),wait(4000)]);assert.notEqual(host.exitCode,null);host=undefined;}
 await context.grantPermissions(['notifications']);
 await context.addInitScript(({subscription,key})=>{
  const serverKey=Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  let current={...subscription,options:{applicationServerKey:serverKey.buffer},toJSON:()=>subscription,unsubscribe:async()=>{current=null;return true;}};
  window.notificationPermissionCalls=[];
  Notification.requestPermission=()=>{window.notificationPermissionCalls.push(navigator.userActivation.isActive);return Promise.resolve('granted');};
  Object.defineProperty(ServiceWorkerRegistration.prototype,'pushManager',{get:()=>({getSubscription:async()=>current,subscribe:async()=>{current={...subscription,options:{applicationServerKey:serverKey.buffer},toJSON:()=>subscription,unsubscribe:async()=>{current=null;return true;}};return current;}})});
 },{subscription,key:originalPush.keys.publicKey});
 await start();await page.goto(base);await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));result.checks.push('existing original credential opens the root workspace without launcher or enrollment');

 const status=await page.request.get(base+'/api/push');assert.equal(status.status(),200,'original device can read push settings');
 const data=await status.json();assert.equal(data.enabled,true);assert.equal(data.publicKey,originalPush.keys.publicKey);
 assert.equal((await page.request.get(base+'/api/replies')).status(),200);
 const initialReplies=await(await page.request.get(base+'/api/replies')).json();assert.equal(initialReplies.total,1);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Notifications',exact:true}).click();
 await page.getByText('On for this browser',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>window.notificationPermissionCalls),[]);
 const actions=page.getByLabel('Answer approvals from notifications',{exact:true});assert.equal(await actions.isChecked(),true);await actions.uncheck();await page.getByText('Approval actions are off for this browser.',{exact:true}).waitFor();await actions.check();
 await page.getByRole('button',{name:'Disable notifications',exact:true}).click();await page.getByText('Notifications are off for this browser.',{exact:true}).waitFor();
 assert.equal((await(await page.request.get(base+'/api/push')).json()).enabled,false);
 await page.getByRole('button',{name:'Enable notifications',exact:true}).click();await page.getByText('Notifications are on for this browser.',{exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.notificationPermissionCalls),[true]);assert.equal((await(await page.request.get(base+'/api/push')).json()).publicKey,originalPush.keys.publicKey);
 const cookie=(await context.cookies()).find(c=>c.name==='deck_device');assert(cookie.expires>Date.now()/1000+179*86400);assert(cookie.httpOnly);
 for(const bad of [{...subscription,endpoint:'https://127.0.0.1/forbidden'},{...subscription,expirationTime:1},{...subscription,keys:{...subscription.keys,p256dh:Buffer.alloc(65).toString('base64url')}}])assert.equal((await page.request.post(base+'/api/push',{data:{subscription:bad},headers:{Origin:base}})).status(),400);
 assert.equal((await page.request.post(base+'/api/push',{data:{subscription},headers:{Origin:'https://foreign.invalid'}})).status(),403);
 assert.equal((await page.request.get(base+'/api/push',{headers:{Cookie:'deck_device='+crypto.randomBytes(32).toString('base64url')}})).status(),403);
 result.checks.push('Malformed key, private endpoint, expired subscription, wrong origin and unauthorized credential reject without changing the subscribed identity');
 result.checks.push('Original VAPID/subscription identity retained; original settings/cache and enable/disable work; permission comes only from the user gesture; cookie renews without changing its identity');
 await page.getByRole('button',{name:'Done',exact:true}).click();await page.getByRole('button',{name:'Back to session',exact:true}).click();
 await page.goto(base+'/?session='+sid+'&reply=reply-3-2');await page.getByText('Original browser history survives replacement.',{exact:true}).waitFor();await page.bringToFront();
 for(let i=0;i<100;i++){if((await(await page.request.get(base+'/api/replies')).json()).total===0)break;await wait(100);}
 assert.equal((await(await page.request.get(base+'/api/replies')).json()).total,0,'only visible exact reply is acknowledged');
 result.checks.push('Imported pending reply is acknowledged only after original reply content becomes visible; exact display removes pending without replacing the identity');
 await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration('/');await r.update();});
 await page.waitForFunction(async()=>{const r=await navigator.serviceWorker.getRegistration('/');return r?.active&&!r.installing&&!r.waiting;});
 const cdp=await context.newCDPSession(page);let registrations=[];cdp.on('ServiceWorker.workerRegistrationUpdated',e=>registrations.push(...e.registrations));await cdp.send('ServiceWorker.enable');
 for(let i=0;i<100&&!registrations.some(r=>r.scopeURL===base+'/');i++)await wait(20);
 const registrationId=registrations.find(r=>r.scopeURL===base+'/').registrationId;
 const background=await context.newPage();await background.goto('about:blank');await background.bringToFront();
 await cdp.send('ServiceWorker.deliverPushMessage',{origin:base,registrationId,data:JSON.stringify({sessionId:sid,kind:'finished',seq:101,replyId:'reply-101-100'})});
 const worker=context.serviceWorkers().filter(w=>w.url()===base+'/service-worker.js').at(-1);assert(worker);
 let notices=[];for(let i=0;i<100;i++){notices=await worker.evaluate(async()=> (await self.registration.getNotifications()).map(n=>({title:n.title,body:n.body,tag:n.tag,data:n.data})));if(notices.length)break;await wait(50);}
 assert.equal(notices.length,1);assert.equal(notices[0].data.replyId,'reply-101-100');assert.match(notices[0].title,/1 new reply/);
 await cdp.send('ServiceWorker.deliverPushMessage',{origin:base,registrationId,data:JSON.stringify({sessionId:sid,kind:'finished',seq:102,replyId:'reply-102-100'})});
 for(let i=0;i<100;i++){const count=await worker.evaluate(async()=> (await self.registration.getNotifications())[0]?.data?.count);if(count===2)break;await wait(50);}
 assert.equal(await worker.evaluate(async()=> (await self.registration.getNotifications())[0]?.data?.count),2);
 await worker.evaluate(async()=>{const n=(await self.registration.getNotifications())[0];self.dispatchEvent(new NotificationEvent('notificationclick',{notification:n}));});
 await wait(700);await background.close();
 assert.equal(new URL(page.url()).searchParams.get('session'),sid);assert.equal(new URL(page.url()).searchParams.get('reply'),'reply-102-100');
 result.checks.push('Actual registered worker displays browser-injected push and routes notification click through the existing session navigation contract; no external push transport is called');
 for(const [p,hash] of Object.entries(before))assert.equal(digest(fs.readFileSync(path.join(source,p))),hash,p+' source must remain untouched');
 await page.goto(base+'/?session='+sid+'&reply=reply-3-2');await page.getByText('Original browser history survives replacement.',{exact:true}).waitFor();
 await stop();await start();await page.reload();await page.getByText('Original browser history survives replacement.',{exact:true}).waitFor();assert.equal((await(await page.request.get(base+'/api/push')).json()).publicKey,originalPush.keys.publicKey);assert.equal((await(await page.request.get(base+'/api/replies')).json()).total,0);
 await page.screenshot({path:path.join(out,'notifications-restored.png')});
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Notifications',exact:true}).click();await page.getByText('On for this browser',{exact:true}).waitFor();
 await page.waitForFunction(()=>{const node=document.querySelector('.notifications-dialog');return node&&!node.style.opacity&&!node.style.transform;});await page.screenshot({path:path.join(out,'notifications-settings-desktop.png')});
 for(let i=0;i<3;i++){await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Notifications',exact:true}).waitFor({state:'hidden'});await page.getByRole('button',{name:'Notifications',exact:true}).click();}
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'notifications-settings-mobile.png')});await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Notifications',exact:true}).waitFor({state:'hidden'});assert.deepEqual(errors,[]);
 result.checks.push('Original dialog works with keyboard close, repeated rapid reopening, desktop motion and reduced-motion mobile layout without page exceptions');result.checks.push('Restart preserves exact display receipt and original key, with no replay of historical sends');

 // The production scheduler has no subscriptions during this action exercise;
 // only browser CDP delivery is injected. No provider can receive a request.
 assert.equal((await page.request.delete(base+'/api/push',{headers:{Origin:base}})).status(),200);
 const normal='notification-action-session';
 let response=await page.request.post(base+'/api/sessions',{headers:{Origin:base},data:{api:7,id:normal,title:'Notification action journey',members:{lead:{runnerId:'codex',modelId:'gpt-6.1-sol'}}}});assert.equal(response.status(),200,await response.text());
 const workspace=async()=>await(await page.request.get(base+'/api/workspace')).json();
 async function nativeDecision(prompt,id){const r=await page.request.post(base+'/api/commands',{headers:{Origin:base},data:{api:7,id,session:normal,prompt,mode:'session_v1',fresh:false,queue:false}});assert.equal(r.status(),200,await r.text());for(let i=0;i<200;i++){const w=await workspace(),r=w.receipts.find(r=>r.id===id);if(r?.decisions.some(d=>d.state==='pending'))return r.decisions.find(d=>d.state==='pending');if(r&&['failed','cancelled','uncertain'].includes(r.phase))throw Error(r.detail);await wait(50);}throw Error('Native permission fixture did not arrive');}
 const d=await nativeDecision('Synthetic MCP first','notification-action-command');
 const pushBackground=await context.newPage();await pushBackground.goto('about:blank');await pushBackground.bringToFront();
 await cdp.send('ServiceWorker.deliverPushMessage',{origin:base,registrationId,data:JSON.stringify({sessionId:normal,kind:'approval',seq:201,approvalId:d.id,tool:'mcp__synthetic-mail__send_message',risk:'normal'})});
 let approval;for(let i=0;i<100;i++){approval=await worker.evaluate(async()=>{const n=(await self.registration.getNotifications()).find(n=>n.data?.approvalId);return n?{title:n.title,actions:n.actions.map(a=>a.action)}:null;});if(approval)break;await wait(50);}
 assert.deepEqual(approval,{title:'Allow mcp__synthetic-mail__send_message once?',actions:['allow','deny']});
 await worker.evaluate(async()=>{const n=(await self.registration.getNotifications()).find(n=>n.data?.approvalId);self.dispatchEvent(new NotificationEvent('notificationclick',{notification:n,action:'allow'}));});
 let finished;for(let i=0;i<200;i++){finished=(await workspace()).receipts.find(r=>r.id==='notification-action-command');if(finished?.phase==='completed')break;await wait(50);}assert.equal(finished.phase,'completed');
 const exact=finished.decisions.find(x=>x.id===d.id);assert.equal(exact.resolution.response.type,'allow_once');assert.equal(fs.readFileSync(path.join(root,'mcp-approved'),'utf8').trim().split('\n').length,1);
 const envelope={sessionId:normal,command:{v:1,commandId:exact.resolution.command_id,type:'approval.respond',approvalId:d.id,decision:'allow',scope:'once',origin:'notification'}};
 assert.equal((await page.request.post(base+'/api/commands',{headers:{Origin:base},data:envelope})).status(),200);
 envelope.command.commandId=crypto.randomUUID();assert.equal((await page.request.post(base+'/api/commands',{headers:{Origin:base},data:envelope})).status(),409);
 const high=await nativeDecision('Native command consent oracle','notification-high-command');envelope.command.approvalId=high.id;envelope.command.commandId=crypto.randomUUID();assert.equal((await page.request.post(base+'/api/commands',{headers:{Origin:base},data:envelope})).status(),409);
 assert.equal((await page.request.post(base+'/api/decisions/'+high.id+'/responses',{headers:{Origin:base},data:{api:7,command_id:crypto.randomUUID(),expected_revision:high.revision,response:{type:'deny'}}})).status(),200);
 for(let i=0;i<200;i++){if((await workspace()).receipts.find(r=>r.id==='notification-high-command')?.phase==='completed')break;await wait(50);}assert.equal(fs.existsSync(path.join(root,'native-created.txt')),false);
 assert.equal(fs.readFileSync(path.join(root,'mcp-approved'),'utf8').trim().split('\n').length,1);await pushBackground.close();assert.deepEqual(errors,[]);
 result.checks.push('Actual worker Allow once resolves a real normal-risk native MCP request through authenticated production commands; replay has one effect, stale command and high-risk bypass reject');

 // Observe the actual browser clock and exact final text geometry. Instrumentation
 // delegates fetch unchanged; it never creates, suppresses or delays a receipt.
 const legacyVisibility=process.env.DECK2_VISIBILITY_DIAGNOSTIC==='legacy';
 result.visibilityMode=legacyVisibility?'legacy-500ms-ordering':'mapping-held-preconditions';
 await page.evaluate(()=>{
  const trace=window.finalVisibilityTrace=[];
  window.sampleFinalVisibility=(event,extra={})=>{
   const root=document.querySelector('#conversation'),exchange=document.querySelector('#exchange-notification-final-command');
   const box=node=>{if(!node)return null;const b=node.getBoundingClientRect();return{top:b.top,bottom:b.bottom,left:b.left,right:b.right,width:b.width,height:b.height};};
   let final=null,commentary=null;
   if(exchange){const walker=document.createTreeWalker(exchange,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){const prefix=node.textContent.indexOf('Progress 🙂 before the final answer.');if(commentary===null&&prefix>=0){const range=document.createRange();range.setStart(node,prefix);range.setEnd(node,prefix+'Progress 🙂 before the final answer.'.length);commentary=box(range);}
   const at=node.textContent.lastIndexOf('Connected reply');if(at>=0){const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+'Connected reply'.length);final=box(range);}}}
   const viewport=box(root),onscreen=!!(final&&viewport&&Math.min(final.bottom,viewport.bottom,innerHeight)>Math.max(final.top,viewport.top,0));
   const sample={event,at:performance.now(),utc:Date.now(),focus:document.hasFocus(),visibility:document.visibilityState,scrollTop:root?.scrollTop,viewport,window:{width:innerWidth,height:innerHeight},commentary,commentaryOnscreen:!!(commentary&&viewport&&Math.min(commentary.bottom,viewport.bottom,innerHeight)>Math.max(commentary.top,viewport.top,0)),final,onscreen,replyId:exchange?.querySelector('[data-reply-id]')?.dataset.replyId,...extra};
   trace.push(sample);return sample;
  };
  const originalFetch=window.fetch;
  window.fetch=function(input,init){const url=typeof input==='string'?input:input.url||String(input),method=init?.method||'GET';if(url.includes('/replies'))window.sampleFinalVisibility('fetch',{url,method,body:init?.body});return originalFetch.apply(this,arguments);};
  window.finalVisibilityTimer=setInterval(()=>window.sampleFinalVisibility('sample'),50);
 });
 let releaseMapping,heldMapping;
 const mappingReady=new Promise(resolve=>{heldMapping=resolve;}),mappingGate=new Promise(resolve=>{releaseMapping=resolve;});
 if(!legacyVisibility)await page.route('**/api/sessions/'+normal+'/replies?*',async route=>{
  if(!new URL(route.request().url()).searchParams.getAll('commandId').includes('notification-final-command'))return route.continue();
  const response=await route.fetch(),body=await response.json();
  (result.mappings??=[]).push(body);heldMapping();await mappingGate;
  await page.evaluate(()=>window.sampleFinalVisibility('mapping-release'));
  await route.fulfill({response});
 });
 try{
 const visibilityBackground=await context.newPage();await visibilityBackground.goto('about:blank');await visibilityBackground.bringToFront();
 response=await page.request.post(base+'/api/commands',{headers:{Origin:base},data:{api:7,id:'notification-final-command',session:normal,prompt:'Final segment visibility oracle',mode:'session_v1',fresh:false,queue:false}});assert.equal(response.status(),200);
 for(let i=0;i<200;i++){if((await workspace()).receipts.find(r=>r.id==='notification-final-command')?.phase==='completed')break;await wait(50);}
 await worker.evaluate(async id=>{const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});const client=clients.find(c=>c.url.startsWith(self.location.origin));client.postMessage({type:'deck.open-session',sessionId:id});},normal);
 const exchange=page.locator('#exchange-notification-final-command');await exchange.waitFor({state:'attached'});
 await page.evaluate(()=>window.sampleFinalVisibility('exchange-attached'));
 if(legacyVisibility)await wait(500);
 else await Promise.race([mappingReady,wait(12000).then(()=>{throw Error('Final reply mapping was not intercepted');})]);
 await page.evaluate(legacy=>{const node=document.querySelector('#conversation');node.scrollTop=0;if(!legacy){const s=window.sampleFinalVisibility('locate-commentary');if(!s.commentary)throw Error('Native commentary text missing');node.scrollTop+=s.commentary.top-s.viewport.top-24;}window.sampleFinalVisibility('commentary-scroll');},legacyVisibility);await page.bringToFront();
 if(!legacyVisibility){
  // Establish settled commentary geometry before the mapping can mount a hook.
  await page.waitForFunction(()=>{const s=window.sampleFinalVisibility('precondition');return s.focus&&s.visibility==='visible'&&s.commentaryOnscreen&&s.final&&!s.onscreen;});
  await wait(350);
  const before=await page.evaluate(()=>window.sampleFinalVisibility('before-mapping-release'));
  assert.equal(before.onscreen,false);assert.equal(before.commentaryOnscreen,true,'native commentary is visible before mapping');assert(before.scrollTop>0);assert.equal(before.focus,true);
  assert.match(await exchange.innerText(),/Progress 🙂 before the final answer/);
  releaseMapping();
 }
 if(legacyVisibility){await wait(800);assert.equal((await(await page.request.get(base+'/api/sessions/'+normal+'/replies')).json()).total,1,'seeing commentary cannot acknowledge the final reply');}
 const finalReply=exchange.locator('[data-reply-id^="reply-"]');await finalReply.waitFor({state:'attached'});
 assert.equal((await finalReply.innerText()).trim(),'Connected reply');
 await wait(800);
 const commentary=await page.evaluate(()=>window.sampleFinalVisibility('commentary-assertion'));
 assert.equal(commentary.onscreen,false,'exact final must remain outside the commentary viewport');
 const finalId=await finalReply.getAttribute('data-reply-id');result.exactFinalReplyId=finalId;
 result.pendingWhileCommentary=(await(await page.request.get(base+'/api/sessions/'+normal+'/replies')).json()).total;
 assert.equal(result.pendingWhileCommentary,1,'seeing commentary cannot acknowledge the final reply');
 assert.equal(commentary.commentaryOnscreen,true);
 const premature=await page.evaluate(id=>window.finalVisibilityTrace.filter(s=>s.event==='fetch'&&s.method==='POST'&&s.url.endsWith('/replies/'+id)),finalId);
 assert.deepEqual(premature,[],'off-screen exact final has no displayed request');
 await page.evaluate(()=>window.sampleFinalVisibility('deliberate-reveal'));await finalReply.scrollIntoViewIfNeeded();
 for(let i=0;i<100;i++){if((await(await page.request.get(base+'/api/sessions/'+normal+'/replies')).json()).total===0)break;await wait(50);}
 result.pendingAfterReveal=(await(await page.request.get(base+'/api/sessions/'+normal+'/replies')).json()).total;assert.equal(result.pendingAfterReveal,0);
 const receipts=await page.evaluate(id=>window.finalVisibilityTrace.filter(s=>s.event==='fetch'&&s.method==='POST'&&s.url.endsWith('/replies/'+id)),finalId);
 assert.equal(receipts.length,1,'exact final receives one display request');assert.equal(receipts[0].onscreen,true);assert.equal(receipts[0].focus,true);assert.equal(receipts[0].visibility,'visible');assert.deepEqual(JSON.parse(receipts[0].body),{displayed:true});
 result.exactReceipt=receipts[0];await visibilityBackground.close();assert.deepEqual(errors,[]);
 }finally{
  releaseMapping();
  result.visibilityTrace=await page.evaluate(()=>{clearInterval(window.finalVisibilityTimer);window.sampleFinalVisibility('scenario-end');return window.finalVisibilityTrace;});
 }
 result.checks.push('Actual native commentary and final phases remain distinct: a visible commentary prefix does not acknowledge an off-screen final answer; scrolling the exact final text does');
 result.passed=true;
}finally{if(browser)await browser.close();if(originalServer)await new Promise(r=>originalServer.close(r));if(host){host.kill('SIGINT');await Promise.race([new Promise(r=>host.once('exit',r)),wait(4000)]);}result.elapsed_ms=performance.now()-started;fs.writeFileSync(path.join(out,'notification-contract.json'),JSON.stringify(result,null,2));fs.writeFileSync(path.join(out,'host.log'),logs);}})().catch(e=>{console.error(e);process.exitCode=1;});
