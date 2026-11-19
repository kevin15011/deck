// Oracle: original same-origin appearance survives replacement, changes and reload.
// Exercises embedded production assets, disposable browser storage and a fake native edge.
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),assert=require('assert/strict'),{spawn}=require('child_process'),{chromium}=require('playwright');
const binary=path.resolve(process.argv[2]||'dist/deck2'),out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/appearance-compat');fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-appearance-')),state=path.join(root,'state');
for(const name of ['project','original','home'])fs.mkdirSync(path.join(root,name),{mode:0o700});
fs.writeFileSync(path.join(root,'original/projects.json'),JSON.stringify({v:1,projects:[]}),{mode:0o600});
const fake=path.join(root,'codex');fs.copyFileSync(path.join(__dirname,'../crates/host/tests/fake_native.py'),fake);fs.chmodSync(fake,0o700);
const host=spawn(binary,['serve','--foreground','--project',path.join(root,'project'),'--state-dir',state,'--history-root',path.join(root,'original'),'--artifact-store',path.join(root,'tools'),'--codex',fake,'--no-open'],{env:{...process.env,HOME:path.join(root,'home'),CODEX_HOME:path.join(root,'native')},stdio:['ignore','pipe','pipe']});
let log='',browser;host.stdout.on('data',b=>log+=b);host.stderr.on('data',b=>log+=b);
const wait=ms=>new Promise(r=>setTimeout(r,ms)),started=performance.now(),result={binary:crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),checks:[],passed:false};
const unrelated={'deck2.draft':'keep draft','deck2.pending-command':'keep identity','deck2.host.fixture.git-layout':'split','deck-notification-preferences':'keep notifications'};
const original={'deck.theme':'github-light','deck.font':'lora','deck.pane-split':'62.5','deck.sidebar-collapsed':'true','deck.content-mode':'workspace'};
const conflicts={'deck2.theme':'nord','deck2.font':'geist','deck2.pane-split':'27','deck2.sidebar-collapsed':'false','deck2.content-mode':'chat'};
(async()=>{try{
 let record;for(let i=0;i<400;i++){if(fs.existsSync(path.join(state,'launcher.json'))){record=JSON.parse(fs.readFileSync(path.join(state,'launcher.json')));break;}if(host.exitCode!==null)throw Error(log);await wait(25);}assert(record,'Host starts');
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||chromium.executablePath(),headless:true,args:['--no-sandbox']});
 async function scenario(name,seed,expected,{blocked=false,changes=false,motion='reduce'}={}){
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:motion}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  // Seed once per origin, so reload verifies persisted user edits rather than reseeding them.
  await page.addInitScript(({seed,blocked})=>{
   if(!sessionStorage.getItem('fixture-seeded')){for(const [k,v]of Object.entries(seed))localStorage.setItem(k,v);sessionStorage.setItem('fixture-seeded','true');}
   if(blocked){const get=Storage.prototype.getItem,set=Storage.prototype.setItem;Storage.prototype.getItem=function(k){if(k.startsWith('deck.'))throw Error('appearance storage unavailable');return get.call(this,k);};Storage.prototype.setItem=function(k,v){if(k.startsWith('deck.'))throw Error('appearance storage unavailable');return set.call(this,k,v);};}
   window.appearanceFrames=[];function frame(){const node=document.querySelector('.workbench');if(node)window.appearanceFrames.push({theme:document.documentElement.dataset.theme,font:document.documentElement.dataset.font,collapsed:node.classList.contains('sidebar-collapsed'),mode:document.querySelector('.app-body')?.className,split:document.querySelector('[role=separator]')?.getAttribute('aria-valuenow')});if(window.appearanceFrames.length<8)requestAnimationFrame(frame);}requestAnimationFrame(frame);
  },{seed:{...unrelated,...conflicts,...seed},blocked});
  const link=await(await fetch('http://'+record.host+'/launch',{method:'POST',body:record.admin})).json();await page.goto(link.url);
  await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
  async function appearance(e){
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),e.theme);assert.equal(await page.evaluate(()=>document.documentElement.dataset.font),e.font);
   assert.equal(await page.locator('.workbench').evaluate(n=>n.classList.contains('sidebar-collapsed')),e.collapsed);
   assert(await page.locator('.app-body').evaluate((n,mode)=>n.classList.contains('content-'+mode),e.mode));
   assert.equal(await page.getByRole('separator',{includeHidden:true}).getAttribute('aria-valuenow'),e.split);
  }
  await appearance(expected);const frames=await page.evaluate(()=>window.appearanceFrames);assert(frames.length);for(const f of frames){assert.equal(f.theme,expected.theme,'First mounted frames use original theme');assert.equal(f.font,expected.font);assert.equal(f.collapsed,expected.collapsed);assert(f.mode.includes('content-'+expected.mode));assert.equal(f.split,expected.split);}
  if(name==='original-wins'){assert.deepEqual(await page.evaluate(keys=>Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)])),Object.keys(original)),original);await page.screenshot({path:path.join(out,'original-initial.png')});}
  if(changes){
   if(expected.collapsed){await page.getByRole('button',{name:'Expand sidebar',exact:true}).focus();await page.keyboard.press('Enter');}
   // Workspace-only -> both, then rapid GSAP reversals return to both.
   if(expected.mode==='workspace')await page.getByRole('button',{name:'Toggle conversation panel'}).click();
   const toggle=page.getByRole('button',{name:'Toggle workspace panel'});for(let i=0;i<3;i++){await toggle.click();await toggle.click();}
   const divider=page.getByRole('separator');await divider.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
   await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('radio',{name:'Inter',exact:true}).check();
   await page.getByRole('button',{name:'Choose theme',exact:true}).click();const search=page.getByRole('combobox',{name:'Search themes'});await search.fill('dracula');await page.keyboard.press('Enter');
   await page.keyboard.press('Escape');await page.getByRole('button',{name:'Back to session',exact:true}).click();
   await page.waitForFunction(()=>document.documentElement.dataset.theme==='dracula');
   const changed={theme:'dracula',font:'inter',split:'27',collapsed:false,mode:'both'};await appearance(changed);
   if(!blocked){await page.reload();await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));await appearance(changed);}
   await page.locator('#prompt').fill('Appearance keeps editing usable');assert.equal(await page.locator('#prompt').inputValue(),'Appearance keeps editing usable');
  }
  const kept=await page.evaluate(keys=>Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)])),Object.keys({...unrelated,...conflicts}));assert.deepEqual(kept,{...unrelated,...conflicts});assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(out,name+'.png')});result.checks.push({name,passed:true,frames});await context.close();
 }
 const defaults={theme:'dark',font:'system',split:'50',collapsed:false,mode:'both'};
 await scenario('original-wins',original,{theme:'github-light',font:'lora',split:'62.5',collapsed:true,mode:'workspace'},{changes:true,motion:'no-preference'});
 await scenario('legacy-chat',{'deck.workspace-collapsed':'true'},{...defaults,mode:'chat'});
 await scenario('invalid-with-legacy',{'deck.theme':'invalid','deck.font':'invalid','deck.pane-split':'Infinity','deck.sidebar-collapsed':'invalid','deck.content-mode':'invalid','deck.workspace-collapsed':'true'},{...defaults,mode:'chat'});
 await scenario('valid-mode-over-legacy',{'deck.content-mode':'both','deck.workspace-collapsed':'true','deck.pane-split':'900'},{...defaults,split:'75'});
 await scenario('legacy-expanded',{'deck.workspace-collapsed':'false','deck.pane-split':'-1'},{...defaults,split:'25'});
 await scenario('absent',{},defaults);
 await scenario('blocked',original,defaults,{blocked:true,changes:true});
 result.passed=true;
}catch(e){result.error=e.stack;process.exitCode=1;}finally{
 if(browser)await browser.close();host.kill('SIGINT');if(host.exitCode===null)await Promise.race([new Promise(r=>host.once('exit',r)),wait(4000)]);if(host.exitCode===null){host.kill('SIGKILL');result.cleanupError='Host exceeded shutdown deadline';process.exitCode=1;}
 result.seconds=(performance.now()-started)/1000;fs.writeFileSync(path.join(out,'host.log'),log);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));fs.rmSync(root,{recursive:true,force:true});
}})();
