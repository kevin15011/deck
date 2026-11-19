// Protects production CLI launch, bare-link denial/recovery, draft/identity retention,
// one-use authentication, cookie loss and host/origin rejection. Native effects are fake.
const {chromium}=require(process.env.DECK2_PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile),repo=path.resolve(__dirname,'..');
const binary=path.resolve(process.argv[2] || path.join(repo,'dist/deck2'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-auth-')),state=path.join(root,"state ' $() ` ; space");
const wait=ms=>new Promise(r=>setTimeout(r,ms));
fs.mkdirSync(path.join(root,'project'));fs.mkdirSync(path.join(root,'bin'));
fs.copyFileSync(path.join(repo,'crates/host/tests/fake_native.py'),path.join(root,'codex'));fs.chmodSync(path.join(root,'codex'),0o700);
fs.writeFileSync(path.join(root,'mode'),'normal');
// Capture the actual URL passed to the opener without printing its capability.
fs.writeFileSync(path.join(root,'bin/xdg-open'),'#!/usr/bin/env python3\nimport os,sys\nif os.environ.get("DECK2_OPENER_FAIL"): sys.exit(3)\nwith open(os.environ["DECK2_CAPTURE"],"w") as f: f.write(sys.argv[1])\n',{mode:0o700});
const capture=path.join(root,'opened-url'),env={...process.env,PATH:path.join(root,'bin')+':'+process.env.PATH,DECK2_CAPTURE:capture};
const host=spawn(binary,['serve','--foreground','--project',path.join(root,'project'),'--state-dir',state,'--codex',path.join(root,'codex')],{env,stdio:'ignore'});
const checks=[];let browser;
(async()=>{try{
 for(let i=0;i<100&&!fs.existsSync(capture);i++)await wait(100);
 assert(fs.existsSync(capture),'serve must invoke desktop opener');
 const record=JSON.parse(fs.readFileSync(path.join(state,'launcher.json'))),base='http://'+record.host;
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM || '/snap/bin/chromium',headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({reducedMotion:'reduce'}),page=await ctx.newPage();
 page.setDefaultTimeout(10000);
 let requests=0;page.on('request',r=>{if(r.url().endsWith('/api/workspace'))requests++;});
 // The terminal advertises this bare URL. It must give actionable recovery, block
 // Send and stop making forbidden requests until the user reauthenticates.
 await page.goto(base);await page.getByRole('textbox').waitFor();
 await page.getByRole('textbox').fill('Keep my unauthenticated draft');
 await page.waitForFunction(()=>document.querySelector('.alert')?.textContent.includes('HTTP 403'));
 const first=requests;await wait(1600);
 assert.equal(requests,first,'unauthenticated page must suspend forbidden polling');
 assert(await page.getByRole('button',{name:'Send question'}).isDisabled());
 assert.equal((await(await fetch(base+'/api/workspace')).json()).code,'session_required');
 checks.push('bare URL blocks Send, explains authentication and suspends 403 polling');
 // Existing tab receives a valid fragment from the real serve opener.
 await page.goto(fs.readFileSync(capture,'utf8'));
 await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 assert.equal(new URL(page.url()).hash,'');
 await page.getByRole('button',{name:'Copy saved draft here',exact:true}).click();
 assert.equal(await page.getByRole('textbox').inputValue(),'Keep my unauthenticated draft');
 const cookie=(await ctx.cookies()).find(c=>c.name.startsWith('deck2_'));
 assert(cookie?.httpOnly && cookie.sameSite==='Strict');
 checks.push('automatic serve opener authenticates existing bare tab; explicit unassigned draft adoption preserves input');
 const reused=await browser.newContext(),reusedPage=await reused.newPage();
 await reusedPage.goto(fs.readFileSync(capture,'utf8'));
 await reusedPage.getByRole('alert').waitFor();
 assert((await reusedPage.getByRole('alert').textContent()).includes(binary));
 assert((await reusedPage.getByRole('alert').textContent()).includes(state.replaceAll("'","'\\''"))); // exact shell-quoted state from this host

 assert(await reusedPage.getByRole('button',{name:'Send question'}).isDisabled());
 await reused.close();checks.push('used capability cannot authenticate a second browser');
 // Simulate a lost acknowledgement, then cookie expiry before reconnect.
 await page.route('**/api/commands',route=>route.fulfill({status:503,body:'Unknown delivery'}));
 await page.getByRole('textbox').fill('Identity survives authentication recovery');
 await page.getByRole('button',{name:'Send question'}).click();
 await page.waitForFunction(()=>Object.keys(localStorage).filter(k=>k.startsWith('deck2.host.')&&k.includes('.pending-command.')).map(k=>JSON.parse(localStorage.getItem(k)||'null')?.id).find(Boolean)||'');
 const pending=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('deck2.host.')&&k.includes('.pending-command.')).map(k=>JSON.parse(localStorage.getItem(k)||'null')?.id).find(Boolean)||'');
 await page.unroute('**/api/commands');
 await page.route('**/api/commands',route=>route.fulfill({status:403,body:'Session expired'}));
 await page.getByRole('button',{name:'Send question'}).click();
 await page.waitForFunction(()=>document.querySelector('.alert')?.textContent.includes('HTTP 403'));
 assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('deck2.host.')&&k.includes('.pending-command.')).map(k=>JSON.parse(localStorage.getItem(k)||'null')?.id).find(Boolean)||''),pending);
 await page.unroute('**/api/commands');await ctx.clearCookies();await page.getByRole('button',{name:'Reconnect',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.alert')?.textContent.includes('Browser authentication required'));
 const stopped=requests;await wait(1100);assert.equal(requests,stopped);
 assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('deck2.host.')&&k.includes('.pending-command.')).map(k=>JSON.parse(localStorage.getItem(k)||'null')?.id).find(Boolean)||''),pending);
 // Fresh capability via the actual Open command, same tab (hash navigation).
 await run(binary,['open','--state-dir',state],{env});
 await page.goto(fs.readFileSync(capture,'utf8'));
 await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 assert.equal(await page.getByRole('textbox').inputValue(),'Identity survives authentication recovery');
 assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('deck2.host.')&&k.includes('.pending-command.')).map(k=>JSON.parse(localStorage.getItem(k)||'null')?.id).find(Boolean)||''),pending);
 await page.getByRole('button',{name:'Send question'}).click();
 await page.waitForFunction(()=>document.querySelector('.assistant-message .phase')?.textContent==='Completed');
 let workspace=await page.evaluate(async()=>await(await fetch('/api/workspace')).json());
 assert.equal(workspace.receipts.length,1);assert.equal(workspace.receipts[0].id,pending);
 await page.reload();await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 workspace=await page.evaluate(async()=>await(await fetch('/api/workspace')).json());assert.equal(workspace.receipts.length,1);
 checks.push('cookie loss pauses polling; CLI reopen retains uncertain identity and sends once; reload stays authenticated');
 // No opener available: explicit private link fallback works, including paths with spaces.
 let openerFailed=false;
 try { await run(binary,['open','--state-dir',state],{env:{...env,DECK2_OPENER_FAIL:'1'}}); }
 catch(e){openerFailed=true;assert.equal(e.code,1);assert.match(e.stderr,/--print-url/);}
 assert(openerFailed,'opener failure must be reported');
 const printed=await run(binary,['open','--state-dir',state,'--print-url'],{env:{...env,DECK2_OPENER_FAIL:'1'}});
 const manual=await browser.newContext(),manualPage=await manual.newPage();
 await manualPage.goto(printed.stdout.trim());await manualPage.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 await manual.close();checks.push('explicit --print-url authenticates a browser without invoking desktop opener');
 for(const [headers,code] of [[{Host:'unlisted.invalid:'+record.host.split(':')[1]},'host_denied'],[{Origin:'http://other.invalid'},'origin_denied'],[{'Sec-Fetch-Site':'cross-site'},'fetch_site_denied']]){
  const response=await new Promise((resolve,reject)=>{const req=require('node:http').request(base+'/api/commands',{method:'POST',headers:{Origin:base,Cookie:cookie.name+'='+cookie.value,'Content-Type':'application/json',...headers}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));});req.on('error',reject);req.end(JSON.stringify({api:1,id:'forbidden',prompt:'Must not dispatch'}));});
  assert.equal(response.status,403);assert.equal(response.body.code,code);
 }
 checks.push('wrong host, cross-origin and cross-site dispatch denied with secret-free distinct diagnostics');
 const evidence=path.resolve(process.env.DECK2_EVIDENCE_DIR||path.join(repo,'target/auth-launch-regressions'));fs.mkdirSync(evidence,{recursive:true});
 await page.screenshot({path:path.join(evidence,'recovered.png')});
 fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({passed:true,checks,root,receipts:workspace.receipts.map(r=>({id:r.id,phase:r.phase}))},null,2));
 console.log(JSON.stringify({passed:true,checks,evidence},null,2));
}finally{if(browser)await browser.close();host.kill('SIGINT');fs.rmSync(capture,{force:true});}})().catch(e=>{console.error(e.message);process.exitCode=1;});
