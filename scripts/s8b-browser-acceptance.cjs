// Oracle: scoped attachments survive upload/submit lost acknowledgments and reload;
// no command dispatches without all intended images or with a different identity.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawn,execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..'),out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/s8b/browser'),binary=path.resolve(process.argv[2]||'dist/deck2'),real=process.env.DECK2_REAL_IMAGE==='1';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'deck2-s8b-'));fs.mkdirSync(out,{recursive:true});fs.mkdirSync(path.join(root,'project'));
fs.copyFileSync(path.join(repo,'crates/host/tests/fake_native.py'),path.join(root,'codex'));fs.chmodSync(path.join(root,'codex'),0o700);fs.writeFileSync(path.join(root,'mode'),'images');fs.writeFileSync(path.join(root,'allow-prepare'),'ready');
const fixture=fs.readFileSync(path.join(repo,'target/s8b/synthetic.png')),digest=crypto.createHash('sha256').update(fixture).digest('hex');
const host=spawn(binary,['serve','--foreground','--project',path.join(root,'project'),'--state-dir',path.join(root,'state'),'--codex',real?'/home/kevin15011/.local/bin/codex':path.join(root,'codex'),'--no-open'],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));let browser;
const result={binarySha256:crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),fixtureSha256:digest,real,root,checks:[],captures:[],passed:false};
(async()=>{try{
 for(let i=0;i<200&&!fs.existsSync(path.join(root,'state/launcher.json'));i++)await wait(100);
 const record=JSON.parse(fs.readFileSync(path.join(root,'state/launcher.json'))),base='http://'+record.host,link=await(await fetch(base+'/launch',{method:'POST',body:record.admin})).json();
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM||'/snap/bin/chromium',headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const connected=()=>page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 const capture=async name=>{await page.waitForTimeout(300);const file=path.join(out,name+'.png');await page.screenshot({path:file});if(name.endsWith('preview')){const box=await page.locator('.image-full').boundingBox();assert(box?.width>0&&box?.height>0);execFileSync('python3',[path.join(repo,'scripts/fixtures/s8b-preview-pixels.py'),file,JSON.stringify(box)]);}result.captures.push(name);};
 const images=()=>page.locator('.image-draft'),ready=()=>page.waitForFunction(()=>Array.from(document.querySelectorAll('.image-draft small')).length>0&&Array.from(document.querySelectorAll('.image-draft small')).every(v=>v.textContent==='Ready'));
 const upload=async()=>{const opened=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Attach images',exact:true}).click();const chooser=await opened;await chooser.setFiles({name:'visual.png',mimeType:'image/png',buffer:fixture});};
 const workspace=async()=>await (await page.request.get(base+'/api/workspace')).json();
 await page.goto(link.url);await connected();const prompt=page.locator('#prompt');
 await prompt.fill('Text is independent of the selected image.');await upload();await ready();assert.equal(await images().count(),1);await capture('desktop-dark-strip');
 await page.getByRole('button',{name:'Preview attached image 1',exact:true}).click();assert(await page.getByRole('dialog',{name:'Image preview'}).isVisible());await page.waitForFunction(()=>document.querySelector('.image-full')?.naturalWidth===600);result.previewGeometry=await page.locator('.image-full').boundingBox();assert(result.previewGeometry.width>0&&result.previewGeometry.height>0);await capture('desktop-dark-preview');await page.getByRole('button',{name:'Zoom in',exact:true}).click();await page.keyboard.press('Escape');assert(await page.getByRole('button',{name:'Preview attached image 1',exact:true}).evaluate(el=>el===document.activeElement));
 await page.reload();await connected();await ready();assert.equal(await prompt.inputValue(),'Text is independent of the selected image.');
 result.checks.push('Select, preview/zoom, Escape focus return and acknowledged draft reload');
 if(!real){
 // Q01: retain a hidden removal across transport loss/reload, then retry the exact source upload.
 await upload();await ready();let deletedURL='';
 await page.route('**/api/sessions/*/uploads/*',async route=>{if(route.request().method()==='DELETE'){deletedURL=route.request().url();await route.abort('failed');}else await route.continue();});
 await page.getByRole('button',{name:'Remove attached image 2',exact:true}).click();
 await page.getByText('Image removal is pending.',{exact:false}).waitFor();assert.equal(await images().count(),1);
 const removal=()=>page.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.endsWith('.images')).flatMap(([,v])=>JSON.parse(v)).filter(v=>v.removing));
 assert.equal((await removal()).length,1);assert.equal((await page.request.get(deletedURL)).status(),200);
 await page.reload();await connected();await page.getByText('Image removal is pending.',{exact:false}).waitFor();assert.equal(await images().count(),1);
 await page.unroute('**/api/sessions/*/uploads/*');await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await page.waitForFunction(()=>Object.entries(localStorage).filter(([k])=>k.endsWith('.images')).every(([,v])=>JSON.parse(v).every(v=>!v.removing)));
 assert.equal((await page.request.get(deletedURL)).status(),404);assert.equal(await images().count(),1);
 await page.getByRole('button',{name:'Dismiss',exact:true}).click();await page.getByRole('alert').waitFor({state:'hidden'});
 // Server performed removal but acknowledgment was lost: reload repeats cancellation safely.
 await upload();await ready();await page.route('**/api/sessions/*/uploads/*',async route=>{if(route.request().method()==='DELETE'){await route.fetch();await route.abort('failed');}else await route.continue();});
 await page.getByRole('button',{name:'Remove attached image 2',exact:true}).click();await page.getByText('Image removal is pending.',{exact:false}).waitFor();assert.equal((await removal()).length,1);
 await page.unroute('**/api/sessions/*/uploads/*');await page.reload();await connected();await page.waitForFunction(()=>Object.entries(localStorage).filter(([k])=>k.endsWith('.images')).every(([,v])=>JSON.parse(v).every(v=>!v.removing)));assert.equal(await images().count(),1);
 result.checks.push('Failed and lost DELETE acknowledgment retain hidden durable removal; reload/online reconciliation removes exact source upload while preserving sibling');
 // Wrong MIME contents are validated by the host; editable text remains mounted.
 await page.getByLabel('Choose images').setInputFiles({name:'bad.png',mimeType:'image/png',buffer:Buffer.from('not an image')});await page.getByText('Upload failed',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'Send question'}).isDisabled());await prompt.fill('Still editable after rejected image');await page.getByRole('button',{name:'Remove attached image 2',exact:true}).click();
 // Retry after a genuine lost upload response keeps the same immutable upload identity.
 let lose=true;await page.route('**/api/sessions/*/uploads/*',async route=>{if(route.request().method()==='POST'&&lose){lose=false;await route.fetch();await route.abort('failed');}else await route.continue();});
 await upload();await page.getByText('Upload failed',{exact:true}).waitFor();await page.getByRole('button',{name:'Retry upload',exact:true}).click();await ready();assert.equal(await images().count(),2);await page.unroute('**/api/sessions/*/uploads/*');
 // Upload completion stays with the original conversation across navigation.
 let release;const gate=new Promise(r=>release=r);await page.route('**/api/sessions/*/uploads/*',async route=>{if(route.request().method()==='POST')await gate;await route.continue();});await upload();
 const inputNode=await prompt.elementHandle(),typingStart=performance.now();await prompt.pressSequentially(' Connected typing during upload.',{delay:8});result.typingDuringUploadMs=Math.round(performance.now()-typingStart);assert(await inputNode.evaluate(el=>el===document.getElementById('prompt')));
 const firstSession=(await workspace()).session;await page.getByRole('button',{name:'+ New conversation',exact:true}).click();await page.getByLabel('Session name',{exact:true}).fill('Conversation 2');await page.getByRole('button',{name:'Create session',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.app-header h1')?.textContent==='Conversation 2');release();await page.waitForTimeout(800);assert.equal(await images().count(),0);await page.unroute('**/api/sessions/*/uploads/*');await page.locator('.sidebar .session').first().click();await ready();assert.equal(await images().count(),3);
 // Remove only this draft; preserve acknowledged sibling references.
 await page.getByRole('button',{name:'Remove attached image 3',exact:true}).click();assert.equal(await images().count(),2);
 // Clipboard image and text paste keep independent channels and IME never submits.
 await prompt.evaluate((el,b64)=>{const bytes=Uint8Array.from(atob(b64),v=>v.charCodeAt(0));const data=new DataTransfer();data.items.add(new File([bytes],'pasted.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},fixture.toString('base64'));await ready();assert.equal(await images().count(),3);await page.getByRole('button',{name:'Remove attached image 3',exact:true}).click();
 await prompt.evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true,bubbles:true}));el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));});assert.equal((await workspace()).receipts.length,0);
 await page.emulateMedia({reducedMotion:'no-preference'});
 for(let i=0;i<3;i++){await page.getByRole('button',{name:'Preview attached image 1',exact:true}).click();await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Image preview'}).waitFor({state:'hidden'});}
 await upload();await ready();await page.getByRole('button',{name:'Remove attached image 3',exact:true}).click();assert(await prompt.evaluate(el=>el===document.activeElement));await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.querySelectorAll('body > .image-draft').length===0);
 result.checks.push('Actual content rejection keeps text; lost upload acknowledgment retries; source conversation upload race; clipboard image and IME; GSAP rapid preview reversals, immediate removal focus and live reduced-motion cleanup');
 }
 await page.setViewportSize({width:390,height:844});await capture('mobile-dark-strip');await page.getByRole('button',{name:'Preview attached image 1',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.image-full')?.naturalWidth===600);await capture('mobile-dark-preview');await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:1000});
 if(real)await prompt.fill('Describe the colors and shapes visible in the attached image and where each appears. Use only the image. Do not read files or use tools.');else await prompt.fill('Inspect the attached synthetic images.');
 const before=(await workspace()).receipts.length;
 if(!real){ // Hold command response and polling after actual admission to simulate reload after lost ack.
  let held=false;await page.route('**/api/commands',async route=>{if(route.request().method()==='POST'){held=true;await route.fetch();await route.abort('failed');}else await route.continue();});await page.route('**/api/workspace',route=>route.abort('failed'));
 }
 await page.getByRole('button',{name:'Send question',exact:true}).click();
 if(!real){await page.waitForTimeout(800);assert(await page.getByText('Submission identity retained.',{exact:false}).isVisible());await page.unroute('**/api/commands');await page.unroute('**/api/workspace');await page.reload();await connected();}
 await page.waitForFunction(()=>document.querySelector('.assistant-message .phase')?.textContent==='Completed',{},{timeout:real?180000:30000});
 const w=await workspace(),r=w.receipts.at(-1);assert.equal(w.receipts.length,before+1);assert(r.attachments.length);assert(r.attachments.every(a=>a.digest===digest));assert.equal(await images().count(),0);assert.equal(await prompt.inputValue(),'');
 assert(!JSON.stringify(w).includes('deck2-images-'));assert(!JSON.stringify(w).includes('data:image'));
 if(real){assert(/red/i.test(r.text)&&/circle/i.test(r.text)&&/blue/i.test(r.text)&&/rectang/i.test(r.text),r.text);result.nativeReceipt=r;}
 else {const dispatches=fs.readFileSync(path.join(root,'dispatches'),'utf8').trim().split('\n');assert.equal(dispatches.length,1);const parts=JSON.parse(fs.readFileSync(path.join(root,'image-dispatches'),'utf8').trim());assert.equal(parts.length,r.attachments.length);assert(parts.every(v=>v.digest===digest));}
 result.checks.push(real?'Real Codex identified red circle and blue rectangle from the synthetic image':'Lost submit acknowledgment/reload reconciles exact text/image receipt without redispatch; default native input contains same image bytes');
 await capture('desktop-recorded-history');await page.reload();await connected();await page.getByRole('button',{name:'View image 1',exact:true}).click();assert(await page.getByRole('dialog',{name:'Image preview'}).isVisible());await page.waitForFunction(()=>document.querySelector('.image-full')?.naturalWidth===600);await capture('recorded-image-preview');await page.keyboard.press('Escape');
 if(!real){await prompt.fill('');await upload();await ready();await page.getByRole('button',{name:'Send question',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.assistant-message .phase').length===2&&Array.from(document.querySelectorAll('.assistant-message .phase')).every(e=>e.textContent==='Completed'));assert.equal((await workspace()).receipts.at(-1).prompt,'');result.checks.push('Image-only command reaches qualified native path');}
 assert.deepEqual(errors,[]);result.checks.push('Recorded image and preview survive reload; private paths/bytes absent from polling; desktop/mobile and reduced motion');result.passed=true;
 }catch(e){result.error=e.stack;process.exitCode=1;}
 finally{if(browser)await browser.close();host.kill('SIGINT');await new Promise(r=>host.exitCode!==null?r():host.once('exit',r));result.cleanup='Owned browser/host stopped; installed binary and personal tools unchanged';fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
})();
