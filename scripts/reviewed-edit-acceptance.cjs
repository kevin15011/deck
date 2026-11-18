// Real packaged-host and Codex approval journey on an owned fixture only.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-reviewed-browser-'));
const project=path.join(root,'project'),state=path.join(root,'state');fs.mkdirSync(project);
const file=path.join(project,'example.txt');fs.writeFileSync(file,'before\n');
const evidence=process.env.DECK2_EVIDENCE_DIR||path.join(repo,'target/s2-verification');fs.mkdirSync(evidence,{recursive:true});
const start=Date.now(),host=spawn(path.join(repo,'dist/deck2'),['serve','--project',project,'--state-dir',state,'--codex','/home/kevin15011/.local/bin/codex','--no-open']);
let browser;const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{try{
 for(let i=0;i<100&&!fs.existsSync(path.join(state,'launcher.json'));i++)await wait(100);
 const launcher=JSON.parse(fs.readFileSync(path.join(state,'launcher.json'))),base='http://'+launcher.host;
 const launch=await fetch(base+'/launch',{method:'POST',body:launcher.admin});assert.equal(launch.status,200);const {url}=await launch.json();
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||'/snap/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
 await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 const snapshot=()=>page.evaluate(async()=>await (await fetch('/api/workspace')).json());
 await page.getByLabel('Execution mode').selectOption('reviewed_edit');
 assert(await page.getByRole('button',{name:'Send question'}).isDisabled());
 await page.getByLabel('Trust this project for reviewed editing').check();
 if(process.argv.includes('--questions')){
  await page.getByLabel('Ask a read-only question').fill('Use the request_user_input tool to ask one question: Which word should a future edit use? Offer Copper and Amber. Do not edit any file. After receiving the answer, repeat it and stop.');
  await page.getByRole('button',{name:'Send question'}).click();
  await page.getByRole('region',{name:'Answer questions'}).waitFor({timeout:120000});
  const question=page.getByRole('region',{name:'Answer questions'});
  await question.locator('input').fill('Copper');
  await question.getByRole('button',{name:'Send answers'}).click();
  await page.waitForFunction(()=>document.querySelector('.assistant-message > .message-meta .phase')?.textContent==='Completed',{},{timeout:90000});
  const w=await snapshot();assert.equal(w.receipts.length,1);assert(w.receipts[0].decisions.every(d=>d.file===null&&!d.grant_consumed&&d.state==='settled'));
  assert.equal(fs.readFileSync(file,'utf8'),'before\n');assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(evidence,'question-result.png')});
  fs.writeFileSync(path.join(evidence,'real-question.json'),JSON.stringify({project,state,duration_s:(Date.now()-start)/1000,workspace:w},null,2));
  console.log(JSON.stringify({passed:true,questions:true,duration_s:(Date.now()-start)/1000}));return;
 }
 async function propose(text){
  await page.getByLabel('Ask a read-only question').fill(text);await page.getByLabel('Ask a read-only question').focus();await page.waitForFunction(()=>!document.querySelector('button[aria-label="Send question"]').disabled);await page.keyboard.press('Control+Enter');
  await page.waitForFunction(()=>{const r=document.querySelectorAll('.review');return [...r].some(v=>v.querySelector('.phase')?.textContent==='pending');},{},{timeout:120000});
  return page.locator('.review').last();
 }
 const prompt='Use apply_patch to replace the entire contents of example.txt with exactly "after\\n". Do not use shell writes. Stop if denied.';
 let review=await propose(prompt);assert.equal(fs.readFileSync(file,'utf8'),'before\n');
 assert((await review.locator('pre').innerText()).includes('-before'));
 await page.screenshot({path:path.join(evidence,'pending-proposal.png')});
 // A reload recovers the same durable decision without granting it.
 const beforeReload=await snapshot(),decisionId=beforeReload.receipts[0].decisions[0].id;
 await page.reload();await page.getByRole('button',{name:'Deny',exact:true}).waitFor();
 assert.equal((await snapshot()).receipts[0].decisions[0].id,decisionId);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.getByRole('button',{name:'Deny',exact:true}).focus();await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('.assistant-message > .message-meta .phase')?.textContent==='Completed',{},{timeout:90000});
 assert.equal(fs.readFileSync(file,'utf8'),'before\n');
 await page.waitForFunction(()=>document.querySelector('.review-actions')?.hidden);
 await page.emulateMedia({reducedMotion:'reduce'});
 review=await propose(prompt);await review.getByRole('button',{name:'Allow once',exact:true}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.assistant-message > .message-meta .phase')].at(-1)?.textContent==='Completed',{},{timeout:90000});
 assert.equal(fs.readFileSync(file,'utf8'),'after\n');
 review=page.locator('.review').last();
 await page.emulateMedia({reducedMotion:'no-preference'});
 for(let i=0;i<6;i++)await review.getByRole('button',{name:i%2?'Observed change':'Proposed change',exact:true}).click();
 await page.waitForFunction(()=>getComputedStyle([...document.querySelectorAll('.review-diff')].at(-1)).opacity==='1');
 await page.emulateMedia({reducedMotion:'reduce'});
 await review.getByRole('button',{name:'Observed change',exact:true}).click();
 assert((await review.locator('pre').innerText()).includes('+after'));
 await page.screenshot({path:path.join(evidence,'observed-result.png')});
 // Cancellation of a third pending proposal cannot release the effect.
 review=await propose('Use apply_patch to change example.txt from after to cancelled. Do not use shell writes. Stop if denied.');
 await page.getByRole('button',{name:'Cancel task',exact:true}).first().click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.assistant-message > .message-meta .phase')].at(-1)?.textContent==='Cancelled',{},{timeout:20000});
 assert.equal(fs.readFileSync(file,'utf8'),'after\n');
 // Responsive navigation, immediate keyboard access and reduced motion.
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('tab',{name:'Activity',exact:true}).click();await page.getByRole('tab',{name:'Conversation',exact:true}).click();
 await page.getByLabel('Ask a read-only question').fill('retained reviewed draft');await page.reload();await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 assert.equal(await page.getByLabel('Ask a read-only question').inputValue(),'retained reviewed draft');
 assert(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:path.join(evidence,'mobile-result.png')});
 const w=await snapshot();assert.equal(w.receipts.length,3);assert(w.receipts[1].decisions[0].grant_consumed);assert(!w.receipts[0].decisions[0].grant_consumed);assert(!w.receipts[2].decisions[0].grant_consumed);
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(evidence,'real-browser.json'),JSON.stringify({project,state,duration_s:(Date.now()-start)/1000,checks:['real native proposal before write','deny preserves target','allow once applies reviewed effect','pending reload recovers identity','keyboard deny','observed diff','cancel pending prevents effect','mobile tabs','draft reload','reduced motion','no horizontal overflow','no page exceptions','rapid diff reversals','animated action dismissal','live reduced-motion changes'],workspace:w},null,2));
 console.log(JSON.stringify({passed:true,duration_s:(Date.now()-start)/1000,receipts:w.receipts.map(r=>({id:r.id,phase:r.phase,decisions:r.decisions.length})),evidence},null,2));
}finally{if(browser)await browser.close();host.kill('SIGINT');await Promise.race([new Promise(r=>host.once('exit',r)),wait(10000)]);if(host.exitCode===null)host.kill('SIGKILL');}})().catch(e=>{console.error(e);process.exitCode=1;});
