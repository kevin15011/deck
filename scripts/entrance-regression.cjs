// Public behavior: hidden navigation remains mounted and inert while a draft is edited.
const {chromium}=require(process.env.DECK2_PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const output=process.argv[3],binary=path.resolve(process.argv[2]),root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-entrance-'));
fs.mkdirSync(path.join(root,'project'));
const host=spawn(binary,['serve','--foreground','--project',path.join(root,'project'),'--state-dir',path.join(root,'state'),'--no-open'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));let browser;
const result={binarySha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),checks:[],passed:false};
(async()=>{try{
 for(let i=0;i<100&&!fs.existsSync(path.join(root,'state/launcher.json'));i++)await wait(100);
 const record=JSON.parse(fs.readFileSync(path.join(root,'state/launcher.json')));
 const link=await(await fetch('http://'+record.host+'/launch',{method:'POST',body:record.admin})).json();
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||'/snap/bin/chromium',headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),page=await ctx.newPage();
 await page.addInitScript(()=>{
  window.hiddenMoves=0;window.visibleMoves=0;
  new MutationObserver(records=>{for(const r of records)for(const node of r.addedNodes)if(node instanceof HTMLElement&&node.matches('.session')){if(node.closest('dialog:not([open])'))window.hiddenMoves++;else window.visibleMoves++;}}).observe(document,{subtree:true,childList:true});
 });
 let commands=0;await page.route('**/api/commands',route=>{commands++;return route.abort();});
 await page.goto(link.url);await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 await page.waitForTimeout(800);await page.evaluate(()=>{window.hiddenMoves=0;window.visibleMoves=0;});
 await page.locator('#prompt').focus();await page.keyboard.type('Retained draft with composed input',{delay:20});
 await page.waitForTimeout(600);
 result.hiddenReinsertions=await page.evaluate(()=>window.hiddenMoves);result.visibleReinsertions=await page.evaluate(()=>window.visibleMoves);
 assert.equal(result.hiddenReinsertions,0,'Editing must not repeatedly reparent hidden conversation controls');result.checks.push('Hidden navigation stays mounted while typing and polling');
 await page.locator('#prompt').dispatchEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true});
 await page.waitForTimeout(50);assert.equal(commands,0,'IME composition must not submit');assert.equal(await page.locator('#prompt').inputValue(),'Retained draft with composed input');result.checks.push('Composing Ctrl+Enter retains draft and cannot submit');
 await page.reload();await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 assert.equal(await page.locator('#prompt').inputValue(),'Retained draft with composed input');result.checks.push('Reload retains draft');
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Toggle project navigation'}).click();
 await page.getByRole('button',{name:'Close project navigation'}).click();
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.getByRole('button',{name:'Toggle project navigation'}).click();
 await page.getByRole('button',{name:'Close project navigation'}).click();result.checks.push('Drawer opens/closes with normal and reduced motion');
 result.passed=true;
 }catch(e){result.error=e.message;process.exitCode=1;}
 finally{if(browser)await browser.close();host.kill('SIGINT');await new Promise(r=>host.exitCode!==null?r():host.once('exit',r));result.cleanup='Owned browser and host closed';fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
})();
