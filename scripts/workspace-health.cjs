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
  const page = await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const assets=process.env.DECK2_WEB_ASSETS;
  if(assets)await page.route(/\/app\.(?:css|js)$/,route=>
   route.fulfill({path:path.join(assets,path.basename(new URL(route.request().url()).pathname))}));
  const base=new URL(url).origin;
  const health=base+'/api/health';
  assert.equal((await fetch(health)).status,403);
  const snapshot = url => url.pathname === '/api/workspace' && url.searchParams.get('transport') === 'events';
  const events = url => url.pathname === '/api/workspace/events';
 const refresh = async () => {
  // An expired cursor forces a bootstrap, including its recovery UI.
  await page.route(events, r=>r.fulfill({
   contentType:'text/event-stream', body:'event: resync\ndata: {}\n\n',
  }), {times:1});
  await page.evaluate(() => {
   window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted:true}));
   window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true}));
  });
 };
  let snapshots = 0;
  page.on('request', r => { if (snapshot(new URL(r.url()))) snapshots++; });
  const initial=page.waitForResponse(r=>snapshot(new URL(r.url())) && r.ok());
  await page.goto(url);
  await initial;
  await page.waitForTimeout(1200);
  assert.equal(snapshots, 1, 'Idle workspace should use the open SSE connection');
  const draft=page.locator('#prompt');
  await draft.fill('Keep my unsent draft');
  const transcript=page.locator('#conversation'),inspector=page.locator('#session-inspector');
  await transcript.click({position:{x:18,y:100}});
  await page.keyboard.press('Space');
  const focus=await transcript.evaluate(el=>({
   focused:document.activeElement===el,shadow:getComputedStyle(el).boxShadow,outline:getComputedStyle(el).outlineStyle,
  }));
  assert.deepEqual(focus,{focused:true,shadow:'none',outline:'none'});
  await page.getByRole('button',{name:'Open Subagents',exact:true}).click();
  await inspector.waitFor();
  const geometry=()=>Promise.all([transcript,draft,inspector].map(el=>el.boundingBox()));
  const initialGeometry=await geometry();
  let probes=0;
  page.on('request',r=>{if(r.url()===health)probes++;});
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route(snapshot,async route=>{await gate;await route.continue();});
  await refresh();
  await page.getByText('Updating sessions…',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Reconnect',exact:true}).count(),0);
  assert.deepEqual(await geometry(),initialGeometry);
  const refreshed=page.waitForResponse(r=>snapshot(new URL(r.url())) && r.ok());
  release();await refreshed;
  await page.getByText('Updating sessions…',{exact:true}).waitFor({state:'hidden'});
  assert.equal(probes,0,'A pending snapshot should not start a health probe');
  await page.unroute(snapshot);
  await page.route(snapshot,r=>r.abort());
  await page.route('**/api/health',r=>r.abort());
  await refresh();
  const reconnect=page.getByRole('button',{name:'Reconnect',exact:true});
  await reconnect.waitFor();
  assert.match(await page.locator('#subagents-status').textContent(),/^Stale:/);
  assert.deepEqual(await geometry(),initialGeometry);
  const probe=page.waitForResponse(r=>r.url()===health);
  await page.unroute('**/api/health');
  const healthResponse=await probe;
  assert.equal(healthResponse.status(),200);
  assert.match(healthResponse.headers()['cache-control'],/no-store/);
  await page.getByRole('alert').filter({hasText:'Session data is stale'}).waitFor();
  await page.unroute(snapshot);
  await reconnect.waitFor({state:'hidden'});
  assert.match(await page.locator('#subagents-status').textContent(),/^\d+ active subagents/);
  await page.route(snapshot,r=>r.fulfill({json:{api:0}}));
  await refresh();
  await page.getByRole('alert').filter({hasText:'Incompatible API'}).waitFor();
  await page.unroute(snapshot);
  await page.getByRole('alert').filter({hasText:'Incompatible API'}).waitFor({state:'hidden'});
  await page.route(snapshot,r=>r.fulfill({status:403,json:{message:'Test session expired'}}));
  await refresh();
  await page.getByRole('alert').filter({hasText:'Test session expired'}).waitFor();
  await reconnect.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  assert.equal(await reconnect.evaluate(el=>document.activeElement===el&&el.matches(':focus-visible')&&getComputedStyle(el).outlineStyle==='solid'),true);
  await page.unroute(snapshot);
  await page.keyboard.press('Space');
  await reconnect.waitFor({state:'hidden'});
  assert.equal(await draft.inputValue(),'Keep my unsent draft');
  const beforeOffline = snapshots;
  await page.context().setOffline(true);
  await reconnect.waitFor();
  assert.match(await page.locator('#subagents-status').textContent(),/^Stale:/);
  const replay = page.waitForRequest(r=>events(new URL(r.url())));
  await page.context().setOffline(false);
  assert.ok(new URL((await replay).url()).searchParams.get('after'), 'Reconnection sent the retained cursor');
  await reconnect.waitFor({state:'hidden'});
  assert.equal(snapshots, beforeOffline, 'Returning online with a retained cursor should replay without a snapshot');
  assert.equal(await draft.inputValue(),'Keep my unsent draft');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted:true})));
  const beforeResume = snapshots;
  const stream = page.waitForRequest(r=>new URL(r.url()).pathname==='/api/workspace/events');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true})));
  assert.ok(new URL((await stream).url()).searchParams.get('after'), 'Resumed tab retained its cursor');
  assert.equal(snapshots, beforeResume);
  console.log('Passed: idle stream, offline recovery, resume cursor, transcript focus, stable geometry, delayed snapshot, loss of connectivity, reachable but stale snapshot, keyboard reconnect, automatic recovery, retained draft.');
 } finally {
  await browser?.close();
  if(host.exitCode===null){host.kill('SIGINT');await new Promise(resolve=>host.once('exit',resolve));}
  fs.rmSync(root,{recursive:true,force:true});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
