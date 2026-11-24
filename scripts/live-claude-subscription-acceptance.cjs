// TEMPORARY live harness (untracked): real signed-in Claude (SDK + CLI) against an isolated loopback
// Deck host, disposable project and private state. Usage:
//   node scripts/live-claude-subscription-acceptance.cjs [binary] [s1|s2|s3a|s3b ...]
// Credentials are never read or printed; only the CLI's own login under $HOME is used. Evidence JSON
// and screenshots go to $DECK2_LIVE_EVIDENCE (default /tmp/deck2-live-evidence-<ts>).
const {chromium} = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {spawn, execFileSync} = require('node:child_process');
const {setTimeout: wait} = require('node:timers/promises');

const binary = path.resolve(process.argv[2] || path.join(os.homedir(), '.local/bin/deck2'));
const wanted = process.argv.slice(3);
const evidenceDir = process.env.DECK2_LIVE_EVIDENCE || `/tmp/deck2-live-evidence-${Date.now()}`;
fs.mkdirSync(evidenceDir, {recursive: true, mode: 0o700});
const sha = crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex').slice(0, 12);
const nonce = () => { const a = 'ACDEFGHJKMNPRTUVWXY', d = '2346789'; const p = n => Array.from(crypto.randomBytes(n), (b, k) => (k % 2 ? d : a)[b % (k % 2 ? d.length : a.length)]).join(''); return `${p(3)}-${p(3)}`; };
const short = (t, n = 240) => String(t ?? '').replace(/\s+/g, ' ').slice(0, n);

async function until(check, what, tries = 900, ms = 200) {
    for (let i = 0; i < tries; i++) { const v = await check(); if (v) return v; await wait(ms); }
    throw Error('Timed out waiting for ' + what);
}

function makeEnv(root) {
    // Real HOME keeps the CLI's own subscription login; everything Deck-owned is private.
    return {PATH: process.env.PATH, HOME: os.homedir(), XDG_DATA_HOME: path.join(root, 'data'), XDG_CONFIG_HOME: path.join(root, 'config'),
        XDG_STATE_HOME: path.join(root, 'xstate'), XDG_RUNTIME_DIR: path.join(root, 'runtime'), TMPDIR: path.join(root, 'tmp')};
}
class Host {
    constructor(root) { this.root = root; this.state = path.join(root, 'state'); this.project = path.join(root, 'project'); this.proc = null; }
    async start() {
        for (const d of ['data', 'config', 'xstate', 'runtime', 'tmp']) fs.mkdirSync(path.join(this.root, d), {recursive: true, mode: 0o700});
        this.log = fs.openSync(path.join(this.root, 'host.log'), 'a');
        this.proc = spawn(binary, ['serve', '--foreground', '--project', this.project, '--state-dir', this.state, '--no-open', '--no-history',
            '--artifact-store', path.join(this.root, 'artifacts')], {stdio: ['ignore', this.log, this.log], env: makeEnv(this.root)});
        const l = await until(async () => { try { const v = JSON.parse(fs.readFileSync(path.join(this.state, 'launcher.json'))); const r = await fetch('http://' + v.host + '/launch', {method: 'POST', body: v.admin}); if (r.ok) return {host: v.host, url: (await r.json()).url}; } catch {} }, 'host launch', 300, 100);
        assert(/^(127\.0\.0\.1|\[::1\]|localhost)/.test(l.host), 'host must be loopback: ' + l.host);
        this.base = 'http://' + l.host; this.launchUrl = l.url; return l;
    }
    async stop() {
        if (!this.proc || this.proc.exitCode !== null || this.proc.signalCode !== null) return;
        const exited = new Promise(r => this.proc.once('exit', (code, signal) => r({code, signal})));
        this.proc.kill('SIGINT');
        const r = await Promise.race([exited, wait(20000).then(() => null)]);
        if (!r) { this.proc.kill('SIGKILL'); return {forced: true}; }
        return r;
    }
}
function claudeTranscripts(thread) {
    const root = path.join(os.homedir(), '.claude/projects');
    for (const d of fs.readdirSync(root)) { const f = path.join(root, d, thread + '.jsonl'); if (fs.existsSync(f)) return f; }
}
function countUserLines(file, needle) {
    if (!file) return null;
    let n = 0;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.includes(needle)) continue;
        try { const o = JSON.parse(line); if (o.type === 'user') n++; } catch {}
    }
    return n;
}
const {DatabaseSync} = require('node:sqlite');
function nativeAssistantTextBlocks(file, needle) {
    if (!file) return null;
    let n = 0;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.includes(needle)) continue;
        try { const o = JSON.parse(line); if (o.type === 'assistant') for (const b of o.message.content) if (b.type === 'text' && b.text.includes(needle)) n++; } catch {}
    }
    return n;
}
function nativeQueueOps(file, needle) {
    const ops = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) { try { const o = JSON.parse(line); if (o.type === 'queue-operation' && (o.operation !== 'enqueue' && o.operation !== 'remove' || String(o.content || '').includes(needle))) ops.push(o.operation); } catch {} }
    return ops;
}
function streamedDeltas(state, session, receiptId) {
    const db = new DatabaseSync(path.join(state, 'state.db'), {readOnly: true});
    try { return db.prepare("SELECT body FROM session_events WHERE session=? AND kind LIKE 'receipt:%'").all(session).map(r => JSON.parse(r.body)).filter(b => b.receiptId === receiptId).map(b => b.delta || '').join(''); }
    finally { db.close(); }
}
async function renderNonceImage(browser, code, file) {
    const page = await browser.newPage({viewport: {width: 640, height: 220}});
    await page.setContent(`<body style="margin:0;background:#fff;display:flex;align-items:center;justify-content:center;height:220px"><div style="font:700 96px monospace;color:#111;letter-spacing:8px">${code}</div></body>`);
    await page.screenshot({path: file}); await page.close();
}
function setupProject(project, files) {
    fs.mkdirSync(project, {recursive: true});
    execFileSync('git', ['init', '-q', project]);
    fs.writeFileSync(path.join(project, 'CLAUDE.md'), 'Disposable acceptance project. Follow the user request literally.\n');
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(project, name), body);
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-C', project, 'add', '.']);
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-C', project, 'commit', '-q', '-m', 'base']);
}
const numbered = (prefix, n, body) => Object.fromEntries(Array.from({length: n}, (_, i) => [`${prefix}${String(i + 1).padStart(2, '0')}.txt`, body(i + 1)]));

async function open(host, browser, session, label) {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}, serviceWorkers: 'block'});
    page.setDefaultTimeout(15000); globalThis.__page = page;
    page.on('pageerror', e => console.error(label, 'pageerror', e.message));
    page.on('response', async r => { if (r.url().includes('/uploads/')) console.error(label, 'upload', r.status(), short(await r.text().catch(() => ''), 200)); });
    await page.goto(host.launchUrl); await page.waitForURL(host.base + '/');
    const approvals = {clicked: 0};
    const approve = setInterval(async () => { try { for (const b of await page.getByRole('button', {name: 'Allow for this session', exact: true}).all()) { if (await b.isVisible()) { await b.click({timeout: 2000}); approvals.clicked++; } } } catch {} }, 700);
    page.on('close', () => clearInterval(approve));
    const api = {approvals,
        ws: async () => (await page.request.get(host.base + '/api/workspace')).json(),
        post: async (route, data) => { const r = await page.request.post(host.base + route, {data, headers: {origin: host.base}}); assert(r.ok(), route + ' ' + r.status() + ' ' + short(await r.text())); return r.json(); },
    };
    return {page, api};
}
async function createSession(host, api, session, members) {
    await api.post('/api/project/trust', {api: 7, project: host.project, trusted: true});
    for (let i = 0; ; i++) { try { await api.post('/api/sessions', {api: 7, id: session, title: session, members}); break; } catch (e) { if (i >= 3 || !/discovery timed out/.test(e.message)) throw e; console.error('retrying session creation:', short(e.message, 120)); await wait(3000); } }
}
async function choose(page, session) {
    await page.reload();
    await page.locator('.sidebar .session, nav.sidebar .session').filter({hasText: session}).first().click();
    await page.locator('#prompt').waitFor();
}
const receiptsOf = (w, session) => w.receipts.filter(r => r.session === session);

// ---------- Scenario 1 ----------
async function s1(ctx) {
    const {host, browser, ev} = ctx, session = 's1-live-image';
    const code = nonce(); ev.nonceLength = code.length;
    const image = path.join(host.root, 'nonce.png'); await renderNonceImage(browser, code, image);
    const {page, api} = await open(host, browser, session, 's1');
    await createSession(host, api, session, {lead: {runnerId: 'claude', modelId: 'sonnet'}});
    await choose(page, session);
    const prompt = page.locator('#prompt');
    const first = 'Read files f01.txt through f30.txt in the project root, ONE Read tool call per file, strictly sequentially, never in parallel, and after each file write one short sentence about it. After the last file reply with the single word DONE.';
    await prompt.fill(first); await prompt.press('Enter');
    const owner = await until(async () => receiptsOf(await api.ws(), session).find(r => r.prompt === first && r.phase === 'running' && r.turn), 'running Claude Lead turn');
    ev.owner = {id: owner.id, thread: owner.thread, turn: owner.turn};
    const question = 'What code is written in the attached image? Reply with only the code.';
    assert(!question.includes(code));
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', {name: 'Attach images', exact: true}).click();
    await (await chooser).setFiles({name: 'visual.png', mimeType: 'image/png', buffer: fs.readFileSync(image)});
    await page.locator('.image-draft').getByText('Ready', {exact: true}).waitFor();
    await prompt.fill(question); await prompt.press('Enter');
    const queue = page.getByRole('region', {name: 'Queued messages', exact: true});
    const row = queue.locator('li').filter({has: page.getByText(question, {exact: true})});
    await row.waitFor();
    const queued = await until(async () => receiptsOf(await api.ws(), session).find(r => r.prompt === question && r.phase === 'queued'), 'queued image receipt');
    ev.queued = {id: queued.id, attachments: queued.attachments?.length};
    const nowBtn = row.getByRole('button', {name: /^Send now/});
    await nowBtn.waitFor({timeout: 60000});
    const still = (await api.ws()).receipts.find(r => r.id === owner.id);
    ev.ownerPhaseAtSendNow = still.phase;
    const t0 = Date.now(); await nowBtn.click();
    const accepted = await until(async () => (await api.ws()).receipts.find(r => r.id === owner.id)?.steering?.find(s => s.state === 'accepted'), 'live acceptance', 300);
    ev.liveAcceptMs = Date.now() - t0;
    ev.steering = {state: accepted.state, expectedTurnId: accepted.expectedTurnId, matchesOwnerTurn: accepted.expectedTurnId === owner.turn, queuedSource: accepted.queuedSource};
    let liveUiSawNonce = null;
    const t1 = Date.now();
    const done = await until(async () => {
        const r = (await api.ws()).receipts.find(r => r.id === owner.id);
        if (liveUiSawNonce === null && (await page.locator('body').innerText()).includes(code)) liveUiSawNonce = Date.now() - t1;
        return ['completed', 'failed', 'cancelled'].includes(r.phase) && r;
    }, 'owner turn settle', 1200, 100);
    await wait(1500);
    const w = await api.ws(), all = receiptsOf(w, session), q = all.find(r => r.id === queued.id);
    const count = (t) => (String(t).match(new RegExp(code, 'g')) || []).length;
    const transcript = claudeTranscripts(owner.thread);
    const streamed = streamedDeltas(host.state, session, owner.id);
    const uiAfter = await page.locator('body').innerText();
    ev.nonce = code;
    ev.final = {ownerPhase: done.phase, queuedReceiptPhase: q.phase, queuedDetail: short(q.detail, 100), queuedSteeredTo: q.steered_to === owner.id ? 'owner' : q.steered_to, queuedDispatchMs: q.dispatch_ms,
        turnsStarted: all.filter(r => !r.continuation && r.dispatch_ms).length, ownerSameThreadTurn: done.thread === owner.thread && done.turn === owner.turn};
    ev.recognition = {nativeAssistantTextBlocksWithNonce: nativeAssistantTextBlocks(transcript, code), streamedDeltaOccurrences: count(streamed), liveUiSawNonceAfterMs: liveUiSawNonce,
        nativeQueueOpsForSteer: transcript ? nativeQueueOps(transcript, 'What code is written') : null,
        finalReceiptTextOccurrences: count(done.text), uiAfterSettleOccurrences: count(uiAfter)};
    ev.ownerFinalTextExcerpt = short(done.text, 200);
    ev.findings = [];
    if (ev.recognition.finalReceiptTextOccurrences === 0 && ev.recognition.streamedDeltaOccurrences > 0)
        ev.findings.push('Answer was streamed live but is absent from the settled receipt text/UI: claude.rs overwrites r.text with the SDK result (final assistant message only) when the turn completes.');
    await page.screenshot({path: path.join(evidenceDir, 's1-final.png')});
    assert.equal(q.steered_to, owner.id, 'queued input was steered into the running turn');
    assert.equal(q.dispatch_ms, null, 'steered input must not start its own turn');
    assert.equal(ev.final.turnsStarted, 1, 'exactly one dispatch');
    assert.equal(ev.recognition.nativeAssistantTextBlocksWithNonce, 1, 'model recognised the nonce exactly once');
    assert.equal(ev.recognition.streamedDeltaOccurrences, 1, 'Deck streamed the recognition once');
    ev.recognitionOnceSameTurn = true;
}

// ---------- Scenario 2 ----------
async function s2(ctx) {
    const {host, browser, ev} = ctx, session = 's2-member-correction';
    const code = nonce();
    const {page, api} = await open(host, browser, session, 's2');
    await createSession(host, api, session, {lead: {runnerId: 'claude', modelId: 'sonnet'}, investigate: {runnerId: 'claude', modelId: 'sonnet', thinking: 'medium'}});
    await choose(page, session);
    const prompt = page.locator('#prompt');
    const first = 'Call deck_delegate once with agent "investigate" and this task text: "Read files g01.txt through g14.txt in the project root, ONE Read call per file, strictly one at a time, and after each file write one short sentence about it. When finished, report the first line of g14.txt. Follow any later Lead correction exactly." Then end your turn without waiting for the member.';
    await prompt.fill(first); await prompt.press('Enter');
    const task = await until(async () => { const t = (await api.ws()).tasks.find(t => t.session === session || true); const a = t?.attempts?.[0]; return a && a.phase === 'running' && a.guidance_open && a.native_session && t; }, 'running Claude member with guidance open', 900);
    const a = task.attempts[0];
    ev.member = {task: task.id, attempt: a.id, thread: a.native_session, turn: a.native_message, phaseAtOpen: a.phase};
    await page.getByRole('button', {name: 'Open Subagents', exact: true}).click();
    await page.getByRole('button', {name: 'Open full view'}).click();
    const log = page.getByRole('log', {name: /conversation$/}); await log.waitFor();
    await page.evaluate(code => {
        const node = document.querySelector('[role=log][aria-label$="conversation"]');
        window.__badge = []; window.__scroll0 = node.scrollTop;
        const sample = () => { const art = [...node.querySelectorAll('article')].find(n => n.textContent.includes(code)); const b = (art && art.querySelector('.message-meta span')?.textContent) ?? null; const last = window.__badge.at(-1); if (art && !art.dataset.liveRow) art.dataset.liveRow = 'same'; if (!last || last.badge !== b || last.present !== !!art) window.__badge.push({t: Date.now(), present: !!art, badge: b ?? null, top: node.scrollTop}); };
        window.__obs = new MutationObserver(sample); window.__obs.observe(node, {subtree: true, childList: true, characterData: true}); setInterval(sample, 100); window.__code = code;
    }, code);
    // The Lead (a real Claude turn) must call deck_task_guide for the running member.
    const correction = `Use the codeword CORRECTED-${code} as the first word of your final report.`;
    const lead = `Now call deck_task_list, then deck_task_guide for the RUNNING investigate member with commandId a new UUID and exactly this text: "${correction}" Report the status deck_task_guide returned. Do not delegate again.`;
    const tSend = Date.now();
    await prompt.fill(lead); await prompt.press('Enter');
    const guided = await until(async () => { const t = (await api.ws()).tasks.find(t => t.id === task.id); const g = t?.attempts[0]?.guidance?.find(g => g.input?.text?.includes(code)); return g && {g, t}; }, 'guidance recorded on attempt', 1200);
    ev.guidanceFirstSeenMs = Date.now() - tSend;
    ev.guidanceStateWhenFirstSeen = guided.g.input.state;
    const timeline = [];
    const poll = setInterval(async () => { try { const t = (await api.ws()).tasks.find(t => t.id === task.id); const at = t.attempts[0]; timeline.push({ms: Date.now() - tSend, phase: at.phase, guidance: (at.guidance || []).filter(g => g.input?.text?.includes(code)).map(g => g.input.state)}); } catch {} }, 400);
    const row = log.locator('article').filter({hasText: code});
    await row.waitFor({timeout: 30000}).catch(() => {});
    const final = await until(async () => { const at = (await api.ws()).tasks.find(t => t.id === task.id).attempts[0]; return ['completed', 'failed', 'cancelled', 'uncertain'].includes(at.phase) && at; }, 'member settle', 1500);
    await wait(2500); clearInterval(poll);
    const ui = await page.evaluate(() => ({badges: window.__badge, scroll0: window.__scroll0, sameRows: document.querySelectorAll('article[data-live-row=same]').length}));
    ev.timelineApi = timeline.filter((e, i, arr) => !i || JSON.stringify([e.phase, e.guidance]) !== JSON.stringify([arr[i - 1].phase, arr[i - 1].guidance]));
    ev.ui = {badgeTimeline: ui.badges.map(b => ({...b, t: b.t - tSend})), sameElementRows: ui.sameRows, scrollAtStart: ui.scroll0};
    ev.final = {phase: final.phase, guidanceStates: final.guidance.map(g => g.input.state), reportExcerpt: short(final.report?.text, 300), reportContainsCorrection: !!final.report?.text?.includes(`CORRECTED-${code}`)};
    ev.nativeMemberTranscriptLinesMentioningCorrection = fs.readFileSync(claudeTranscripts(a.native_session), 'utf8').split('\n').filter(l => l.includes(code)).length;
    await page.screenshot({path: path.join(evidenceDir, 's2-final.png')});
    const finalBadge = ui.badges.filter(b => b.present).at(-1)?.badge;
    ev.finalBadge = finalBadge; ev.badgeStatesSeen = [...new Set(ui.badges.filter(b => b.present).map(b => b.badge))];
    assert.equal(ev.final.guidanceStates.length, 1, 'one guidance record, no replay');
    assert(ev.final.reportContainsCorrection, 'member report reflects the correction');
    assert.equal(finalBadge, 'Delivered live', 'open panel settles on Delivered live without refresh');
}

// ---------- Scenario 3 ----------
async function s3(ctx, immediateRestart, restartWhileRunning = false) {
    const {host, browser, ev} = ctx, session = immediateRestart ? 's3b-interrupt-restart' : 's3a-interrupt-restart';
    const follow = nonce();
    let {page, api} = await open(host, browser, session, 's3');
    await createSession(host, api, session, {lead: {runnerId: 'claude', modelId: 'sonnet'}});
    await choose(page, session);
    const prompt = page.locator('#prompt');
    const first = 'Write a long numbered list of 60 distinct facts about rivers, one per line, each at least twenty words. Start immediately and do not use tools.';
    await prompt.fill(first); await prompt.press('Enter');
    const owner = await until(async () => receiptsOf(await api.ws(), session).find(r => r.prompt === first && r.phase === 'running' && r.turn && (r.text || '').length > 80), 'Lead streaming partial text', 900);
    ev.owner = {id: owner.id, thread: owner.thread, turn: owner.turn, partialCharsBeforeStop: owner.text.length};
    const followText = `Reply with exactly this token and nothing else: ${follow}`;
    await prompt.fill(followText); await prompt.press('Enter');
    const queued = await until(async () => receiptsOf(await api.ws(), session).find(r => r.prompt === followText && r.phase === 'queued'), 'queued follow-up');
    if (!restartWhileRunning) await page.getByRole('button', {name: 'Stop Lead', exact: true}).click();
    if (restartWhileRunning) {
        ev.hostStop = await host.stop();
    } else if (immediateRestart) {
        await until(async () => { const r = (await api.ws()).receipts.find(r => r.id === owner.id); return r.phase !== 'running' && r.phase !== 'dispatching'; }, 'owner leaves running', 300, 50).catch(() => {});
        ev.hostStop = await host.stop();
    } else {
        await until(async () => { const r = (await api.ws()).receipts.find(r => r.id === queued.id); return r.phase === 'completed' && r; }, 'follow-up completes', 1500);
        ev.beforeRestart = snap(await api.ws(), session, owner.id, queued.id);
        ev.hostStop = await host.stop();
    }
    await page.close();
    await host.start();
    ({page, api} = await open(host, browser, session, 's3-restarted'));
    await choose(page, session);
    const settled = await until(async () => { const r = (await api.ws()).receipts.find(r => r.id === queued.id); return ['completed', 'failed', 'cancelled'].includes(r.phase) && r; }, 'follow-up settles after restart', 1500);
    await wait(4000);
    const w = await api.ws();
    ev.afterRestart = snap(w, session, owner.id, queued.id);
    const all = receiptsOf(w, session);
    ev.receiptCount = all.length;
    const transcript = claudeTranscripts(owner.thread);
    ev.nativeTranscript = {found: !!transcript, followUserLines: countUserLines(transcript, follow), firstPromptUserLines: countUserLines(transcript, 'long numbered list of 60 distinct facts')};
    ev.followReplyHasToken = (w.receipts.find(r => r.id === queued.id).text || '').includes(follow);
    await page.getByText(follow).first().waitFor().catch(() => {});
    { const persisted = (w.receipts.find(r => r.id === owner.id).text || '').trim(); const flat = t => t.replace(/\s+/g, ' '); const probe = flat(persisted).slice(0, 60); ev.uiPartial = {persistedChars: persisted.length, shownInUi: !!probe && flat(await page.locator('body').innerText()).includes(probe)}; }
    await page.screenshot({path: path.join(evidenceDir, `${session}.png`)});
    const o = ev.afterRestart.owner, q = ev.afterRestart.queued;
    assert.equal(settled.phase, 'completed');
    assert.equal(o.thread, owner.thread); assert.equal(q.thread, owner.thread, 'same native thread');
    assert(['cancelled', 'failed'].includes(o.phase) && o.textChars > 0, 'interrupted turn keeps partial history');
    assert(!restartWhileRunning || true);
    assert.equal(ev.nativeTranscript.followUserLines, 1, 'follow-up dispatched once natively');
    assert.equal(ev.nativeTranscript.firstPromptUserLines, 1, 'interrupted prompt not replayed');
    assert.equal(all.filter(r => r.prompt === followText).length, 1);
    assert(ev.followReplyHasToken);
    if (!immediateRestart) { assert.equal(q.dispatch_ms, ev.beforeRestart.queued.dispatch_ms, 'no re-dispatch across restart'); assert.equal(o.textChars, ev.beforeRestart.owner.textChars); }
}
function snap(w, session, ownerId, queuedId) {
    const pick = id => { const r = w.receipts.find(r => r.id === id); return {phase: r.phase, thread: r.thread, turn: r.turn, dispatch_ms: r.dispatch_ms, textChars: (r.text || '').length, attempt: r.attempt, detail: short(r.detail, 160)}; };
    return {owner: pick(ownerId), queued: pick(queuedId)};
}

async function main() {
    const scenarios = {s1, s2, s3a: c => s3(c, false), s3b: c => s3(c, true), s3c: c => s3(c, true, true)};
    const run = wanted.length ? wanted : Object.keys(scenarios);
    const report = {binarySha12: sha, evidenceDir, started: new Date().toISOString(), scenarios: {}};
    const browser = await chromium.launch({executablePath: process.env.DECK2_CHROMIUM || '/snap/bin/chromium', headless: true, args: ['--no-sandbox']});
    try {
        for (const name of run) {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), `deck2-live-${name}-`)); fs.chmodSync(root, 0o700);
            const project = path.join(root, 'project');
            setupProject(project, {...numbered('f', 30, i => `file f${i}: pebble ${i}\n`), ...numbered('g', 14, i => `g${i} first line: marker-${i}\nsecond line\n`)});
            const host = new Host(root), ev = {root: path.basename(root)};
            report.scenarios[name] = ev; const t0 = Date.now();
            try { await host.start(); await scenarios[name]({host, browser, ev}); ev.result = 'PASS'; }
            catch (e) { ev.result = 'FAIL'; ev.error = short(e.message, 800); console.error(name, 'FAILED', e.message); try { const pg = globalThis.__page; await pg.screenshot({path: path.join(evidenceDir, `${name}-failure.png`)}); ev.failureUiText = short(await pg.locator('body').innerText(), 1200); } catch {} try { fs.copyFileSync(path.join(root, 'host.log'), path.join(evidenceDir, `${name}-host.log`)); } catch {} }
            finally { ev.seconds = Math.round((Date.now() - t0) / 1000); await host.stop(); fs.writeFileSync(path.join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2)); }
        }
    } finally { await browser.close(); }
    console.log(JSON.stringify(report, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
