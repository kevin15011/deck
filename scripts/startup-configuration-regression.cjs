// STARTUP-Q01: private historical copy, packaged host/browser, no commands or model calls.
// Never serialize message content, native identifiers, launcher credentials or DOM captures.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const source = path.resolve(process.argv[2] || 'target/startup-configuration-incident/state-copy.db');
const out = path.resolve(process.env.DECK2_EVIDENCE_DIR || 'target/startup-configuration-incident/browser');
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
const root = fs.mkdtempSync(path.join(out, 'private-')), state = path.join(root, 'state');
fs.mkdirSync(state, { mode: 0o700 });
const db = path.join(state, 'state.db'), binary = path.resolve('dist/deck2');
const py = code => JSON.parse(execFileSync('python3', ['-c', code, source, db], { encoding: 'utf8' }));
const before = py(`import sqlite3,sys,json,hashlib
s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close()
print(json.dumps({'project':dict(s.execute('select * from meta'))['project'],'receipts':[hashlib.sha256(x[0].encode()).hexdigest() for x in s.execute('select body from receipts order by rowid')],'sessions':[hashlib.sha256(x[0].encode()).hexdigest() for x in s.execute('select body from sessions order by rowid')]}))`);
fs.chmodSync(db, 0o600);
const sentinel = path.join(root, 'version-only');
fs.writeFileSync(sentinel, '#!/usr/bin/python3\nimport sys,pathlib\np=pathlib.Path(__file__).parent\nwith (p/"native-invocations").open("a") as f:f.write("version\\n" if sys.argv[1:]==["--version"] else "unexpected\\n")\nassert sys.argv[1:]==["--version"]\nprint("codex-cli 0.166.0")\n', { mode: 0o700 });
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sourceHash = sha(source), started = Date.now();
let host, browser, page;
const result = { binary_sha256: sha(binary), kind: 'Private historical state copy; no provider calls or replay', checks: [] };
const delay = ms => new Promise(r => setTimeout(r, ms));
async function start() {
  const old = fs.existsSync(path.join(state, 'launcher.json')) ? fs.readFileSync(path.join(state, 'launcher.json'), 'utf8') : '';
  const log = fs.openSync(path.join(root, 'host.log'), 'a', 0o600);
  host = spawn(binary, ['serve', '--project', before.project, '--state-dir', state, '--codex', sentinel, '--no-open'], { stdio: ['ignore', log, log] });
  fs.closeSync(log);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    assert.equal(host.exitCode, null, 'host stopped before ready');
    if (fs.existsSync(path.join(state, 'launcher.json')) && fs.readFileSync(path.join(state, 'launcher.json'), 'utf8') !== old) break;
    await delay(40);
  }
  assert(fs.existsSync(path.join(state, 'launcher.json')), 'host readiness timeout');
  const launcher = JSON.parse(fs.readFileSync(path.join(state, 'launcher.json')));
  const base = 'http://' + launcher.host;
  const launch = await (await fetch(base + '/launch', { method: 'POST', body: launcher.admin })).json();
  await page.goto(launch.url);
  await page.waitForFunction(() => document.querySelector('.connection')?.textContent.includes('Connected'));
  return base;
}
async function stop() {
  if (host && host.exitCode === null) { host.kill('SIGINT'); await new Promise(r => host.once('exit', r)); }
}
(async () => {
  try {
    browser = await chromium.launch({ executablePath: '/snap/bin/chromium', headless: true, args: ['--no-sandbox'] });
    page = await browser.newPage({ reducedMotion: 'reduce' });
    let commands = 0, errors = 0;
    page.on('pageerror', () => errors++);
    await page.route('**/api/commands', route => { commands++; return route.abort(); });
    let base = await start();
    let w = await (await page.request.get(base + '/api/workspace')).json();
    assert.equal(w.receipts.length, before.receipts.length);
    assert.equal(w.sessions.length, before.sessions.length);
    const prompt = page.locator('#prompt');
    await prompt.fill('Private synthetic draft remains after recovery');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.connection')?.textContent.includes('Connected'));
    assert.equal(await prompt.inputValue(), 'Private synthetic draft remains after recovery');
    result.checks.push('Packaged browser authenticates and reads retained history; isolated browser draft survives reload');
    await stop(); base = await start();
    w = await (await page.request.get(base + '/api/workspace')).json();
    assert.equal(w.receipts.length, before.receipts.length);
    assert.equal(await prompt.inputValue(), 'Private synthetic draft remains after recovery');
    await stop();
    const after = py(`import sqlite3,sys,json,hashlib
c=sqlite3.connect('file:'+sys.argv[2]+'?mode=ro',uri=True)
print(json.dumps({'schema':dict(c.execute('select * from meta'))['schema'],'receipts':[hashlib.sha256(x[0].encode()).hexdigest() for x in c.execute('select body from receipts order by rowid')],'sessions':[hashlib.sha256(x[0].encode()).hexdigest() for x in c.execute('select body from sessions order by rowid')]}))`);
    assert.deepEqual(after.receipts, before.receipts);
    assert.deepEqual(after.sessions, before.sessions);
    assert.equal(after.schema, '11');
    assert.equal(sha(source), sourceHash);
    assert.equal(commands, 0); assert.equal(errors, 0);
    assert.deepEqual(fs.readFileSync(path.join(root, 'native-invocations'), 'utf8').trim().split('\n'), ['version', 'version']);
    result.checks.push('Schema8 copy migrates/reopens as schema11; exact receipt and conversation bytes/counts retained; source copy unchanged', 'No command requests, no replay; startup sentinel only received two version probes; no provider call path exercised');
    result.receipt_count = before.receipts.length; result.conversation_count = before.sessions.length; result.passed = true;
  } finally {
    await browser?.close(); await stop();
    result.duration_ms = Date.now() - started;
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(result));
  }
})().catch(() => { console.error('Private startup regression failed; inspect owned private fixture without exposing content.'); process.exitCode = 1; });
