// S1-Q04..06: real packaged HTTP/React UI, deterministic owned native edge.
// Protects corrected submissions, stable focused controls, safe formatted output.
const {chromium}=require(process.env.DECK2_PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-regression-'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const evidence=(process.env.DECK2_EVIDENCE_DIR||path.join(repo,'target/browser-regressions'));fs.mkdirSync(evidence,{recursive:true});
fs.mkdirSync(path.join(root,'project'));fs.copyFileSync(path.join(repo,'crates/host/tests/fake_native.py'),path.join(root,'codex'));fs.chmodSync(path.join(root,'codex'),0o700);
fs.writeFileSync(path.join(root,'mode'),'stream');
const host=spawn(process.argv[2] || path.join(repo,'dist/deck2'),['serve','--foreground','--project',path.join(root,'project'),'--state-dir',path.join(root,'state'),'--codex',path.join(root,'codex'),'--no-open']);
let browser;const checks=[];
(async()=>{try {
 for(let i=0;i<100&&!fs.existsSync(path.join(root,'state/launcher.json'));i++)await wait(100);
 const record=JSON.parse(fs.readFileSync(path.join(root,'state/launcher.json')));
 const link=await (await fetch('http://'+record.host+'/launch',{method:'POST',body:record.admin})).json();
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM || '/snap/bin/chromium',headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',permissions:['clipboard-read','clipboard-write']}),page=await ctx.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(link.url);await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 const input=page.getByRole('textbox'),send=page.getByRole('button',{name:'Send question'});
 await input.fill('Stream focus fixture');await send.click();
 await page.waitForFunction(()=>document.querySelector('.task .phase')?.textContent==='Preparing');
 await page.locator('.task').getByRole('button',{name:'Receipt and timing'}).click();await page.locator('.task').getByRole('button',{name:'Cancel task'}).focus();
 assert.match(await page.locator('.task .receipt-details').textContent(),/Handshake: pending/);
 fs.writeFileSync(path.join(root,'allow-prepare'),'ready');
 await page.waitForFunction(()=>document.querySelector('.answer')?.textContent.includes('stream-'));
 assert(await page.locator('.task .receipt-details>button').getAttribute('aria-expanded').then(v=>v==='true'));
 assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Cancel task');
 assert(!/Handshake: pending/.test(await page.locator('.task .receipt-details').textContent()));
 const initial=await page.locator('.answer').textContent();
 await page.waitForFunction(text=>document.querySelector('.answer')?.textContent.length>text.length+25,initial);
 assert(await page.locator('.task .receipt-details>button').getAttribute('aria-expanded').then(v=>v==='true'),'expanded receipt lost during stream');
 assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Cancel task');
 assert.match(await page.locator('.task .receipt-details').textContent(),/acknowledged read-only/);
 checks.push('expanded receipt and Cancel focus survive repeated live revisions; fields update');
 await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('.task .phase')?.textContent==='Cancelled');
 assert.equal(await page.locator('.task').getByRole('button',{name:'Cancel task'}).count(),0);
 assert(await page.locator('.task .receipt-details>button').getAttribute('aria-expanded').then(v=>v==='true'));
 checks.push('native interruption settles and Cancel disappears; details remain open');
 fs.writeFileSync(path.join(root,'mode'),'normal');
 // A valid 16 KiB prompt with the worst JSON expansion must pass the real HTTP route.
 await input.fill('\0'.repeat(16384));await send.click();
 await page.waitForFunction(()=>document.querySelectorAll('.exchange').length===2);
 await page.waitForFunction(()=>[...document.querySelectorAll('.assistant-message .phase')].at(-1)?.textContent==='Completed');
 checks.push('16 KiB escape-heavy prompt accepted over packaged HTTP');
 // More than 16 KiB UTF-8, despite fewer browser characters: definite rejection.
 await input.fill('é'.repeat(9000));await send.click();
 await page.waitForFunction(()=>document.querySelector('.alert')?.textContent.includes('16 KiB'));
 assert.equal(await input.inputValue(),'é'.repeat(9000));
 assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('deck2.host.')&&k.endsWith('.pending')).map(k=>localStorage.getItem(k)).find(Boolean)||''),'');
 await page.reload();await input.waitFor();
 await input.fill('Corrected after rejection');await send.click();
 await page.waitForFunction(()=>document.querySelectorAll('.exchange').length===3);
 checks.push('prompt rejection retains draft; reload/edit/resubmit succeeds');
 // Force the real body-limit rejection, then correct without clearing storage.
 await page.route('**/api/commands',async route=>{
  const body=JSON.parse(route.request().postData());body.prompt='x'.repeat(110000);
  await route.continue({postData:JSON.stringify(body)});
 });
 await page.waitForFunction(()=>[...document.querySelectorAll('.assistant-message .phase')].at(-1)?.textContent==='Completed');
 await input.fill('Transport body rejection');await send.click();
 await page.waitForFunction(()=>document.querySelector('.alert')?.textContent.includes('413'));
 assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('deck2.host.')&&k.endsWith('.pending')).map(k=>localStorage.getItem(k)).find(Boolean)||''),'');
 assert.equal(await input.inputValue(),'Transport body rejection');
 await page.unroute('**/api/commands');await input.fill('Corrected after 413');await send.click();
 await page.waitForFunction(()=>document.querySelectorAll('.exchange').length===4);
 checks.push('HTTP 413 clears only pending identity and permits edited resubmission');
 // Unknown delivery must retain identity and protect against edited replay.
 await page.waitForFunction(()=>[...document.querySelectorAll('.assistant-message .phase')].at(-1)?.textContent==='Completed');
 await page.route('**/api/commands',route=>route.fulfill({status:503,body:'Unknown delivery'}));
 await input.fill('Uncertain draft');await send.click();await page.waitForFunction(()=>document.querySelector('.alert')?.textContent.includes('503'));
 const pending=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('deck2.host.')&&k.endsWith('.pending')).map(k=>localStorage.getItem(k)).find(Boolean)||'');assert(pending);
 await input.fill('Changed uncertain draft');await send.click();await page.waitForFunction(()=>document.querySelector('.alert')?.textContent.includes('unresolved identity'));
 assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('deck2.host.')&&k.endsWith('.pending')).map(k=>localStorage.getItem(k)).find(Boolean)||''),pending);
 await page.unroute('**/api/commands');
 await page.route('**/api/commands',route=>route.abort());
 await input.fill('Uncertain draft');await send.click();
 await page.waitForFunction(()=>document.querySelector('.alert')?.textContent.includes('Connection lost'));
 assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('deck2.host.')&&k.endsWith('.pending')).map(k=>localStorage.getItem(k)).find(Boolean)||''),pending);
 await page.unroute('**/api/commands');
 await send.click();await page.waitForFunction(()=>document.querySelectorAll('.exchange').length===5);
 checks.push('5xx and network uncertainty retain identity; changed draft blocked; original retry works');
 fs.writeFileSync(path.join(root,'mode'),'format');
 fs.copyFileSync(path.join(repo,'scripts/fixtures/conversation.md'),path.join(root,'fixture.md'));
 await page.waitForFunction(()=>[...document.querySelectorAll('.assistant-message .phase')].at(-1)?.textContent==='Completed');
 await input.fill('Public formatting fixture');await send.click();await page.waitForFunction(()=>document.querySelectorAll('.exchange').length===6);
 await page.waitForFunction(()=>[...document.querySelectorAll('.assistant-message .phase')].at(-1)?.textContent==='Completed');
 const answer=page.locator('.answer').last();
 assert.equal(await answer.locator('h2').textContent(),'Project overview');
 assert.equal(await answer.locator('strong').first().textContent(),'read-only');
 assert.equal(await answer.locator('em').first().textContent(),'bounded');
 assert.equal(await answer.locator('ul li').count(),2);
 assert.equal(await answer.locator('pre code').count(),1);
 assert.equal(await answer.locator('script,img,iframe,svg,style').count(),0);
 assert.equal(await answer.locator('a').evaluateAll(links=>links.every(a=>!a.href || /^(https?:|mailto:)/.test(a.href))),true);
 assert.equal(await page.evaluate(()=>globalThis.deck2Injected),undefined);
 const expectedCode=fs.readFileSync(path.join(repo,'scripts/fixtures/conversation.md'),'utf8').match(/```[^\n]*\n([\s\S]*?)\n```/)[1];
 await answer.getByRole('button',{name:'Copy code',exact:true}).click();
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),expectedCode);
 checks.push('headings/emphasis/list/code render; raw HTML, images and unsafe links cannot execute; code copy preserves source');
 await page.locator('.exchange').last().scrollIntoViewIfNeeded();
 for(const [name,size] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
  await page.setViewportSize(size);
  for(const theme of ['dark','light']) {
   if(name==='mobile')await page.getByRole('button',{name:'Toggle project navigation'}).click();
   await page.getByRole('button',{name:'Settings',exact:true}).click();
   if(name==='mobile')await page.getByRole('button',{name:'Appearance',exact:true}).click();
   await page.getByRole('button',{name:'Choose theme',exact:true}).click();
   await page.getByRole('button',{name:theme==='dark'?'Dark':'Light',exact:true}).click();
   await page.getByRole('button',{name:'Done',exact:true}).click();
   if(name==='mobile')await page.getByRole('button',{name:'Back to settings',exact:true}).click();
   await page.getByRole('button',{name:'Back to session',exact:true}).click();
   await page.locator('.exchange').last().scrollIntoViewIfNeeded();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(evidence,name+'-'+theme+'.png')});
  }
 }
 assert.deepEqual(errors,[]);
 const receipts=await page.evaluate(async()=>await(await fetch('/api/workspace')).json());
 fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({passed:true,checks,root,receipts},null,2));
 console.log(JSON.stringify({passed:true,checks,evidence},null,2));
} finally {if(browser)await browser.close();host.kill('SIGINT');}})().catch(e=>{console.error(e);process.exitCode=1;});
