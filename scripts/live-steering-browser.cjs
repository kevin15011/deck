// Drive the real browser and host with a controllable Codex app-server edge.
const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {spawn, execFileSync} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const {setTimeout: wait} = require('node:timers/promises');
const {DatabaseSync} = require('node:sqlite');

const binary = path.resolve(process.argv[2] || 'target/debug/deck2');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck2-steering-'));
const project = path.join(root, 'project');
const state = path.join(root, 'state');
const nativeHome = path.join(root, 'native-home');
fs.mkdirSync(project);
execFileSync('git', ['init', '-q', project]);
const edge = fs.readFileSync(path.join(__dirname, '../crates/host/tests/fake_session_native.py'), 'utf8')
    .replace('codex-cli 0.166.0', 'codex-cli 0.170.0')
    .replace(" elif m=='turn/start':", ` elif m=='turn/steer':
  with (root/'wire').open('a') as f:f.write(json.dumps({'method':m,'params':p})+'\\n')
  if p['threadId']!=thread or p['expectedTurnId']!=turn:
   out({'id':v['id'],'error':{'code':-32600,'message':'wrong turn'}})
  elif 'reject at native' in p['input'][0]['text']:
   out({'id':v['id'],'error':{'code':-32600,'message':'turn just ended'}})
  elif 'lose native ack' not in p['input'][0]['text']:
   result(v,{'turnId':turn})
 elif m=='turn/interrupt':
  result(v,{})
  out({'method':'turn/completed','params':{'threadId':p['threadId'],'turn':{'id':p['turnId'],'status':'interrupted'}}})
 elif m=='turn/start':`)
    .replace("  def tool(name,args):", "  if text.startswith('Keyboard hold'):continue\n  def tool(name,args):");
const runner = path.join(root, 'codex');
fs.writeFileSync(runner, edge, {mode: 0o700});
let host, browser;
const env = {
    PATH: process.env.PATH,
    HOME: root,
    CODEX_HOME: nativeHome,
    XDG_DATA_HOME: path.join(root,'data'),
    XDG_CONFIG_HOME: path.join(root,'config'),
    XDG_RUNTIME_DIR: path.join(root,'runtime'),
};
async function until(check, description) {
    for (let i=0;i<200;i++) {
        const value = await check();
        if (value) return value;
        await wait(100);
    }
    throw Error('Timed out waiting for ' + description);
}
async function stopHost() {
    if (!host || host.exitCode !== null || host.signalCode !== null) return;
    const exited = new Promise(resolve => host.once('exit', resolve));
    host.kill('SIGINT');
    await exited;
}
async function startHost() {
    host = spawn(binary, ['serve','--foreground','--project',project,'--state-dir',state,'--codex',runner,'--no-open'], {stdio: 'inherit', env});
    const launcher = await until(async () => {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(state,'launcher.json')));
            if ((await fetch('http://'+data.host+'/')).ok) return data;
        } catch {}
    }, 'isolated host');
    const base = 'http://' + launcher.host;
    const response = await fetch(base+'/launch', {method:'POST', body:launcher.admin});
    assert(response.ok, await response.clone().text());
    return {base, url:(await response.json()).url};
}
const wire = method => fs.readFileSync(path.join(root,'wire'),'utf8').trim().split('\n').map(JSON.parse).filter(entry=>entry.method===method);
function assertHistory(session, live) {
    const db = new DatabaseSync(path.join(state,'state.db'), {readOnly:true});
    try {
        const rows = db.prepare("SELECT body FROM session_events WHERE session=? AND kind LIKE 'steering:%'").all(session);
        assert.deepEqual(rows.map(r=>JSON.parse(r.body)).map(r=>[r.role,r.promptId,r.turnId,r.text]), [['user',live.id,live.expectedTurnId,live.text]]);
    } finally {
        db.close();
    }
}
(async () => {
    let {base,url} = await startHost();
    browser = await chromium.launch({executablePath:process.env.DECK2_CHROMIUM || '/snap/bin/chromium',headless:true,args:['--no-sandbox']});
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    if (process.env.DECK2_UI_ASSETS) {
        for (const file of ['app.js','app.css']) {
            await page.route('**/'+file, route=>route.fulfill({path:path.join(process.env.DECK2_UI_ASSETS,file), contentType:file.endsWith('.js')?'application/javascript':'text/css'}));
        }
    }
    await page.goto(url);
    const ws = async()=> (await page.request.get(base+'/api/workspace')).json();
    await page.getByRole('button',{name:'New session in project',exact:true}).press('Enter');
    await page.getByLabel('Session name',{exact:true}).fill('Live steering fixture');
    await page.getByRole('button',{name:'Create session',exact:true}).click();
    const session = await until(async()=> (await ws()).sessions.find(s=>s.title==='Live steering fixture')?.id,'session creation');
    const prompt = page.locator('#prompt');
    await prompt.fill('Keyboard hold live steering fixture');
    await prompt.press('Enter');
    const held = await until(async()=> (await ws()).receipts.find(r=>r.session===session&&r.phase==='running'),'held active turn');
    const sendNow = page.getByRole('button',{name:'Send now',exact:true});
    await prompt.fill('live message through browser');
    const endpointPath = '/api/commands/'+held.id+'/steering';
    const endpoint = base+endpointPath;
    const command = (text, overrides={})=>({id:randomUUID(),session,threadId:held.thread,expectedTurnId:held.turn,text,...overrides});
    const post = (data, context=page.request) => context.post(base+endpointPath,{data,headers:{origin:base}});
    const bad = await post(command('stale target',{expectedTurnId:'expired-turn'}));
    assert.equal(bad.status(),409,'host must refuse a mismatched expected turn');
    if (process.env.DECK2_STEERING_RED_ONLY) return;
    const denied = await post(command('spoofed browser request'), await browser.newContext().then(c=>c.request));
    assert.equal(denied.status(),403);
    await page.route(endpoint, async route=>{await route.fetch();await route.abort('failed');},{times:1});
    await sendNow.click();
    const accepted = await until(async()=> (await ws()).receipts.find(r=>r.id===held.id)?.steering?.find(s=>s.state==='accepted'),'durable live acknowledgment');
    assert.equal(accepted.text,'live message through browser');
    assert.equal(accepted.threadId,held.thread);
    assert.equal(accepted.expectedTurnId,held.turn);
    await page.getByText(accepted.text,{exact:true}).waitFor();
    await until(async()=> (await prompt.inputValue())==='','acknowledged draft clear');
    await page.reload();
    await page.getByText(accepted.text,{exact:true}).waitFor();
    assert((await post(acceptedCommand(accepted))).ok());
    assert.equal((await post({...acceptedCommand(accepted),text:'changed payload'})).status(),409);
    assert.equal(wire('turn/steer').length,1);
    assert.equal(wire('turn/steer')[0].params.clientUserMessageId,accepted.id);

    await prompt.fill('reject at native');
    await sendNow.click();
    await until(async()=> (await ws()).receipts.find(r=>r.id===held.id)?.steering?.some(s=>s.state==='rejected'),'rejected native steering');
    assert.equal(await prompt.inputValue(),'reject at native');

    await prompt.fill('queue after held turn');
    await page.getByRole('button',{name:'Queue for next turn',exact:true}).click();
    const queued = await until(async()=> (await ws()).receipts.find(r=>r.session===session&&r.phase==='queued'),'explicit queue');
    const staleView = await ws();
    await prompt.fill('lose native ack');
    await sendNow.click();
    await until(async()=>wire('turn/steer').length===3,'ambiguous dispatch');
    const stop = page.getByRole('button',{name:'Stop Lead',exact:true});
    await stop.click();
    await until(async()=> (await ws()).receipts.find(r=>r.id===queued.id)?.phase==='completed','queued turn completes');
    const old = (await ws()).receipts.find(r=>r.id===held.id);
    const lost = old.steering.find(s=>s.text==='lose native ack');
    assert.equal(lost.state,'uncertain');
    assert.equal(await prompt.inputValue(),'lose native ack');
    assert((await post(acceptedCommand(lost))).ok());
    assert.equal((await post(command('stale after settlement'))).status(),409);
    assert.equal(wire('turn/start').length,2);
    assert.equal(wire('turn/steer').length,3);

    // The browser is allowed to be a poll behind the host. This click goes
    // through the stale live control and still leaves the draft untouched.
    await page.route(base+'/api/workspace', route=>route.fulfill({json:staleView}));
    await prompt.fill('keep the stale live draft');
    const staleResponse = page.waitForResponse(r=>r.url()===endpoint&&r.request().method()==='POST');
    await sendNow.click();
    assert.equal((await staleResponse).status(),409);
    assert.equal(await prompt.inputValue(),'keep the stale live draft');
    await page.unroute(base+'/api/workspace');

    await stopHost();
    ({base,url} = await startHost());
    await page.goto(url);
    await page.getByText(accepted.text,{exact:true}).waitFor();
    const after = (await ws()).receipts.find(r=>r.id===held.id);
    assert.deepEqual(after.steering,old.steering);
    assertHistory(session, accepted);
    assert.equal(await prompt.inputValue(),'keep the stale live draft');
    assert((await post(acceptedCommand(lost))).ok());
    assert.equal(wire('turn/start').length,2);
    assert.equal(wire('turn/steer').length,3);

    await prompt.fill('Keyboard hold across host restart');
    await prompt.press('Enter');
    await until(async()=> (await ws()).receipts.find(r=>r.session===session&&r.phase==='running'),'second held turn');
    await prompt.fill('queue across host restart');
    await page.getByRole('button',{name:'Queue for next turn',exact:true}).click();
    const waiting = await until(async()=> (await ws()).receipts.find(r=>r.session===session&&r.phase==='queued'),'queue before restart');
    assert.equal(waiting.dispatch_ms,null);
    assert.equal(wire('turn/start').length,3);
    await stopHost();
    ({base,url} = await startHost());
    await page.goto(url);
    await until(async()=> (await ws()).receipts?.find(r=>r.id===waiting.id)?.phase==='completed','queued turn completes after restart');
    assert.equal(wire('turn/start').length,4,'only the undispatched queued turn starts on restart');
    assert.equal(wire('turn/steer').length,3,'restart never replays live input');
    console.log('Passed authenticated steering, stale rejection, lost browser response, idempotence, native rejection, Stop, uncertain delivery, queue continuity, and restart history.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    await browser?.close();
    await stopHost();
    console.log('Isolated fixture:', root);
});
function acceptedCommand({id,session,threadId,expectedTurnId,text}) { return {id,session,threadId,expectedTurnId,text}; }
