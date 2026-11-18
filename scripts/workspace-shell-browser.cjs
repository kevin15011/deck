// Original session journey through the packaged host/UI, with a deterministic
// native transport. No provider or user-owned runner state is used.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const repo=path.resolve(__dirname,'..'),binary=path.resolve(process.argv[2]||'dist/deck2'),out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/workspace49/browser');fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-session-parity-')),project=path.join(root,'project');fs.mkdirSync(project);fs.copyFileSync(path.join(repo,'crates/host/tests/fake_session_native.py'),path.join(root,'codex'));fs.chmodSync(path.join(root,'codex'),0o700);
const host=spawn(binary,['serve','--project',project,'--state-dir',path.join(root,'state'),'--codex',path.join(root,'codex'),'--no-open'],{stdio:'ignore',env:{...process.env,CODEX_HOME:path.join(root,'native')}});
const wait=ms=>new Promise(r=>setTimeout(r,ms));let browser,page;
const result={binarySha256:crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),checks:[],passed:false};
(async()=>{try{
 for(let i=0;i<200&&!fs.existsSync(path.join(root,'state/launcher.json'));i++)await wait(100);
 const launcher=JSON.parse(fs.readFileSync(path.join(root,'state/launcher.json'))),base='http://'+launcher.host,link=await(await fetch(base+'/launch',{method:'POST',body:launcher.admin})).json();
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||'/snap/bin/chromium',headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1440,height:1000}}),testPage=await context.newPage(),errors=[];page=testPage;page.on('pageerror',e=>errors.push(e.message));
 await page.goto(link.url);await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));


 const assetFiles=fs.readdirSync(path.join(repo,'dist/assets'),{recursive:true}).filter(name=>fs.statSync(path.join(repo,'dist/assets',name)).isFile());
 for(const name of assetFiles){const response=await page.request.get(base+'/'+name);assert(response.ok());assert.equal(crypto.createHash('sha256').update(await response.body()).digest('hex'),crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,'dist/assets',name))).digest('hex'),'Embedded asset '+name);}
 result.embeddedAssets=assetFiles.length;
 const capture=async name=>{await page.waitForTimeout(400);await page.screenshot({path:path.join(out,name+'.png')});};
 const connected=()=>page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 await page.getByRole('button',{name:'+ New conversation',exact:true}).click();
 await page.getByLabel('Session name',{exact:true}).fill('Workspace continuity');
 await page.getByRole('button',{name:'Create session',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.querySelector('.app-header h1')?.textContent==='Workspace continuity');
 const prompt=page.locator('#prompt'),divider=page.getByRole('separator',{name:'Conversation width'});
 await prompt.fill('Draft survives original workspace journey');const original=await prompt.elementHandle();
 await divider.focus();await page.keyboard.press('Home');assert.equal(await divider.getAttribute('aria-valuenow'),'25');
 await page.keyboard.press('ArrowRight');assert.equal(await divider.getAttribute('aria-valuenow'),'27');
 await page.keyboard.press('End');await page.keyboard.press('ArrowLeft');assert.equal(await divider.getAttribute('aria-valuenow'),'73');
 const box=await page.locator('.panes').boundingBox(),handle=await divider.boundingBox();
 await page.mouse.move(handle.x+handle.width/2,handle.y+100);await page.mouse.down();await page.mouse.move(box.x+box.width*.61,handle.y+100,{steps:10});await page.mouse.up();
 assert(Math.abs(Number(await divider.getAttribute('aria-valuenow'))-61)<1);
 const split=Number(await divider.getAttribute('aria-valuenow'));
 const left=page.getByRole('button',{name:'Toggle conversation panel'}),right=page.getByRole('button',{name:'Toggle workspace panel'});
 for(let i=0;i<4;i++){await left.click();assert(await prompt.evaluate(el=>!!el.closest('[inert]')));await prompt.waitFor({state:'hidden'});assert(await right.isDisabled());await left.click();await right.click();assert(await left.isDisabled());await right.click();}
 await page.waitForTimeout(400);assert(await original.evaluate(el=>el===document.getElementById('prompt')));
 await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
 assert(await page.getByRole('button',{name:'Settings',exact:true}).isVisible());assert(await page.getByRole('button',{name:'Show projects',exact:true}).isVisible());
 await page.getByRole('button',{name:'Settings',exact:true}).click();await capture('desktop-collapsed-settings');
 await page.getByRole('button',{name:'Choose theme',exact:true}).click();
 const themeOption=label=>page.getByRole('option',{name:label,exact:true});
 await themeOption('Green').click();await page.waitForFunction(()=>document.adoptedStyleSheets.length===1);
 const clip1=await page.evaluate(()=>getComputedStyle(document.documentElement,'::view-transition-new(root)').clipPath);await page.waitForTimeout(130);
 const clip2=await page.evaluate(()=>getComputedStyle(document.documentElement,'::view-transition-new(root)').clipPath);assert.notEqual(clip1,clip2);
 await page.screenshot({path:path.join(out,'theme-wave-midpoint.png')});
 // Public live events must tear down snapshot rules synchronously, before typing continues.
 for(const type of ['beforeinput','keydown','pointerdown','wheel','resize','visibilitychange']){
  if(!(await page.evaluate(()=>document.adoptedStyleSheets.length))) {await themeOption(await page.evaluate(()=>document.documentElement.dataset.theme==='green'?'Dark':'Green')).click();await page.waitForFunction(()=>document.adoptedStyleSheets.length===1);}
  await page.evaluate(type=>{(type==='visibilitychange'?document:window).dispatchEvent(type==='beforeinput'?new InputEvent(type,{bubbles:true,data:'x',inputType:'insertText'}):new Event(type,{bubbles:true}));},type);
  assert.equal(await page.evaluate(()=>document.adoptedStyleSheets.length),0,type+' must cancel snapshots');
 }
 result.checks.push('Circular GSAP reveal and special wave animate; live input/pointer/scroll/resize/visibility cancel immediately');
 const palettes=['Dark','Light','Green','EVA-01','Cyberpunk','GitHub Dark','GitHub Light','One Dark Pro','One Dark Blood','Dracula','Catppuccin Mocha','Catppuccin Latte','Tokyo Night','Nord','Gruvbox Dark','Monokai Pro','Rosé Pine','Night Owl','Solarized Light'];
 for(const label of palettes)await themeOption(label).evaluate(el=>el.click());
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.adoptedStyleSheets.length===0);
 await themeOption('Dark').click();await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Theme',exact:true}).waitFor({state:'hidden'});
 assert(await page.getByRole('button',{name:'Choose theme',exact:true}).evaluate(el=>el===document.activeElement));
 await page.getByRole('button',{name:'Choose theme',exact:true}).click();const search=page.getByRole('combobox',{name:'Search themes'});
 await search.fill('rose');await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'rose-pine');
 await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Theme',exact:true}).waitFor({state:'hidden'});
 await page.getByRole('radio',{name:'Geist',exact:true}).check();await page.getByRole('button',{name:'Back to session',exact:true}).click();
 assert.equal(await prompt.inputValue(),'Draft survives original workspace journey');await page.reload();await connected();
 assert.equal(await page.locator('.app-header h1').innerText(),'Workspace continuity');assert.equal(await prompt.inputValue(),'Draft survives original workspace journey');
 assert(Math.abs(Number(await divider.getAttribute('aria-valuenow'))-split)<1);assert.equal(await page.evaluate(()=>document.documentElement.dataset.font),'geist');
 assert(await page.getByRole('button',{name:'Expand sidebar',exact:true}).isVisible());
 await page.getByRole('button',{name:'Show projects',exact:true}).click();await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('radio',{name:'System',exact:true}).check();await page.getByRole('button',{name:'Choose theme',exact:true}).click();await themeOption('Dark').click();await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Theme',exact:true}).waitFor({state:'hidden'});
 await capture('desktop-dark-settings');await page.getByRole('button',{name:'Back to session',exact:true}).click();await divider.dblclick();await capture('desktop-dark-home');
 result.checks.push('Normal relay session, pointer/two-point keyboard resize, both panel toggles, rail navigation/settings, 19 palettes, composite keyboard search, focus restore and durable draft/session/preferences');
 // Observe IME and typing through the mounted input, without a provider call.
 await page.emulateMedia({reducedMotion:'no-preference'});await prompt.focus();
 await prompt.dispatchEvent('compositionstart',{data:''});await prompt.dispatchEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true});await prompt.dispatchEvent('compositionend',{data:'あ'});
 await page.evaluate(()=>{window.hiddenRows=0;window.layoutErrors=[];window.addEventListener('error',e=>window.layoutErrors.push(e.message));new MutationObserver(rs=>{for(const r of rs)for(const n of r.addedNodes)if(n instanceof HTMLElement&&n.matches('.session')&&n.closest('[hidden],dialog:not([open])'))window.hiddenRows++;}).observe(document.body,{subtree:true,childList:true});});
 const start=performance.now();await prompt.pressSequentially(' — typing あ',{delay:15});const elapsed=performance.now()-start;
 result.typing={characters:12,wallMs:elapsed};assert(elapsed<2500,'Connected typing must remain responsive');
 await page.waitForTimeout(550);assert.equal(await page.evaluate(()=>window.hiddenRows),0);assert.deepEqual(await page.evaluate(()=>window.layoutErrors),[]);
 const typed=await prompt.inputValue();assert.equal((await(await page.request.get(base+'/api/workspace')).json()).receipts.length,0,'IME must not dispatch');
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await capture('mobile-dark-home');
 await page.getByRole('button',{name:'Toggle project navigation'}).click();await capture('mobile-dark-navigation');await page.getByRole('button',{name:'Settings',exact:true}).click();await capture('mobile-dark-settings');
 await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByRole('button',{name:'Choose theme'}).click();await themeOption('Light').click();await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Theme',exact:true}).waitFor({state:'hidden'});await capture('mobile-light-appearance');
 await page.getByRole('button',{name:'Back to settings',exact:true}).click();await page.getByRole('button',{name:'Back to session',exact:true}).click();
 await page.getByRole('tab',{name:'Activity',exact:true}).focus();await page.keyboard.press('ArrowLeft');assert(await prompt.isVisible());await page.reload();await connected();assert.equal(await prompt.inputValue(),typed);
 for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:1000});assert(await prompt.isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Choose theme'}).click();await themeOption('Light').click();await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Theme',exact:true}).waitFor({state:'hidden'});await capture('desktop-light-settings');await page.getByRole('button',{name:'Back to session',exact:true}).click();await capture('desktop-light-home');
 // Qualify the immediate fallback available in engines without View Transitions.
 await page.addInitScript(()=>Object.defineProperty(document,'startViewTransition',{value:undefined}));await page.reload();await connected();await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Choose theme'}).click();await themeOption('Nord').click();assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'nord');assert.equal(await page.evaluate(()=>document.adoptedStyleSheets.length),0);
 result.checks.push('IME sends no command, responsive connected typing without hidden-row mutation/layout loop, reduced motion, mobile settings/back, 320/768/1024/1440 layout, unsupported View Transition immediate fallback');
 assert.deepEqual(errors,[]);result.browser=browser.version();result.engines={chromium:'tested',firefox:'unavailable: no Firefox/Zen executable or Playwright Firefox cache installed'};result.passed=true;
 }catch(e){result.error=e.stack;await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw e;}finally{if(browser)await browser.close();host.kill('SIGTERM');await Promise.race([new Promise(r=>host.once('exit',r)),wait(3000)]);if(host.exitCode===null)host.kill('SIGKILL');fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');}})().catch(e=>{console.error(e);process.exitCode=1;});
