// Real browser against the packaged host. Uses only owned disposable content.
// Set DECK2_PLAYWRIGHT_MODULE to an existing Playwright installation.
const { chromium } = require(process.env.DECK2_PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-browser-'));const project=path.join(root,'project'),state=path.join(root,'state');fs.mkdirSync(project);
fs.writeFileSync(path.join(project,'example.txt'),'Project motto: amber-fox-842. Deck supports read-only conversations.\n');
const host=spawn(path.resolve(process.argv[2] || path.join(repo,'dist/deck2')),['serve','--project',project,'--state-dir',state,'--codex','/home/kevin15011/.local/bin/codex','--no-open']);
const evidence=(process.env.DECK2_EVIDENCE_DIR||path.join(repo,'target/browser-evidence'));fs.mkdirSync(evidence,{recursive:true});
let browser;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function launchLink(){const record=JSON.parse(fs.readFileSync(path.join(state,'launcher.json')));const response=await fetch('http://'+record.host+'/launch',{method:'POST',body:record.admin});assert.equal(response.status,200);return (await response.json()).url;}
(async()=>{try{
 for(let i=0;i<100&&!fs.existsSync(path.join(state,'launcher.json'));i++)await wait(100);
 const url=await launchLink();const base=url.split('/#')[0];
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM || '/snap/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 let page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.getByRole('textbox',{name:'Ask a read-only question'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 assert.equal(new URL(page.url()).hash,'');
 const cookies=await context.cookies();assert(cookies.some(c=>c.name.startsWith('deck2_')&&c.httpOnly&&c.sameSite==='Strict'));
 await page.getByRole('textbox').fill('Draft survives a reload');await page.reload();await page.getByRole('textbox').waitFor();assert.equal(await page.getByRole('textbox').inputValue(),'Draft survives a reload');
 await page.screenshot({path:path.join(evidence,'desktop-dark-empty.png')});
 for(const theme of ['Light','Dark']){
  await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Choose theme',exact:true}).click();await page.getByRole('button',{name:theme,exact:true}).click();await page.getByRole('button',{name:'Done',exact:true}).click();await page.getByRole('button',{name:'Back to session',exact:true}).click();
  if(theme==='Light')await page.screenshot({path:path.join(evidence,'desktop-light.png')});
 }
 await page.getByRole('textbox').fill('Read example.txt and quote the exact project motto. Explain the file in one sentence. Do not modify files.');
 await page.getByRole('textbox').focus();await page.keyboard.press('Control+Enter');
 await page.waitForFunction(()=>document.querySelector('.task .phase')?.textContent.match(/Running|Preparing|Accepted/));
 // Close the actual tab during the native task; host must continue.
 await page.close();page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/');
 await page.getByRole('textbox').waitFor();
 await page.waitForFunction(()=>document.querySelector('.assistant-message .phase')?.textContent==='Completed',{},{timeout:180000});
 const result=await page.evaluate(async()=>await (await fetch('/api/workspace')).json());assert.equal(result.receipts.length,1);const receipt=result.receipts[0];
 assert(receipt.text.includes('amber-fox-842'));assert(receipt.local_tool_calls>0);
 await page.screenshot({path:path.join(evidence,'desktop-dark-result.png')});
 await page.setViewportSize({width:390,height:844});await page.getByRole('tab',{name:'Activity',exact:true}).click();assert(await page.getByRole('complementary',{name:'Task activity'}).isVisible());
 await page.getByRole('tab',{name:'Conversation',exact:true}).click();await page.getByRole('textbox').fill('Mobile draft');await page.getByRole('tab',{name:'Activity',exact:true}).click();await page.getByRole('tab',{name:'Conversation',exact:true}).click();assert.equal(await page.getByRole('textbox').inputValue(),'Mobile draft');
 await page.getByRole('button',{name:'Toggle project navigation'}).click();assert.equal(await page.getByRole('button',{name:'Toggle project navigation'}).getAttribute('aria-expanded'),'true');await page.getByRole('button',{name:'Close project navigation'}).click();
 await page.getByRole('textbox').focus();assert.equal(await page.evaluate(()=>document.activeElement.id),'prompt');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Send question');
 assert(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:path.join(evidence,'mobile-dark-result.png')});
 // Exercise incompatible and disconnected clients without another native turn.
 await page.route('**/api/workspace',async route=>{const response=await route.fetch();const body=await response.json();body.api=2;await route.fulfill({response,json:body});});
 await page.waitForFunction(()=>document.querySelector('.send')?.disabled && document.querySelector('.alert')?.textContent.includes('Incompatible API'));
 assert.equal(await page.getByRole('textbox').inputValue(),'Mobile draft');await page.unroute('**/api/workspace');
 await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 await page.route('**/api/workspace',route=>route.abort());
 await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Disconnected'));
 assert.equal(await page.getByRole('textbox').inputValue(),'Mobile draft');await page.unroute('**/api/workspace');
 await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 assert.deepEqual(errors,[]);
 // Exercise real cancellation through the browser against the exact native mode.
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('textbox').fill('Read example.txt and explain its motto briefly. Do not modify files.');
 await page.getByRole('button',{name:'Send question'}).click();
 await page.waitForFunction(()=>document.querySelector('.task .phase')?.textContent==='Running',{},{timeout:60000});
 await page.locator('.task').getByRole('button',{name:'Cancel task'}).click();
 await page.waitForFunction(()=>document.querySelector('.task .phase')?.textContent==='Cancelled',{},{timeout:20000});
 const cancelled=await page.evaluate(async()=>await (await fetch('/api/workspace')).json());assert.equal(cancelled.receipts.length,2);assert.equal(cancelled.receipts[1].phase,'cancelled');
 // An unpaired browser cannot read host data or dispatch work.
 const unpaired=await browser.newContext();const denied=await unpaired.request.get(base+'/api/workspace');assert.equal(denied.status(),403);await unpaired.close();
 fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({project,state,checks:['one-use authentication','HttpOnly SameSite cookie','real native file read','tab closure and reconnect','one durable command','draft reload','desktop dark/light','mobile panels','keyboard focus','reduced motion','no horizontal overflow','unauthenticated rejection','no page errors','incompatible API blocks with draft retained','disconnect and reconnect retain draft','real native cancellation settles'],receipt,cancelled:cancelled.receipts[1]},null,2));
 console.log(JSON.stringify({passed:true,phase:receipt.phase,model:receipt.model,local_tool_calls:receipt.local_tool_calls,handshake_ms:receipt.handshake_ms,first_output_after_acceptance_ms:receipt.first_output_ms-receipt.accepted_ms,evidence},null,2));
}finally{if(browser)await browser.close();host.kill('SIGINT');}})().catch(e=>{console.error(e);process.exitCode=1;});
