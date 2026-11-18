// S5A-Q01 public regression. Real packaged assets/handlers, owned host/native fake.
// Oracle: a different tab's stale rejection cannot remove a lost-ack operation;
// reload must still offer retrieval of the server's durable receipt.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/s5a-corrections/browser');fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(out,'fixture-')),project=path.join(root,'project'),state=path.join(root,'state'),codex=path.join(root,'codex'),binary=path.resolve(process.env.DECK2_BINARY||'dist/deck2');
fs.mkdirSync(project);fs.writeFileSync(path.join(project,'sentinel'),'unchanged');fs.copyFileSync('crates/host/tests/fake_native.py',codex);fs.chmodSync(codex,0o700);fs.writeFileSync(path.join(root,'mode'),'normal');
const log=fs.openSync(path.join(root,'host.log'),'w'),host=spawn(binary,['serve','--project',project,'--state-dir',state,'--codex',codex,'--no-open'],{stdio:['ignore',log,log]});
const wait=ms=>new Promise(r=>setTimeout(r,ms));let browser;const result={root,binary,binary_sha256:crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),checks:[]};
async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await wait(50);}throw Error('Fixture deadline exceeded');}
(async()=>{const start=Date.now();try{
 await until(()=>fs.existsSync(path.join(state,'launcher.json')));
 const l=JSON.parse(fs.readFileSync(path.join(state,'launcher.json'))),{url}=await(await fetch('http://'+l.host+'/launch',{method:'POST',body:l.admin})).json();
 browser=await chromium.launch({executablePath:'/snap/bin/chromium',headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1440,height:1000}}),a=await context.newPage(),b=await context.newPage();context.setDefaultTimeout(12000);const errors=[];for(const p of [a,b])p.on('pageerror',e=>errors.push(e.message));
 async function open(p,u=url){await p.bringToFront();await p.goto(u);await p.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));await p.getByRole('button',{name:'Configuration',exact:true}).click();await p.getByRole('button',{name:/Review (disabling|enabling) team investigation/}).waitFor();}
 console.log('Opening tabs');await open(a);await open(b,a.url());console.log('Reviewing plans');
 for(const p of [a,b]){await p.bringToFront();await p.getByRole('button',{name:'Review disabling team investigation',exact:true}).click();}
 await a.bringToFront();console.log('Intercepting acknowledgment');let lost,receipt;
 await a.route('**/api/configuration/plans/*/apply',async route=>{lost=route.request().postDataJSON();const r=await route.fetch();receipt=await r.json();assert.equal(r.status(),200);await route.abort('failed');});
 await a.getByRole('button',{name:'Apply reviewed change',exact:true}).click();await a.getByRole('button',{name:'Retrieve operation receipt',exact:true}).waitFor();
 await until(()=>receipt);assert.equal(receipt.id,lost.operation_id);
 await b.bringToFront();console.log('Rejecting stale plan');await b.getByRole('button',{name:'Apply reviewed change',exact:true}).click();await b.getByRole('alert').filter({hasText:/stale/}).waitFor();
 const durable=await a.evaluate(async id=>await(await fetch('/api/operations/'+id)).json(),lost.operation_id);assert.equal(durable.id,lost.operation_id);result.checks.push('A committed with lost acknowledgment; B exact stale rejection; server receipt survives');
 await a.bringToFront();console.log('Reloading retained operation');await a.unroute('**/api/configuration/plans/*/apply');await a.reload();await a.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));await a.getByRole('button',{name:'Configuration',exact:true}).click();
 result.storage_after_reload=await a.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.includes('configuration-operation'))));
 await a.getByRole('button',{name:'Retrieve operation receipt',exact:true}).waitFor({timeout:5000});assert(await a.getByRole('button',{name:'Retrieve operation receipt',exact:true}).isVisible(),'Lost-ack operation must remain recoverable after another tab rejects and A reloads');
 console.log('Retrieving receipt');await a.getByRole('button',{name:'Retrieve operation receipt',exact:true}).click();await a.getByRole('status').filter({hasText:'Management operation applied'}).waitFor();assert((await a.locator('.configuration-content').innerText()).includes(lost.operation_id));result.checks.push('Reload discovers exact pending identity and retrieves original durable receipt');

 // Recover two saved operations, including an older single-slot installation.
 const api=async(method,url,body)=>a.evaluate(async({method,url,body})=>{const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};},{method,url,body});
 const current=(await api('GET','/api/configuration')).body.selected,base=`deck2.host.${current.host_id}.configuration-operation`;
 const saved=[];
 for(let i=0;i<2;i++){const p=await api('POST','/api/configuration/plans',{api:3,expected_revision:current.revision,team_enabled:false});assert.equal(p.status,200);const pending={plan:p.body,id:crypto.randomUUID(),allow:false},r=await api('POST',`/api/configuration/plans/${p.body.id}/apply`,{api:3,operation_id:pending.id,allow:false});assert.equal(r.status,200);saved.push({pending,receipt:r.body});}
 saved.sort((x,y)=>x.pending.id.localeCompare(y.pending.id));const [one,two]=saved;
 await a.evaluate(({base,one,two})=>{localStorage.setItem(base,JSON.stringify(one));localStorage.setItem(base+'.'+two.id,JSON.stringify(two));},{base,one:one.pending,two:two.pending});
 const reopen=async p=>{await p.bringToFront();await p.reload();await p.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));await p.getByRole('button',{name:'Configuration',exact:true}).click();await p.getByRole('button',{name:'Retrieve operation receipt',exact:true}).waitFor();};
 await reopen(a);assert.equal(await a.getByLabel('Recover management operation').locator('option').count(),3);
 assert.equal(await a.evaluate(base=>localStorage.getItem(base),base),null);
 const storage=()=>a.evaluate(base=>Object.fromEntries(Object.entries(localStorage).filter(([k,v])=>k.startsWith(base)&&v)),base);
 assert.equal(Object.keys(await storage()).length,2);
 // Selecting via keyboard changes recovery context without dispatching anything.
 await a.getByLabel('Recover management operation').selectOption(two.pending.id);await a.getByLabel('Recover management operation').focus();await a.keyboard.press('ArrowUp');await a.keyboard.press('Enter');
 await a.getByLabel('Recover management operation').selectOption(one.pending.id);await a.keyboard.press('Escape');console.log('Validating foreign receipt');
 await a.route('**/api/operations/'+one.pending.id,route=>route.fulfill({json:two.receipt}));
 await a.getByRole('button',{name:'Retrieve operation receipt',exact:true}).click();await a.getByRole('alert').filter({hasText:'identity mismatch'}).waitFor();assert.equal(Object.keys(await storage()).length,2);await a.unroute('**/api/operations/'+one.pending.id);
 for(const problem of [{message:'Generic conflict'},{api:3,code:'management_not_applied',plan:one.pending.plan.id,operation_id:two.pending.id,message:'Wrong proof'}]){
  await a.route('**/api/configuration/plans/*/apply',route=>route.fulfill({status:409,json:problem}));await a.getByRole('button',{name:'Retry same operation',exact:true}).click();await a.getByRole('alert').filter({hasText:problem.message}).waitFor();assert.equal(Object.keys(await storage()).length,2);await a.unroute('**/api/configuration/plans/*/apply');
 }
 result.checks.push('Legacy single-slot migration, multiple identities and keyboard selection; wrong receipt/generic conflict/foreign proof preserve both operations');
 await a.setViewportSize({width:390,height:844});await a.emulateMedia({reducedMotion:'reduce'});
 for(let i=0;i<6;i++)await a.getByLabel('Recover management operation').selectOption(i%2?one.pending.id:two.pending.id);
 assert(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await a.screenshot({path:path.join(out,'mobile-pending.png'),fullPage:true});await a.setViewportSize({width:1440,height:1000});await a.emulateMedia({reducedMotion:'no-preference'});
 await reopen(b);await b.getByLabel('Recover management operation').selectOption(one.pending.id);
 await a.bringToFront();await a.getByRole('button',{name:'Retrieve operation receipt',exact:true}).click();await a.getByRole('status').filter({hasText:'Management operation denied'}).waitFor();assert.equal(Object.keys(await storage()).length,1);
 await b.bringToFront();await b.getByRole('button',{name:'Retrieve operation receipt',exact:true}).click();await b.getByRole('status').filter({hasText:'Management operation denied'}).waitFor();assert.equal(Object.keys(await storage()).length,1);
 await a.bringToFront();await a.getByLabel('Recover management operation').selectOption(two.pending.id);await a.getByRole('button',{name:'Retrieve operation receipt',exact:true}).click();await until(async()=>Object.keys(await storage()).length===0);
 result.checks.push('Two tabs retrieve the same operation independently; neither clears the other pending operation; mobile/reduced-motion recovery works');
 await a.getByRole('button',{name:'Review enabling team investigation',exact:true}).click();
 await a.evaluate(()=>{window.savedSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.includes('configuration-operation'))throw Error('fixture quota');return window.savedSetItem.call(this,k,v);};});
 let dispatched=0;await a.route('**/api/configuration/plans/*/apply',async route=>{dispatched++;await route.continue();});
 await a.getByRole('button',{name:'Apply reviewed change',exact:true}).click();await a.getByRole('alert').filter({hasText:'storage unavailable'}).waitFor();assert.equal(dispatched,0);assert.equal((await api('GET','/api/configuration')).body.selected.revision,current.revision);
 await a.evaluate(()=>{Storage.prototype.setItem=window.savedSetItem;delete window.savedSetItem;});await a.getByRole('button',{name:'Deny change',exact:true}).click();await a.getByRole('status').filter({hasText:'Management operation denied'}).waitFor();assert.equal(dispatched,1);await a.unroute('**/api/configuration/plans/*/apply');
 result.checks.push('Storage write failure prevents HTTP dispatch; restored storage allows exact reviewed denial');
 const malformed=base+'.unreadable-operation';await a.evaluate(key=>localStorage.setItem(key,'{bad retained bytes'),malformed);await a.reload();await a.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));await a.getByRole('button',{name:'Configuration',exact:true}).click();await a.getByRole('alert').filter({hasText:'unreadable'}).waitFor();assert.equal(await a.evaluate(k=>localStorage.getItem(k),malformed),'{bad retained bytes');assert(await a.getByRole('button',{name:'Review enabling team investigation',exact:true}).isDisabled());
 await a.screenshot({path:path.join(out,'desktop-preserved-uncertainty.png'),fullPage:true});result.checks.push('Malformed retained bytes survive reload and block a new management change with an actionable error');
 assert.deepEqual(errors,[]);assert.equal(fs.readFileSync(path.join(project,'sentinel'),'utf8'),'unchanged');result.passed=true;
 }catch(e){result.failure=String(e);if(browser){for(const [i,p] of browser.contexts()[0].pages().entries()){await p.screenshot({path:path.join(out,'failure-'+i+'.png'),fullPage:true}).catch(()=>{});result['layout-'+i]=await p.locator('.configuration-review').evaluate(el=>({html:el.outerHTML,rect:el.getBoundingClientRect().toJSON()})).catch(()=>null);}}throw e;}finally{result.duration_s=(Date.now()-start)/1000;await browser?.close();if(host.exitCode===null&&host.signalCode===null)await new Promise(resolve=>{const timer=setTimeout(()=>host.kill('SIGKILL'),10000);host.once('exit',()=>{clearTimeout(timer);resolve();});host.kill('SIGINT');});fs.closeSync(log);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}})().catch(e=>{console.error(e);process.exitCode=1;});
