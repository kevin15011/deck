// Protects the packaged read-only Review journey, async selection ownership and draft/image
// continuity. Oracle: real synthetic Git index/worktree contents; no provider dispatch.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'..'),binary=path.resolve(process.argv[2]||'dist/deck2'),out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/s8c/browser');fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-s8c-')),project=path.join(root,'project');fs.mkdirSync(project);
const env={PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
const git=(...args)=>execFileSync('/usr/bin/git',args,{cwd:project,env,stdio:'pipe'});
const longBase=Array.from({length:180},(_,line)=>'unchanged line '+(line+1));
const longFile=path.join(project,'long.txt');
fs.writeFileSync(longFile,longBase.join('\n')+'\n');
git('init','-q');fs.writeFileSync(path.join(project,'normal.txt'),'original\n');fs.writeFileSync(path.join(project,'deleted.txt'),'deleted\n');fs.mkdirSync(path.join(project,'src/deep'),{recursive:true});fs.writeFileSync(path.join(project,'src/deep/main.rs'),'fn main() {\n    let value = 1;\n}\n');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','base');
fs.writeFileSync(path.join(project,'normal.txt'),'staged\n');git('add','normal.txt');fs.writeFileSync(path.join(project,'normal.txt'),'working\n');fs.unlinkSync(path.join(project,'deleted.txt'));fs.writeFileSync(path.join(project,'- ü space.txt'),'<script>window.__gitInjected=true</script>\n');fs.writeFileSync(path.join(project,'binary.bin'),Buffer.from([0,1,2]));fs.writeFileSync(path.join(project,'src/deep/main.rs'),'fn main() {\n    let value = 2;\n}\n');
fs.writeFileSync(longFile,longBase.map((value,line)=>line===120?'Changed line 121':value).join('\n')+'\n');
fs.copyFileSync(path.join(repo,'crates/host/tests/fake_session_native.py'),path.join(root,'codex'));fs.chmodSync(path.join(root,'codex'),0o700);
const sentinel=path.join(root,'helper-executed'),helper=path.join(root,'evil-helper');fs.writeFileSync(helper,'#!/bin/sh\ntouch '+sentinel+'\n');fs.chmodSync(helper,0o700);const hostile={...process.env,GIT_EXTERNAL_DIFF:helper,GIT_CONFIG_COUNT:'2',GIT_CONFIG_KEY_0:'core.fsmonitor',GIT_CONFIG_VALUE_0:helper,GIT_CONFIG_KEY_1:'diff.external',GIT_CONFIG_VALUE_1:helper,GIT_INDEX_FILE:path.join(root,'outside-index')};
const history=path.join(root,'history');fs.mkdirSync(history);
const host=spawn(binary,['serve','--foreground','--project',project,'--state-dir',path.join(root,'state'),
 '--history-root',history,'--artifact-store',path.join(root,'tools'),'--codex',path.join(root,'codex'),'--no-open'],{stdio:'ignore',env:hostile});
let browser,page;const wait=ms=>new Promise(r=>setTimeout(r,ms)),digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const result={binarySha256:digest(fs.readFileSync(binary)),imageFixtureSha256:digest(fs.readFileSync(path.join(repo,'scripts/fixtures/s8c-synthetic.png'))),checks:[],captures:[],passed:false};
(async()=>{try{
 for(let i=0;i<200&&!fs.existsSync(path.join(root,'state/launcher.json'));i++)await wait(100);
 const launcher=JSON.parse(fs.readFileSync(path.join(root,'state/launcher.json'))),base='http://'+launcher.host,link=await(await fetch(base+'/launch',{method:'POST',body:launcher.admin})).json();
 assert.equal((await fetch(base+'/api/workspace')).status,403);
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||'/snap/bin/chromium',headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'no-preference'});
 await ctx.addInitScript(()=>{
  window.reviewCspViolations=[];
  document.addEventListener('securitypolicyviolation', event=>window.reviewCspViolations.push(event.violatedDirective+' '+event.blockedURI));
 });
 page=await ctx.newPage();page.setDefaultTimeout(12000);
 const errors=[],chunks=[],fileRequests=[],reviewRequests=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{if(new URL(response.url()).pathname.startsWith('/chunks/'))chunks.push(response);});
 page.on('request',request=>{
  const pathname=new URL(request.url()).pathname;
  if(pathname.includes('/review/'))reviewRequests.push(request.url());
  if(pathname.endsWith('/review/file'))fileRequests.push(request.url());
 });
 const connected=()=>page.locator('#prompt:visible').waitFor();
 await page.goto(link.url);await connected();const prompt=page.locator('#prompt');await prompt.fill('Draft must survive Review navigation.');
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Attach images',exact:true}).click();await(await chooser).setFiles({name:'fixture.png',mimeType:'image/png',buffer:fs.readFileSync(path.join(repo,'scripts/fixtures/s8c-synthetic.png'))});await page.waitForFunction(()=>document.querySelector('.image-draft small')?.textContent==='Ready');
 const indexBefore=digest(fs.readFileSync(path.join(project,'.git/index'))),workBefore=digest(fs.readFileSync(path.join(project,'normal.txt')));
 const open=page.getByRole('button',{name:'Open Review',exact:true});
 const review=page.getByRole('tab',{name:'Review',exact:true}),activity=page.getByRole('tab',{name:'Activity',exact:true});
 const panel=page.locator('#panel-review'), tree=panel.getByRole('tree',{name:'Review files'});
 const file=name=>tree.getByRole('treeitem').filter({hasText:name});
 const heading=panel.locator('.review-file-path'), code=panel.locator('.review-code');
 const inline=panel.getByRole('button',{name:'Inline',exact:true}), split=panel.getByRole('button',{name:'Side by side',exact:true});
 const refresh=panel.getByRole('button',{name:'Refresh',exact:true});
 const text=value=>page.waitForFunction(text=>document.querySelector('#panel-review .cm-content')?.textContent.includes(text),value);
 const capture=async name=>{await page.screenshot({path:path.join(out,name+'.png')});result.captures.push(name);};

 await page.waitForFunction(()=>document.querySelector('[aria-label="Open Review"] small')?.textContent==='6');
 assert.equal(fileRequests.length,0);
 const idle=reviewRequests.length;
 await wait(10200);
 assert.equal(reviewRequests.length,idle,'An idle workspace heartbeat must not trigger Review traffic');
 const startupChunks=new Set(chunks.map(chunk=>chunk.url()));
 await open.click();await tree.waitFor();
 await file('normal.txt').click();await text('working');
 assert.match(await code.innerText(),/original/);
 assert.doesNotMatch(await code.innerText(),/staged/);
 await page.waitForFunction(()=>[...document.querySelectorAll('.review-tree-row')].some(row=>row.textContent.includes('normal.txt')&&row.textContent.includes('+1')));
 assert(chunks.some(chunk=>!startupChunks.has(chunk.url())), 'Review loads a separate chunk after opening');
 const diffText=code.locator('.cm-insertedLine, .cm-changedText');
 assert(await diffText.count()>0,'CodeMirror renders intraline changes');
 assert.equal(await code.locator('.cm-content').first().getAttribute('contenteditable'),'false');

 const expand=page.getByRole('button',{name:'Expand inspector',exact:true});
 await expand.click();await page.waitForFunction(()=>!document.querySelector('#panel-review .review-layouts button:nth-child(2)').disabled);
 const beforeToggle=fileRequests.length;
 await split.click();await code.locator('.cm-mergeView').waitFor();
 assert.equal(await code.locator('.cm-content[contenteditable=false]').count(),2);
 assert.equal(fileRequests.length,beforeToggle);
 await capture('desktop-dark-split');
 await inline.click();await code.locator('.cm-mergeView').waitFor({state:'detached'});
 await review.focus();await page.keyboard.press('ArrowRight');assert.equal(await activity.getAttribute('aria-selected'),'true');
 assert(await activity.evaluate(el=>el===document.activeElement));
 await page.keyboard.press('ArrowLeft');assert.equal(await review.getAttribute('aria-selected'),'true');await text('working');


 await file('long.txt').click();
 const collapsed=code.getByRole('button',{name:/unchanged lines/}).first();
 await collapsed.focus();await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('#panel-review .cm-content')?.textContent.includes('unchanged line 19'));
 await code.locator('.cm-scroller').evaluate(node=>{node.scrollTop=380;});
 const anchorText=await code.locator('.cm-scroller').evaluate(node=>{
  const top=node.getBoundingClientRect().top;
  return [...node.querySelectorAll('.cm-line')].find(line=>line.getBoundingClientRect().bottom>top)?.textContent;
 });
 assert(anchorText?.startsWith('unchanged line '));
 await split.click();
 await page.waitForFunction(anchor=>{
  const viewport=document.querySelector('#panel-review .cm-mergeView');
  if(!viewport)return false;
  const top=viewport.getBoundingClientRect().top;
  const first=[...viewport.querySelectorAll('.cm-merge-b .cm-line')].find(line=>line.getBoundingClientRect().bottom>top);
  return first?.textContent===anchor;
 },anchorText);
 await inline.click();await file('normal.txt').click();await text('working');

 const first=await page.evaluate(async()=>await(await fetch('/api/workspace')).json());
 const endpoint=base+'/api/sessions/'+first.session+'/review/';
 const reviewGet=async route=>{
  let response=await page.request.get(endpoint+route);
  if(response.status()===429){
   await wait(1000*Number(response.headers()['retry-after']||'1'));
   response=await page.request.get(endpoint+route);
  }
  return response;
 };
 const old=await (await reviewGet('tree?view=changes')).json();
 const oldId=old.entries.find(entry=>entry.path==='normal.txt').id;
 const fileQuery=(generation,id)=>'file?'+new URLSearchParams({view:'changes',generation,id});
 fs.writeFileSync(path.join(project,'normal.txt'),'updated after refresh\n');
 await refresh.click();
 await heading.waitFor();assert.match(await heading.innerText(),/normal.txt/);
 await text('updated after refresh');
 const oldResponse=await reviewGet(fileQuery(old.generation,oldId));
 assert.equal(oldResponse.status(),200,'The previous generation can still observe a same-membership file');
 assert.equal((await oldResponse.json()).after.text,'updated after refresh\n');
 assert.equal((await page.request.get(endpoint.replace('/review/','/git'))).status(),410);

 let release;const delayed=new Promise(resolve=>{release=resolve;});
 let intercepted;const captured=new Promise(resolve=>{intercepted=resolve;});
 const delayFile=async route=>{
  if(intercepted===undefined)return route.continue();
  const signal=intercepted;intercepted=undefined;
  const response=await route.fetch();signal();
  await delayed;
  await route.fulfill({response}).catch(()=>{});
 };
 const matchFile=url=>url.pathname.endsWith('/review/file');
 await page.route(matchFile,delayFile);
 await file('deleted.txt').click();await captured;
 assert.match(await heading.innerText(),/normal.txt/);
 assert.match(await code.innerText(),/updated after refresh/);
 await file('normal.txt').click();release();await page.unroute(matchFile,delayFile);
 await text('updated after refresh');assert.match(await heading.innerText(),/normal.txt/);

 await panel.getByRole('searchbox',{name:'Filter files'}).fill('MAIN.RS');
 await tree.focus();await page.keyboard.press('End');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('.review-file-path')?.textContent.includes('main.rs'));
 await page.waitForFunction(()=>[...document.querySelectorAll('#panel-review .cm-changedText')].some(node=>node.textContent.includes('2')));
 await page.waitForFunction(()=>{
  const content=document.querySelector('#panel-review .cm-content');
  const span=content&&[...content.querySelectorAll('span')].find(node=>node.textContent==='fn');
  return span&&getComputedStyle(span).color!==getComputedStyle(content).color;
 });
 const nonceMatches=await page.evaluate(()=>{
  const nonce=document.querySelector('script[type=module]').nonce;
  return !!nonce&&[...document.querySelectorAll('style')].some(style=>style.nonce===nonce);
 });
 assert(nonceMatches);
 for(const chunk of chunks){
  assert.equal(chunk.status(),200);
  assert.match(chunk.headers()['content-type'],/javascript/);
  assert.match(chunk.headers()['cache-control'],/immutable/);
 }
 await panel.getByRole('searchbox',{name:'Filter files'}).fill('');
 await file('- ü space.txt').click();await text('<script>');
 assert.equal(await page.evaluate(()=>window.__gitInjected),undefined);
 await file('binary.bin').click();await panel.getByText(/Binary file/).waitFor();
 await panel.getByRole('button',{name:/^Diff/}).click();await panel.getByRole('alert').filter({hasText:'No local origin default branch'}).waitFor();
 git('update-ref','refs/remotes/origin/main','HEAD');
 await refresh.click();await panel.getByText('refs/remotes/origin/main',{exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.review-comparison code')?.textContent.length===40);
 await panel.getByRole('button',{name:/^All/}).click();await file('normal.txt').click();await text('updated after refresh');
 assert.doesNotMatch(await code.innerText(),/original/);
 await ctx.grantPermissions(['clipboard-read','clipboard-write']);
 await code.locator('.cm-content').focus();await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');
 assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/updated after refresh/);

 await panel.getByRole('button',{name:/^Changes/}).click();await file('normal.txt').click();await text('updated after refresh');
 await page.evaluate(()=>document.documentElement.dataset.theme='github-light');await capture('desktop-light-inline');
 await split.click();await code.locator('.cm-mergeView').waitFor();
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
 await code.locator('.cm-mergeView').waitFor({state:'detached'});
 assert(await split.isDisabled());assert(await tree.isVisible());
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await capture('mobile-light-inline');
 await page.setViewportSize({width:1440,height:1000});await code.locator('.cm-mergeView').waitFor();

 const draft=await prompt.inputValue();
 assert.equal(await page.locator('.image-draft').count(),1);
 assert.equal(digest(fs.readFileSync(path.join(project,'.git/index'))),indexBefore);
 assert.equal(workBefore,digest(Buffer.from('working\n')));
 assert.equal(fs.readFileSync(path.join(project,'normal.txt'),'utf8'),'updated after refresh\n');
 assert.deepEqual(await page.evaluate(()=>window.reviewCspViolations),[]);
 assert.deepEqual(errors,[]);
 await page.reload();await connected();assert.equal(await prompt.inputValue(),draft);
 assert.equal(await page.locator('.image-draft').count(),1);
 await open.click();await heading.waitFor();assert.match(await heading.innerText(),/normal.txt/);

 // The old interaction stays scoped when a new session opens during a catalog fetch.
 let oldSession='';let releaseCatalog;
 const holdCatalog=new Promise(resolve=>{releaseCatalog=resolve;});
 const catalogRequest=url=>url.pathname===new URL(endpoint+'tree').pathname&&url.searchParams.get('limit')==='0'&&url.searchParams.get('view')==='changes';
 const delayCatalog=async route=>{
  if(oldSession)return route.continue();
  oldSession=route.request().url();
  try{const response=await route.fetch();await holdCatalog;await route.fulfill({response});}catch{}
 };
 await page.route(catalogRequest,delayCatalog);
 await Promise.all([page.waitForRequest(request=>catalogRequest(new URL(request.url()))),refresh.click()]);
 if(await open.getAttribute('aria-expanded')==='true')await open.click();
 const newSession=page.getByRole('button',{name:/^New session in /}).first();
 await newSession.focus();await newSession.press('Enter');
 await page.getByLabel('Session name',{exact:true}).fill('Conversation 2');
 await page.getByRole('button',{name:'Create session',exact:true}).click();
 await page.getByRole('heading',{name:'Conversation 2',exact:true}).waitFor();
 releaseCatalog();await page.unroute(catalogRequest,delayCatalog);
 assert(oldSession);
 const workspace=await (await page.request.get(base+'/api/workspace')).json();
 assert.equal(workspace.receipts.length,0);
 await page.getByRole('button',{name:'Project conversation',exact:true}).click();
 await page.waitForFunction(value=>document.querySelector('#prompt')?.value===value,draft);
 assert.equal(await page.locator('.image-draft').count(),1);
 assert(!fs.existsSync(sentinel));assert(!fs.existsSync(path.join(root,'outside-index')));
 result.checks.push('Net HEAD/worktree content, line stats, read-only keyboard copy, no fetch on layout toggle',
  'Keyboard context expansion and scroll anchor preserved in Split',
  'Delayed file reply keeps heading and text owned by the visible document',
  'Keyboard filtering, lazy Rust syntax colors, CSP nonce, immutable JavaScript chunks and zero idle heartbeat requests',
  'Typed binary, inert HTML, All content, unavailable and available Diff, legacy HTTP 410',
  'Responsive layout preserves Split preference, selected file and draft survive reload, delayed catalog stays in its session',
  'Index unchanged, no provider dispatch, inherited Git overrides ignored');
 result.passed=true;
}catch(error){
 result.failure=String(error);
 if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
 throw error;
}finally{if(browser)await browser.close();host.kill('SIGTERM');await Promise.race([new Promise(r=>host.once('exit',r)),wait(3000)]);if(host.exitCode===null)host.kill('SIGKILL');fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');}})().catch(e=>{console.error(e);process.exitCode=1;});
