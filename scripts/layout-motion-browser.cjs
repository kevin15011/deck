// Public packaged S8a journey. Oracle: appearance/layout acceptance and existing draft/IME contracts.
// Fails if preferences lose their original compatibility/defaults, controls are inaccessible, draft/stream identity changes,
// composer covers messages, or hidden navigation reinserts during connected editing. No real provider.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..'),out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/layout-motion/browser'),binary=path.resolve(process.argv[2]||'dist/deck2');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-layout-'));fs.mkdirSync(out,{recursive:true});fs.mkdirSync(path.join(root,'project'));
fs.copyFileSync(path.join(repo,'crates/host/tests/fake_native.py'),path.join(root,'codex'));fs.chmodSync(path.join(root,'codex'),0o700);
fs.writeFileSync(path.join(root,'mode'),'stream');fs.writeFileSync(path.join(root,'allow-prepare'),'ready');
const host=spawn(binary,['serve','--project',path.join(root,'project'),'--state-dir',path.join(root,'state'),'--codex',path.join(root,'codex'),'--no-open'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));let browser;
const result={binarySha256:crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),checks:[],captures:[],passed:false};
(async()=>{try{
 for(let i=0;i<100&&!fs.existsSync(path.join(root,'state/launcher.json'));i++)await wait(100);
 const record=JSON.parse(fs.readFileSync(path.join(root,'state/launcher.json'))),link=await(await fetch('http://'+record.host+'/launch',{method:'POST',body:record.admin})).json();
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||'/snap/bin/chromium',headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 await page.addInitScript(()=>{
  window.hiddenMoves=0;
  new MutationObserver(records=>{for(const r of records)for(const node of r.addedNodes)if(node instanceof HTMLElement&&node.matches('.session')&&node.closest('dialog:not([open])'))window.hiddenMoves++;}).observe(document,{subtree:true,childList:true});
 });
 const connected=()=>page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 const capture=async(name)=>{await page.waitForTimeout(400);await page.screenshot({path:path.join(out,name+'.png')});result.captures.push({name,viewport:page.viewportSize(),theme:await page.evaluate(()=>document.documentElement.dataset.theme),font:await page.evaluate(()=>document.documentElement.dataset.font)});};
 const settings=()=>page.getByRole('button',{name:'Settings',exact:true}).click();
 const prompt=page.locator('#prompt');
 await page.goto(link.url);await connected();
 const collapse=page.getByRole('button',{name:'Collapse sidebar',exact:true});
 await collapse.click();await page.getByRole('button',{name:'Expand sidebar',exact:true}).focus();await page.keyboard.press('Enter');assert(await collapse.isVisible());
 await collapse.click();await page.reload();await connected();assert(await page.getByRole('button',{name:'Expand sidebar',exact:true}).isVisible());await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();
 const left=page.getByRole('button',{name:'Toggle conversation panel'}),right=page.getByRole('button',{name:'Toggle workspace panel'});
 await prompt.fill('layout continuity');const originalInput=await prompt.elementHandle();
 await left.click();assert.equal(await page.locator('#panel-conversation').getAttribute('hidden'),'');assert(await right.isDisabled());
 await page.reload();await connected();assert.equal(await page.locator('#panel-conversation').getAttribute('hidden'),'');await left.click();assert.equal(await prompt.inputValue(),'layout continuity');
 await right.click();assert.equal(await page.locator('#panel-activity').getAttribute('hidden'),'');assert(await left.isDisabled());
 await right.click();for(let i=0;i<6;i++){await left.click();await left.click();await right.click();await right.click();}
 await page.waitForTimeout(400);assert.equal(await page.locator('[data-view-exiting]').count(),0);assert.equal(await prompt.inputValue(),'layout continuity');
 result.checks.push('Desktop sidebar keyboard collapse/reopen, reload persistence, both main panels collapse/reopen, last-panel protection, rapid reversals and draft continuity');

 for(const asset of ['app.js','app.css']){const response=await page.request.get(new URL('/'+asset,page.url()).href);assert(response.ok());assert.equal(crypto.createHash('sha256').update(await response.body()).digest('hex'),crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,'dist/assets',asset))).digest('hex'),'Embedded '+asset+' must match candidate assets');}
 await capture('desktop-dark-home');
 await prompt.fill('Draft survives appearance and resizing');const inputNode=await prompt.elementHandle();
 await settings();await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();await capture('desktop-dark-settings');
 await page.getByRole('button',{name:'Choose theme',exact:true}).click();
 assert(await page.getByRole('dialog',{name:'Theme',exact:true}).isVisible());await page.getByRole('combobox',{name:'Search themes'}).fill('github light');
 await page.getByRole('option',{name:'GitHub Light',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'github-light');
 await page.keyboard.press('Escape');assert(await page.getByRole('button',{name:'Choose theme',exact:true}).evaluate(el=>el===document.activeElement));
 // Real transition samples must show a growing circular clip, rather than only final colors.
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.getByRole('button',{name:'Choose theme',exact:true}).click();
 await page.getByRole('option',{name:'Dark',exact:true}).click();await page.waitForTimeout(1150);
 await page.getByRole('option',{name:'Green',exact:true}).click();
 await page.waitForFunction(()=>getComputedStyle(document.documentElement,'::view-transition-new(root)').clipPath.startsWith('circle('));
 const ownedSheets=await page.evaluate(()=>document.adoptedStyleSheets.length);assert.equal(ownedSheets,1);
 const clip1=await page.evaluate(()=>getComputedStyle(document.documentElement,'::view-transition-new(root)').clipPath);await page.waitForTimeout(150);
 const clip2=await page.evaluate(()=>getComputedStyle(document.documentElement,'::view-transition-new(root)').clipPath);assert.notEqual(clip1,clip2);result.revealSamples={clip1,clip2};
 await page.screenshot({path:path.join(out,'theme-wave-midpoint.png')});
 await page.waitForTimeout(1100);assert.equal(await page.locator('style[data-theme-reveal],.theme-reveal-wave').count(),0);assert.equal(await page.evaluate(()=>document.adoptedStyleSheets.length),0);
 for(const label of ['Dark','Green','Light','Dark'])await page.getByRole('option',{name:label,exact:true}).evaluate(el=>el.click());
 await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');assert.equal(await page.locator('style[data-theme-reveal],.theme-reveal-wave').count(),0);assert.equal(await page.evaluate(()=>document.adoptedStyleSheets.length),0);
 // Every registered palette changes the real root through the same production reveal.
 for(const label of ['Light','Green','EVA-01','Cyberpunk','GitHub Dark','GitHub Light','One Dark Pro','One Dark Blood','Dracula','Catppuccin Mocha','Catppuccin Latte','Tokyo Night','Nord','Gruvbox Dark','Monokai Pro','Rosé Pine','Night Owl','Solarized Light','Dark']){
  await page.getByRole('option',{name:label,exact:true}).evaluate(el=>el.click());await page.waitForTimeout(35);
 }
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);assert.equal(await page.locator('style[data-theme-reveal],.theme-reveal-wave').count(),0);assert.equal(await page.evaluate(()=>document.adoptedStyleSheets.length),0);
 await page.getByRole('option',{name:'Light',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');assert.equal(await page.locator('style[data-theme-reveal]').count(),0);
 await page.keyboard.press('Escape');
 result.checks.push('Actual GSAP circle growth and dark/green wave, all19 themes, rapid supersession, cleanup and live reduced-motion cancellation');
 await page.getByRole('radio',{name:'Inter',exact:true}).check();await page.evaluate(()=>document.fonts.load('14px "Deck Inter"'));
 assert(await page.evaluate(()=>document.fonts.check('14px "Deck Inter"')));assert.equal(await page.evaluate(()=>document.documentElement.dataset.font),'inter');
 await page.getByRole('radio',{name:'System',exact:true}).check();
 await page.getByRole('button',{name:'Choose theme',exact:true}).click();await page.getByRole('option',{name:'Light',exact:true}).click();await page.getByRole('button',{name:'Done',exact:true}).click();await capture('desktop-light-settings');
 await page.getByRole('button',{name:'Back to session',exact:true}).click();assert(await prompt.evaluate(el=>el===document.activeElement));assert.equal(await prompt.inputValue(),'Draft survives appearance and resizing');assert(await inputNode.evaluate(el=>el===document.getElementById('prompt')));
 await capture('desktop-light-home');result.checks.push('Original theme search, Escape/native focus return, local bundled font load, settings return preserves mounted draft and composer focus');
 // Match the saved live home/settings references before adding any controlled conversation.
 await page.setViewportSize({width:390,height:844});await capture('mobile-light-home');
 await page.getByRole('button',{name:'Toggle project navigation'}).click();await capture('mobile-light-navigation');await settings();await capture('mobile-light-settings');await page.getByRole('button',{name:'Appearance',exact:true}).click();await capture('mobile-light-appearance');
 await page.getByRole('button',{name:'Choose theme'}).click();await page.getByRole('option',{name:'Dark',exact:true}).click();await page.keyboard.press('Escape');await capture('mobile-dark-appearance');await page.getByRole('button',{name:'Back to settings',exact:true}).click();await capture('mobile-dark-settings');await page.getByRole('button',{name:'Appearance',exact:true}).click();
 await page.getByRole('button',{name:'Back to settings',exact:true}).click();await page.getByRole('button',{name:'Back to session',exact:true}).click();await capture('mobile-dark-home');
 await page.getByRole('button',{name:'Toggle project navigation'}).click();await capture('mobile-dark-navigation');await page.getByRole('button',{name:'Close project navigation'}).click();await page.setViewportSize({width:1440,height:1000});
 const divider=page.getByRole('separator',{name:'Conversation width'});await divider.focus();await page.keyboard.press('End');assert.equal(await divider.getAttribute('aria-valuenow'),'75');await page.keyboard.press('Home');assert.equal(await divider.getAttribute('aria-valuenow'),'25');await page.keyboard.press('ArrowRight');assert.equal(await divider.getAttribute('aria-valuenow'),'27');
 const box=await page.locator('.panes').boundingBox(),handle=await divider.boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+100);await page.mouse.down();await page.mouse.move(box.x+box.width*.63,handle.y+100,{steps:12});await page.mouse.up();
 assert(Math.abs(Number(await divider.getAttribute('aria-valuenow'))-63)<1);await page.reload();await connected();assert(Math.abs(Number(await divider.getAttribute('aria-valuenow'))-63)<1);assert.equal(await prompt.inputValue(),'Draft survives appearance and resizing');
 await divider.dblclick();assert.equal(await divider.getAttribute('aria-valuenow'),'50');result.checks.push('Keyboard bounds, pointer capture, split persistence/reload and reset');
 // Streaming output and draft/IME retain their independent identities across appearance changes.
 await prompt.fill('Controlled streaming question');await page.getByRole('button',{name:'Send question',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.assistant-message')?.textContent.includes('stream-'));
 const message=await page.locator('.assistant-message').elementHandle();
 await page.emulateMedia({reducedMotion:'no-preference'});await prompt.focus();await page.evaluate(()=>{window.hiddenMoves=0;});
 const started=Date.now();await page.keyboard.type('Connected typing with streaming',{delay:12});result.typingWallMs=Date.now()-started;
 let commands=0;await page.route('**/api/commands',route=>{commands++;return route.abort();});
 await prompt.dispatchEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true});assert.equal(commands,0);await page.unroute('**/api/commands');
 const before=await page.locator('.assistant-message').textContent();
 for(let i=0;i<3;i++){await left.click();await left.click();await right.click();await right.click();await settings();assert(await page.getByRole('heading',{name:'Settings',exact:true}).evaluate(el=>el===document.activeElement));await page.getByRole('button',{name:'Back to session',exact:true}).click();}
 await page.waitForTimeout(700);assert(await message.evaluate(el=>el===document.querySelector('.assistant-message')));assert.equal(await prompt.inputValue(),'Connected typing with streaming');assert.notEqual(await page.locator('.assistant-message').textContent(),before);assert.equal(await page.evaluate(()=>window.hiddenMoves),0);
 const layout=await page.evaluate(()=>{const c=document.querySelector('.conversation').getBoundingClientRect(),d=document.querySelector('.composer-dock').getBoundingClientRect();return {conversationBottom:c.bottom,composerTop:d.top,composerBottom:d.bottom,height:innerHeight};});assert(layout.conversationBottom<=layout.composerTop+1);assert(layout.composerBottom<=layout.height+1);result.layout=layout;
 result.checks.push('Connected polling/streaming typing, IME non-submission, rapid settings reversals, stable input/message identity, hidden-node regression and unobscured transcript');
 await page.getByRole('button',{name:'Cancel task',exact:true}).first().click();await page.waitForFunction(()=>document.querySelector('.assistant-message .phase')?.textContent==='Cancelled');
 await page.emulateMedia({reducedMotion:'reduce'});await settings();await page.getByRole('button',{name:'Choose theme',exact:true}).click();await page.getByRole('option',{name:'Dark',exact:true}).click();await page.keyboard.press('Escape');await page.getByRole('button',{name:'Back to session',exact:true}).click();
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('tab',{name:'Activity',exact:true}).focus();await page.keyboard.press('ArrowLeft');assert.equal(await page.getByRole('tab',{name:'Conversation',exact:true}).getAttribute('aria-selected'),'true');
 assert(!(await divider.isVisible()));await page.getByRole('button',{name:'Toggle project navigation'}).click();await settings();await page.getByRole('button',{name:'Appearance',exact:true}).click();
 await page.getByRole('button',{name:'Choose theme'}).click();await page.getByRole('option',{name:'Light',exact:true}).click();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Back to settings',exact:true}).click();await page.getByRole('button',{name:'Back to session',exact:true}).click();assert.equal(await prompt.inputValue(),'Connected typing with streaming');
 await page.getByRole('button',{name:'Toggle project navigation'}).click();await page.getByRole('button',{name:'Close project navigation'}).click();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.reload();await connected();assert.equal(await prompt.inputValue(),'Connected typing with streaming');assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');result.checks.push('Mobile panel keyboard navigation, settings/back flow, draft reload, 390px no overflow and reduced-motion navigation');
 // Every bundled font must load from this package (not a remote CDN).
 const failures=[];page.on('requestfailed',req=>failures.push(req.url()));
 await page.getByRole('button',{name:'Toggle project navigation'}).click();await settings();await page.getByRole('button',{name:'Appearance',exact:true}).click();
 for(const label of ['Inter','Geist','JetBrains Mono','Fira Code','Nunito Sans','Space Grotesk','Source Serif 4','Lora','IBM Plex Mono']){await page.getByRole('radio',{name:label,exact:true}).check();await page.evaluate(label=>document.fonts.load('14px "Deck '+label+'"'),label);assert(await page.evaluate(label=>document.fonts.check('14px "Deck '+label+'"'),label));}
 assert.deepEqual(failures,[]);assert.deepEqual(errors,[]);result.checks.push('All nine bundled fonts load locally; no page exceptions');
 await page.getByRole('button',{name:'Back to settings',exact:true}).click();await page.getByRole('button',{name:'Back to session',exact:true}).click();
 for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:1000});assert(await prompt.isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 result.checks.push('320/768/1024/1440 responsive width checks preserve accessible composer with no horizontal overflow');
 await ctx.close();
 for(const failure of ['malformed','blocked']){
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),p=await context.newPage();
  await p.addInitScript(failure=>{if(failure==='malformed'){localStorage.setItem('deck.theme','<invalid>');localStorage.setItem('deck.font','unknown');localStorage.setItem('deck.pane-split','Infinity');localStorage.setItem('deck2.theme','old-value');localStorage.setItem('deck.content-mode','invalid');localStorage.setItem('deck.sidebar-collapsed','invalid');}else{const originalGet=Storage.prototype.getItem,originalSet=Storage.prototype.setItem;Storage.prototype.getItem=function(key){if(['deck.theme','deck.font','deck.pane-split','deck.content-mode','deck.sidebar-collapsed'].includes(key))throw new Error('optional storage unavailable');return originalGet.call(this,key);};Storage.prototype.setItem=function(key,value){if(['deck.theme','deck.font','deck.pane-split','deck.content-mode','deck.sidebar-collapsed'].includes(key))throw new Error('optional storage unavailable');return originalSet.call(this,key,value);};}},failure);
  const freshLink=await(await fetch('http://'+record.host+'/launch',{method:'POST',body:record.admin})).json();await p.goto(freshLink.url);await p.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),'dark');assert.equal(await p.evaluate(()=>document.documentElement.dataset.font),'system');assert.equal(await p.getByRole('separator').getAttribute('aria-valuenow'),'50');await p.getByRole('button',{name:'Settings',exact:true}).click();await p.getByRole('radio',{name:'Geist',exact:true}).check();await p.getByRole('button',{name:'Choose theme'}).click();await p.getByRole('option',{name:'Nord',exact:true}).click();await p.keyboard.press('Escape');await p.getByRole('button',{name:'Back to session',exact:true}).click();await p.locator('#prompt').fill('Storage failure still permits editing');assert.equal(await p.locator('#prompt').inputValue(),'Storage failure still permits editing');assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),'nord');assert.equal(await p.locator('.app-error').count(),0);if(failure==='malformed')assert.equal(await p.evaluate(()=>localStorage.getItem('deck2.theme')),'old-value');await context.close();
 }
 result.checks.push('Malformed and throwing optional preference storage safely defaults, permits changes/editing, leaves experimental appearance untouched');result.passed=true;
 }catch(e){result.error=e.stack;process.exitCode=1;}
 finally{if(browser)await browser.close();host.kill('SIGINT');await new Promise(r=>host.exitCode!==null?r():host.once('exit',r));result.cleanup='Owned browser and fake-native host stopped; no personal host/provider used';fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
})();
