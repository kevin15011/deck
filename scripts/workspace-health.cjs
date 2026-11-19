// Exercise slow workspace refresh and daemon connectivity independently.
const assert = require('node:assert/strict');
const {execFileSync, spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');

async function main() {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck2-health-'));
 const installed = path.join(root, 'deck2');
 const state = path.join(root, 'state');
 const project=path.join(root,'project');
 fs.mkdirSync(project);
 fs.copyFileSync(path.resolve(process.argv[2] || 'dist/deck2'), installed);
 const host = spawn(installed, ['serve', '--foreground', '--project', project, '--state-dir', state, '--no-open', '--no-history', '--codex', '/bin/false'], {
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
  const base=new URL(url).origin;
  const health=base+'/api/health';
  assert.equal((await fetch(health)).status,403);
  await page.goto(url);
  await page.waitForResponse(r=>r.url()===base+'/api/workspace' && r.ok());
  const draft=page.locator('#prompt');
  await draft.fill('Keep my unsent draft');
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/workspace',async route=>{await gate;await route.continue();});
  const probe=await page.waitForResponse(r=>r.url()===health);
  assert.equal(probe.status(),200);
  assert.match(probe.headers()['cache-control'],/no-store/);
  await page.getByText('Updating sessions…',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Reconnect',exact:true}).count(),0);
  const refreshed=page.waitForResponse(r=>r.url()===base+'/api/workspace' && r.ok());
  release();await refreshed;
  await page.getByText('Updating sessions…',{exact:true}).waitFor({state:'hidden'});
  await page.unroute('**/api/workspace');
  await page.route('**/api/workspace',r=>r.abort());
  await page.route('**/api/health',r=>r.abort());
  await page.getByRole('button',{name:'Reconnect',exact:true}).waitFor();
  await page.unroute('**/api/health');
  await page.getByText('Updating sessions…',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Reconnect',exact:true}).waitFor({state:'hidden'});
  await page.unroute('**/api/workspace');
  await page.getByText('Updating sessions…',{exact:true}).waitFor({state:'hidden'});
  await page.route('**/api/workspace',r=>r.fulfill({json:{api:0}}));
  await page.getByRole('alert').filter({hasText:'Incompatible API'}).waitFor();
  await page.unroute('**/api/workspace');
  await page.getByRole('alert').filter({hasText:'Incompatible API'}).waitFor({state:'hidden'});
  assert.equal(await draft.inputValue(),'Keep my unsent draft');
  console.log('Passed: authenticated health probe, delayed snapshot, loss of connectivity, automatic recovery, retained draft.');
 } finally {
  await browser?.close();
  if(host.exitCode===null){host.kill('SIGINT');await new Promise(resolve=>host.once('exit',resolve));}
  fs.rmSync(root,{recursive:true,force:true});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
