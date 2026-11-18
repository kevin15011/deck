const {chromium}=require('playwright');
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const out=path.resolve(process.env.DECK2_EVIDENCE_DIR||'target/native-tools/maintenance-browser');fs.mkdirSync(out,{recursive:true});
const root=fs.mkdtempSync(path.join(out,'fixture-')),project=path.join(root,'project'),state=path.join(root,'state'),native=path.join(root,'codex');fs.mkdirSync(project);fs.copyFileSync('scripts/fixtures/s7-codex.py',native);fs.chmodSync(native,0o700);fs.writeFileSync(path.join(root,'case'),'ready');
const helperBin=path.join(root,'.local','bin');fs.mkdirSync(helperBin,{recursive:true});
for(const name of ['claude','pi','opencode','rtk','codebase-memory-mcp']){const file=path.join(helperBin,name);fs.writeFileSync(file,`#!/bin/sh
if [ "$1" = '--version' ]; then echo '${name} 1.0'; else echo 'Usage: claude update | pi update --self | opencode upgrade | Usage: rtk | codebase-memory-mcp update'; fi
`);fs.chmodSync(file,0o700);}
const host=spawn(path.resolve('dist/deck2'),['serve','--project',project,'--state-dir',state,'--artifact-store',path.join(root,'artifacts'),'--codex',native,'--no-open'],{stdio:'ignore',env:{...process.env,HOME:root,PATH:helperBin+':'+process.env.PATH}}),wait=ms=>new Promise(r=>setTimeout(r,ms));let browser;
const evidence={kind:'Owned packaged browser and protocol fake; no real update/login/provider effect',binary_sha256:crypto.createHash('sha256').update(fs.readFileSync('dist/deck2')).digest('hex'),checks:[]};
(async()=>{try{
 for(let i=0;i<200&&!fs.existsSync(path.join(state,'launcher.json'));i++)await wait(50);
 const l=JSON.parse(fs.readFileSync(path.join(state,'launcher.json'))),base='http://'+l.host,{url}=await(await fetch(base+'/launch',{method:'POST',body:l.admin})).json();
 browser=await chromium.launch({executablePath:'/snap/bin/chromium',headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>document.querySelector('.connection')?.textContent.includes('Connected'));
 await page.locator('#prompt').fill('Preserved maintenance draft');
 await page.getByRole('button',{name:'Configuration',exact:true}).click();await page.getByRole('button',{name:'Runners',exact:true}).click();
 await page.getByRole('button',{name:'Prepare native update',exact:true}).click();const copy=page.getByRole('button',{name:'Copy update command',exact:true});await copy.waitFor();
 const section=page.getByRole('region',{name:'Runners',exact:true});assert((await section.textContent()).includes("'"+native+"' update"));assert((await section.textContent()).includes('No update was run'));
 evidence.checks.push('Native update help confirmed; exact selected executable and truthful terminal handoff displayed');
 await copy.click();await wait(450);await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
 for(const reducedMotion of ['reduce','no-preference']){await page.emulateMedia({reducedMotion});for(let i=0;i<4;i++){await page.getByRole('button',{name:'Close update instructions',exact:true}).click();await page.getByRole('button',{name:'Prepare native update',exact:true}).click();await copy.waitFor();}}
 await page.getByRole('button',{name:'Close update instructions',exact:true}).focus();await page.keyboard.press('Enter');assert(!(await copy.isVisible()));
 await page.getByRole('button',{name:'Prepare native update',exact:true}).click();await copy.waitFor();await page.setViewportSize({width:390,height:844});await wait(450);await copy.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
 await page.getByRole('button',{name:'Check readiness after updating',exact:true}).click();await page.getByRole('button',{name:'Copy update command',exact:true}).waitFor({state:'hidden'});await page.getByText(/Authenticated · Qualified version · Ready at observation/).waitFor();
 fs.writeFileSync(path.join(root,'case'),'update-help-failure');await page.getByRole('button',{name:'Prepare native update',exact:true}).click();await section.getByRole('alert').waitFor();assert(!(await copy.isVisible()));
 fs.writeFileSync(path.join(root,'case'),'ready');await page.getByRole('button',{name:'Prepare native update',exact:true}).click();await copy.waitFor();
 evidence.checks.push('Failed help produces visible failure and no command; clean retry recovers; readiness explicitly checked');
 // Every target resolves the inspected installation and displays a version.
 await page.setViewportSize({width:1440,height:1000});
 for(const target of ['claude','pi','opencode','rtk','codebase-memory-mcp']){
  await page.getByRole('combobox',{name:/Maintenance target/}).selectOption(target);
  await page.getByRole('button',{name:'Prepare native update',exact:true}).click();await copy.waitFor();
  const text=await section.textContent();assert(text.includes(path.join(helperBin,target)),target);assert(text.includes('No update was run'));
  if(target==='pi')assert(text.includes('update --self'));
  if(target==='rtk')assert(text.includes('RTK_INSTALL_DIR='));
  await page.getByRole('button',{name:'Check readiness after updating',exact:true}).click();await page.getByText(`${path.join(helperBin,target)} · ${target} 1.0 · version_observed`,{exact:true}).waitFor();
 }
 await page.getByRole('combobox',{name:/Maintenance target/}).selectOption('codex');
 fs.appendFileSync(native,'\n# supported update fixture\n');
 await page.getByRole('button',{name:'Refresh runner readiness',exact:true}).click();await page.getByText(/Supported version at a changed executable/).waitFor();
 await page.getByRole('button',{name:'Review external Codex reselection',exact:true}).click();await page.getByRole('button',{name:'Apply reviewed runner change',exact:true}).click();await page.getByText(/Selected for future work/).waitFor();
 fs.writeFileSync(path.join(root,'case'),'version');await page.getByRole('button',{name:'Refresh runner readiness',exact:true}).click();await page.getByText(/This Deck build supports codex-cli 0.166.0/).waitFor();assert((await section.textContent()).includes('Codex · codex-cli 9.0.0'));
 evidence.checks.push('All six exact target commands/versions, supported changed-executable review and unsupported observed version without silent admission');
 const invocations=fs.readFileSync(path.join(root,'invocations.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert(!invocations.some(args=>args.length===1&&args[0]==='update'));const calls=fs.readFileSync(path.join(root,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert(!calls.some(c=>c.method.startsWith('thread/')||c.method.startsWith('turn/')));
 await page.getByRole('button',{name:'Back to conversation',exact:true}).click();assert.equal(await page.locator('#prompt').inputValue(),'Preserved maintenance draft');assert.deepEqual(errors,[]);
 evidence.checks.push('GSAP reversals, reduced motion, keyboard close, mobile overflow, copy control and draft preservation; no update/thread/turn effects');evidence.passed=true;
 }finally{await browser?.close();host.kill('SIGINT');await new Promise(r=>host.exitCode!==null?r():host.once('exit',r));fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));}})().catch(e=>{console.error(e);process.exitCode=1;});
