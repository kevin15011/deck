// P10/P16: real keys and default packaged composition; only native/network edges are synthetic.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),crypto=require('crypto'),{spawn,execFileSync}=require('child_process');
const repo=path.resolve(__dirname,'..'),binary=path.resolve(process.argv[2]||'dist/deck2'),out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/keyboard50/browser');fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-keyboard-')),project=path.join(root,'project');fs.mkdirSync(project);
const git=(...args)=>execFileSync('/usr/bin/git',args,{cwd:project,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
git('init','-q','-b','keyboard-unborn');
let native=fs.readFileSync(path.join(repo,'crates/host/tests/fake_session_native.py'),'utf8').replace(" elif m=='turn/start':", " elif m=='turn/interrupt':\n  result(v,{})\n  out({'method':'turn/completed','params':{'threadId':thread,'turn':{'id':'normal-turn','status':'interrupted'}}})\n elif m=='turn/start':").replace("  assert p['approvalPolicy']","  while (root/'prepare-gate').exists():time.sleep(.02)\n  assert p['approvalPolicy']").replace("  def tool(name,args):","  if 'Keyboard hold' in text:continue\n  def tool(name,args):");
fs.writeFileSync(path.join(root,'codex'),native,{mode:0o700});
const host=spawn(binary,['serve','--project',project,'--state-dir',path.join(root,'state'),'--codex',path.join(root,'codex'),'--no-open'],{stdio:'ignore',env:{...process.env,CODEX_HOME:path.join(root,'native')}});
const wait=ms=>new Promise(r=>setTimeout(r,ms));let browser,page;
const result={binarySha256:crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),checks:[],passed:false,root};const start=performance.now();
(async()=>{try{
 for(let i=0;i<200&&!fs.existsSync(path.join(root,'state/launcher.json'));i++)await wait(100);
 const launcher=JSON.parse(fs.readFileSync(path.join(root,'state/launcher.json'))),base='http://'+launcher.host,link=await(await fetch(base+'/launch',{method:'POST',body:launcher.admin})).json();
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||'/snap/bin/chromium',headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(link.url);await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 const ws=async()=>await(await page.request.get(base+'/api/workspace')).json();const until=async fn=>{for(let i=0;i<200;i++){const w=await ws();if(fn(w))return w;await wait(100);}throw Error('Workspace deadline');};
 const create=async title=>{await page.getByRole('button',{name:'+ New conversation',exact:true}).click();await page.getByLabel('Session name',{exact:true}).fill(title);await page.getByRole('button',{name:'Create session',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.waitForFunction(title=>document.querySelector('.app-header h1')?.textContent===title,title);return (await ws()).sessions.find(s=>s.title===title).id;};
 const first=await create('Keyboard session'),prompt=page.locator('#prompt');
 // A stable effect boundary: predecessor has no exact recall acknowledgement.
 if(process.env.DECK2_RED_ONLY){await page.request.post(base+'/api/queue',{headers:{Origin:base},data:{api:7,paused:true}});const w=await ws(),session=w.session;const r=await(await page.request.post(base+'/api/commands',{headers:{Origin:base},data:{api:7,id:'red-recall-input',session,prompt:'unread',mode:'read_only',queue:true,fresh:false}})).json();const response=await page.request.post(base+'/api/commands/red-recall-input/recall',{headers:{Origin:base},data:{api:7,session,attempt:r.attempt}});assert.equal(response.status(),200,'Exact unread cancellation acknowledgement');return;}
 await page.waitForFunction(()=>document.querySelector('.session-branch')?.textContent==='keyboard-unborn');
 await prompt.fill('Keyboard hold');await page.keyboard.press('Enter');await until(w=>w.receipts.some(r=>r.phase==='running'));assert.equal(await prompt.inputValue(),'');
 const submit=async text=>{const n=(await ws()).receipts.length;await prompt.fill(text);await page.keyboard.press('Enter');await until(w=>w.receipts.length===n+1);await page.waitForFunction(()=>document.querySelector('#prompt').value==='');};
 await submit('Older unread');
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Attach images',exact:true}).click();await(await chooser).setFiles({name:'recall.png',mimeType:'image/png',buffer:fs.readFileSync(path.join(repo,'scripts/fixtures/s8c-synthetic.png'))});await page.waitForFunction(()=>document.querySelector('.image-draft small')?.textContent==='Ready');await submit('Newest unread');
 let w=await ws(),newest=w.receipts.at(-1);assert.equal(newest.attachments.length,1);
 // Dialog dismissal and IME must not arm the underlying action.
 await page.getByRole('button',{name:'Session assignments',exact:true}).click();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});await page.keyboard.press('Escape');await wait(100);assert.equal((await ws()).receipts.find(r=>r.id===newest.id).phase,'queued');
 await prompt.press('a'); // resets the armed pair
 await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',isComposing:true,bubbles:true,cancelable:true})));await page.keyboard.press('Escape');await wait(100);assert.equal((await ws()).receipts.find(r=>r.id===newest.id).phase,'queued');await prompt.fill('');await prompt.press('a');await prompt.fill('');
 let release,seen;const observed=new Promise(r=>seen=r),gate=new Promise(r=>release=r);
 await page.route('**/api/commands/*/recall',async route=>{const response=await route.fetch();seen();await gate;await route.fulfill({response});});
 const pair=async()=>{await page.keyboard.press('Escape');await wait(40);await page.keyboard.press('Escape');};
 await pair();await observed;await prompt.fill('Edits during acknowledgement');assert.equal(await page.locator('.image-draft').count(),0);release();
 await page.waitForFunction(()=>document.querySelector('#prompt').value==='Newest unread\n\nEdits during acknowledgement');await page.waitForFunction(()=>document.querySelectorAll('.image-draft').length===1);await page.unroute('**/api/commands/*/recall');
 result.checks.push('Newest unread text/images restored only after exact acknowledgement; edits made while waiting preserved; dialog and IME Escape cannot cancel');
 // Selection changes while acknowledgement is pending must keep the originating scope.
 const second=await create('Other session');await prompt.fill('Other session draft');await page.getByRole('button',{name:/Keyboard session Codex/}).click();
 let release2,seen2;const observed2=new Promise(r=>seen2=r),gate2=new Promise(r=>release2=r);
 await page.route('**/api/commands/*/recall',async route=>{const response=await route.fetch();seen2();await gate2;await route.fulfill({response});});
 await pair();await observed2;await page.getByRole('button',{name:/Other session Codex/}).click();release2();await wait(700);assert.equal(await prompt.inputValue(),'Other session draft');await page.unroute('**/api/commands/*/recall');
 await page.getByRole('button',{name:/Keyboard session Codex/}).click();assert.equal(await prompt.inputValue(),'Older unread\n\nNewest unread\n\nEdits during acknowledgement');assert.equal(await page.locator('.image-draft').count(),1);
 result.checks.push('Late cancellation restores original session storage without injecting text/images or focus into newly selected session');
 // A native claim wins: exact recall refuses and does not interrupt it.
 w=await ws();const running=w.receipts.find(r=>r.phase==='running');assert(running);const rejected=await page.request.post(base+`/api/commands/${running.id}/recall`,{headers:{Origin:base},data:{api:7,session:first,attempt:running.attempt}});assert.equal(rejected.status(),409);assert.equal((await ws()).receipts.find(r=>r.id===running.id).phase,'running');
 await pair();await until(w=>w.receipts.find(r=>r.id===running.id).phase==='cancelled');
 result.checks.push('Native claimed input cannot be recalled; double Escape interrupts active Lead when queue is empty');
 // Pause the synthetic native thread handshake, not the Deck queue/dispatch boundary.
 fs.writeFileSync(path.join(root,'prepare-gate'),'');await prompt.fill('Pending handshake input');await page.keyboard.press('Enter');
 await until(w=>w.receipts.at(-1).phase==='preparing'&&w.receipts.at(-1).dispatch_ms===null);await pair();await page.waitForFunction(()=>document.querySelector('#prompt').value==='Pending handshake input');fs.unlinkSync(path.join(root,'prepare-gate'));
 await until(w=>w.receipts.at(-1).phase==='cancelled');assert.equal(fs.readFileSync(path.join(root,'dispatch-count'),'utf8').trim().split('\n').length,1);
 result.checks.push('Explicit pre-dispatch handshake input is revoked and restored; finishing native preparation cannot dispatch the revoked text/images');

 await prompt.fill('line');await page.keyboard.press('Shift+Enter');assert.equal(await prompt.inputValue(),'line\n');
 await page.evaluate(()=>document.querySelector('#prompt').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})));assert.equal((await ws()).receipts.length,4);
 await prompt.fill('Branch draft');
 // Same-session out-of-order focus responses: the newest refresh must win.
 let releaseBranch,seenBranch;const branchGate=new Promise(r=>releaseBranch=r),branchSeen=new Promise(r=>seenBranch=r);let held=false;
 await page.route('**/git-identity',async route=>{if(!held){held=true;seenBranch();await branchGate;await route.fulfill({json:{currentBranch:'stale-branch'}}).catch(()=>{});}else await route.continue();});
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await branchSeen;git('symbolic-ref','HEAD','refs/heads/focused-branch');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelector('.session-branch')?.textContent==='focused-branch');releaseBranch();await wait(200);assert.equal(await page.locator('.session-branch').innerText(),'focused-branch');await page.unroute('**/git-identity');assert.equal(await prompt.inputValue(),'Branch draft');
 fs.writeFileSync(path.join(project,'.git/HEAD'),'1'.repeat(40)+'\n');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.locator('.session-branch').waitFor({state:'hidden'});git('symbolic-ref','HEAD','refs/heads/restored-branch');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelector('.session-branch')?.textContent==='restored-branch');
 await page.screenshot({path:path.join(out,'desktop.png')});await page.reload();await page.waitForFunction(()=>document.querySelector('#prompt')?.value==='Branch draft');assert.equal((await ws()).receipts.length,4);
 result.checks.push('Selection/focus identity refresh, unborn/detached behavior and stale-reply rejection preserve draft and survive reload without replay');
 const touch=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,storageState:await context.storageState()});const mobile=await touch.newPage();await mobile.goto(base);await mobile.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));await mobile.locator('#prompt').fill('Touch newline');await mobile.locator('#prompt').press('Enter');assert.equal(await mobile.locator('#prompt').inputValue(),'Touch newline\n');assert.equal((await ws()).receipts.length,4);const navBounds=await mobile.getByRole('button',{name:'Toggle project navigation'}).boundingBox(),titleBounds=await mobile.locator('.session-title-line').boundingBox();result.mobileHeader={navBounds,titleBounds};assert(navBounds.x+navBounds.width<=titleBounds.x,'Branch/title must not overlap mobile navigation');await mobile.screenshot({path:path.join(out,'mobile.png')});await touch.close();
 assert.deepEqual(errors,[]);result.checks.push('Desktop Shift+Enter/IME and touch Enter preserve newlines; ordinary desktop Enter sends');result.passed=true;
}finally{result.duration_ms=performance.now()-start;if(page&&!result.passed){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'failure.txt'),await page.locator('body').innerText().catch(()=>''));}await browser?.close();host.kill('SIGTERM');await Promise.race([new Promise(r=>host.once('exit',r)),wait(3000)]);if(host.exitCode===null)host.kill('SIGKILL');fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}})().catch(e=>{console.error(e);process.exitCode=1;});
