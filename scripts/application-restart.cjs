// Restart a disposable host after replacing its installed binary and verify browser continuity.
const assert = require('node:assert/strict');
const {execFileSync, spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');

async function main() {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck2-restart-'));
 const installed = path.join(root, 'deck2');
 const state = path.join(root, 'state');
 fs.copyFileSync(path.resolve(process.argv[2] || 'dist/deck2'), installed);
 const host = spawn(installed, ['serve', '--foreground', '--state-dir', state, '--no-open', '--no-history', '--codex', '/bin/false'], {
  env:{...process.env, HOME:root, XDG_STATE_HOME:root, XDG_DATA_HOME:root, CODEX_HOME:path.join(root,'codex')}, stdio:'ignore'
 });
 let browser;
 try {
  const launch = () => execFileSync(installed, ['open','--state-dir',state,'--print-url'], {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  let url;
  for(let i=0;i<200&&!url;i++){try {url=launch();} catch {await new Promise(r=>setTimeout(r,50));}}
  assert.ok(url, 'temporary host started');
  browser = await chromium.launch({executablePath:process.env.DECK2_CHROMIUM || chromium.executablePath(),args:['--no-sandbox']});
  const page = await browser.newPage();
  await page.goto(url);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Application',exact:true}).click();
  const restart = page.getByRole('button',{name:'Restart Deck',exact:true});
  const endpoint=new URL('/api/application/restart',url).href;
  const before=await (await page.request.get(endpoint)).json();
  assert.ok(before.available && !before.busy);
  // Simulate an in-flight preparation in this fixture's private database.
  function preparing(value){
   execFileSync('python3',['-c',"import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute(\"INSERT OR REPLACE INTO meta(key,value) VALUES('ordinary_preparing',?)\",(sys.argv[2],)); c.commit()",path.join(state,'state.db'),value]);
  }
  preparing('running');
  await page.waitForFunction(()=>document.querySelector('.settings-panel button')?.disabled && document.querySelector('.settings-panel')?.textContent.includes('queued work'));
  const blocked=await page.request.post(endpoint,{headers:{Origin:new URL(url).origin},data:{api:7,generation:before.generation}});
  assert.equal(blocked.status(),409); assert.equal((await blocked.json()).code,'restart_busy');
  preparing('settled');
  fs.copyFileSync(installed,installed+'.next');fs.renameSync(installed+'.next',installed);
  const updated=fs.statSync(installed).ino;
  assert.notEqual(fs.statSync('/proc/'+host.pid+'/exe').ino,updated);
  await Promise.all([page.waitForEvent('load'), restart.click()]);
  assert.equal(fs.statSync('/proc/'+host.pid+'/exe').ino,updated);
  const after=await (await page.request.get(endpoint)).json();
  assert.ok(after.generation && after.generation!==before.generation);
  const stale=await page.request.post(endpoint,{headers:{Origin:new URL(url).origin},data:{api:7,generation:before.generation}});
  assert.equal(stale.status(),409);
  console.log('Passed: busy restart refused, updated executable loaded, same browser authenticated, stale request refused.');
 } finally {
  await browser?.close();
  if(host.exitCode===null){host.kill('SIGINT');await new Promise(resolve=>host.once('exit',resolve));}
  fs.rmSync(root,{recursive:true,force:true});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
