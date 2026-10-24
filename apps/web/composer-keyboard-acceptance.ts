/** Current source, synthetic HTTP/WebSocket effects; never connects to the Deck daemon. */
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const build = await Bun.build({ entrypoints: [`${import.meta.dir}/src/main.tsx`], target: 'browser' });
assert(build.success, build.logs.map(String).join('\n'));
const assets = new Map(build.outputs.map(output => [output.path.split('/').at(-1)!, output]));
const project = { projectId: 'project', name: 'Keyboard fixture', path: '/tmp/deck-keyboard-fixture', available: true };
const session = { sessionId: 'one', projectId: 'project', title: 'Keyboard fixture', state: 'running', generation: 2, preparationStatus: 'ready', lastSeq: 20, members: { lead: { runnerId: 'codex', modelId: 'fixture' } } };
const originalText = 'Original prompt\nwith a second line';
const event = (seq: number, kind: string, data: any) => ({ v: 1, sessionId: 'one', seq, ts: '2026-10-23T12:00:00Z', kind, source: { taskId: 'lead-g2', memberId: 'lead' }, data });
const original = { ...event(6, 'message.completed', { role: 'user', text: originalText, promptId: 'original' }), historyId: 6 };
const events = [event(1, 'task.created', { taskId: 'lead-g2', state: 'running', attempt: 3 }), event(2, 'session.state', { state: 'running' }), event(5, 'prompt.dispatched', { taskId: 'lead-g2', attempt: 3, promptId: 'original' }), event(7, 'turn.started', { attempt: 3 })];
const recalledImage={attachmentId:'fixture-image',name:'recalled.png',mimeType:'image/png',sizeBytes:70};
let pendingDispatch=false,deliveryUnknown=false,stoppedPending=false;
let commands: any[] = [], historyLookups = 0, delay = 0, failInterrupt = false, running = true, cancelMode = 'cancelled', queued: {promptId:string;text:string}[] = [];
const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: async (request, server) => {
    const url = new URL(request.url), path = url.pathname;
    const json = (value: unknown) => Response.json(value);
    if (path.endsWith('/events')) { if (server.upgrade(request)) return; return new Response(null, { status: 400 }); }
    const asset = assets.get(path.slice(1)); if (asset) return new Response(asset);
    if (path === '/') return new Response('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/main.css"></head><body><div id="root"></div><script type="module" src="/main.js"></script></body></html>', { headers: { 'Content-Type': 'text/html' } });
    if (path.endsWith('/attachments/fixture-image')) return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==','base64'),{headers:{'Content-Type':'image/png'}});
    if (path.endsWith('/history')) {
        if(pendingDispatch)return json({messages:[{...original,data:{...original.data,handoff:'pending',attachments:[recalledImage]}}],events:[...events.filter(e=>e.kind!=='turn.started').map(e=>e.kind==='prompt.dispatched'?{...e,data:{...e.data,handoff:'gated',text:originalText,attachments:[recalledImage]}}:e),...(deliveryUnknown?[event(8,'prompt.handoff',{promptId:'original',taskId:'lead-g2',attempt:3,state:'unknown'}),event(9,'prompt.state',{promptId:'original',state:'failed'})]:[])],seq:20});
        if (url.searchParams.has('after')) { assert.equal(url.searchParams.get('after'), '5'); historyLookups++; return json({ messages: [original], events: [], seq: 20 }); }
        return json({ messages: [{ ...event(20, 'message.completed', { text: 'Working…', role: 'assistant' }), historyId: 20 }], events: running ? events : [], seq: 20 });
    }
    if (path.endsWith('/summary')) return json({ ok: true, data: { session } });
    if (path.endsWith('/readiness')) return json({ ok: true, data: { status: 'ready', generation: 2 } });
    if (path === '/api/projects') return json({ ok: true, data: { projects: [project] } });
    if (path === '/api/sessions' || path === '/api/sessions/status') return json({ ok: true, data: { sessions: [session] } });
    if (path.endsWith('/prompts')) return json({ ok: true, data: { seq: 20, paused: stoppedPending, queued, ...(running && !stoppedPending ? {active: { promptId: 'original', taskId: 'lead-g2', attempt: 3, state: 'dispatched', ...(pendingDispatch?{handoff:'pending',text:originalText,attachments:[recalledImage]}:{}) }} : {}) } });
    if (path.endsWith('/decisions')) return json({ ok: true, data: { decisions: [] } });
    if (path === '/api/replies') return json({ total: 0, replies: [] });
    if (path.endsWith('/replies')) return json({ replies: [] });
    if (path === '/api/commands') {
        const body = await request.json() as any; commands.push(body);
        if (body.command.type === 'turn.interrupt') { await Bun.sleep(delay); if (failInterrupt) return json({ ok: false, message: 'Fixture interruption failed' }); if(pendingDispatch){stoppedPending=true;queued=[{promptId:'original',text:originalText,attachments:[recalledImage],requeued:true} as any,...queued];} }
        if (body.command.type === 'prompt.cancel') {
            await Bun.sleep(delay);
            if (cancelMode === 'consumed') return json({ok:false,code:'prompt-already-started',message:'The prompt already started.'});
            if (cancelMode === 'uncertain') return json({ok:true,data:{}});
            // Deliberately leave the HTTP projection stale: a confirmed recall must not duplicate text.
            return json({ok:true,data:{promptId:body.command.promptId,state:'cancelled'}});
        }
        return json({ ok: true, data: {} });
    }
    return json({ ok: true, data: {}, changes: [], enabled: false });
}, websocket: { message() {} } });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
const errors: string[] = [];
async function fresh(touch = false, width = 1440, queue: typeof queued = [], active = true, pending = false, unknown = false) {
    pendingDispatch=pending; deliveryUnknown=unknown;stoppedPending=false; commands = []; historyLookups = 0; delay = 0; failInterrupt = false; queued = queue; running = active; cancelMode = 'cancelled';
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: touch });
    const page = await context.newPage(); page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
    await page.goto(`${server.url}?session=one`);
    const input = page.locator('#prompt'); try { await expect(input).toBeEnabled(); } catch (error) { console.error(await page.locator('body').innerText()); throw error; }
    if (active) await expect(page.getByRole('button', { name: 'Interrupt', exact: true })).toBeEnabled();
    await page.waitForTimeout(200); await input.focus();
    return { context, page, input };
}
const interrupts = () => commands.filter(body => body.command.type === 'turn.interrupt');
const recallHint = 'Press Esc again to recall your unread message';
try {
    {
        for(const width of [390,320,1440]){
            const {context,page,input}=await fresh(width<1000,width,[{promptId:'later',text:'Queued later'}],true,true);
            await input.fill('Keep this draft');delay=150;
            await page.getByRole('button',{name:'Interrupt',exact:true}).click();
            await expect(input).toHaveValue(originalText+'\n\nKeep this draft');await expect(input).toBeFocused();
            assert.deepEqual(commands.filter(b=>['turn.interrupt','prompt.cancel'].includes(b.command.type)).map(b=>[b.command.type,b.command.promptId]),[['turn.interrupt',undefined],['prompt.cancel','original']]);
            await expect(page.getByRole('button',{name:'Preview attached image 1: recalled.png',exact:true})).toBeVisible();
            assert.equal(commands.filter(b=>b.command.type==='prompt.send').length,0);
            await context.close();
        }
        console.log('PASS Stop interrupts before restoring only requeued active input with images at 390/320/1440');
    }
    {
        for(const width of [390,320,1440]){
            const {context,page,input}=await fresh(width<1000,width,[{promptId:'later',text:'Edit me',attachments:[recalledImage]} as any]);
            await input.fill('Draft');delay=200;
            const edit=page.getByRole('button',{name:'Edit queued message 1',exact:true});assert((await edit.boundingBox())!.height>=44);
            await edit.click();await expect.poll(()=>commands.filter(b=>b.command.type==='prompt.cancel').length).toBe(1);
            await input.fill('Draft during request');await expect(input).toHaveValue('Edit me\n\nDraft during request');await expect(input).toBeFocused();
            await expect(page.getByRole('button',{name:'Preview attached image 1: recalled.png',exact:true})).toBeVisible();assert.equal(interrupts().length,0);
            await edit.click();await page.waitForTimeout(250);await expect(input).toHaveValue('Edit me\n\nDraft during request');assert.equal(commands.filter(b=>b.command.type==='prompt.cancel').length,1);
            await context.close();
        }
        console.log('PASS queue Edit preserves new draft and images after confirmation, never interrupts or duplicates');
    }
    {
        const { context, page, input } = await fresh();
        assert.equal(await input.getAttribute('enterkeyhint'), 'send');
        const before = await page.locator('#conversation').boundingBox();
        await input.fill('Keep my draft');
        await page.keyboard.press('Escape'); await expect(page.getByText('Press Esc again to interrupt', { exact: true })).toBeVisible();
        assert.deepEqual(await page.locator('#conversation').boundingBox(), before);
        await page.keyboard.press('Escape'); await expect(page.getByText('Lead turn interrupted.', {exact:true})).toBeVisible();
        await expect(input).toHaveValue('Keep my draft');
        assert.equal(interrupts().length, 1); assert.equal(interrupts()[0].sessionId, 'one'); assert.equal(interrupts()[0].command.taskId, 'lead-g2'); assert.equal(historyLookups, 0);
        await input.fill(''); await page.getByRole('button', {name:'Interrupt',exact:true}).click();
        await expect.poll(() => interrupts().length).toBe(2); await page.waitForTimeout(50); await expect(input).toHaveValue('');
        await input.fill('Desktop send'); await page.keyboard.press('Enter');
        await expect.poll(() => commands.some(body => body.command.type === 'prompt.send' && body.command.text === 'Desktop send')).toBe(true);
        await input.fill('Two'); await page.keyboard.press('Shift+Enter'); await expect(input).toHaveValue('Two\n');
        await context.close(); console.log('PASS Lead interruption via shortcut/button never restores consumed text; stable hint; desktop Enter');
    }
    {
        const { context, page, input } = await fresh(false, 1440, [{promptId:'older',text:'Older'}, {promptId:'latest',text:'Full unread\ntext'}]);
        await input.fill('Initial draft'); delay = 250;
        await page.locator('#conversation').click();
        await page.keyboard.press('Escape'); await expect(page.getByText(recallHint,{exact:true})).toBeVisible();
        await page.keyboard.press('Escape'); await expect.poll(() => commands.filter(body => body.command.type === 'prompt.cancel').length).toBe(1);
        await input.fill('Draft edited while recalling');
        const merged = 'Full unread\ntext\n\nDraft edited while recalling';
        await expect(input).toHaveValue(merged); await expect(input).toBeFocused();
        assert.deepEqual(await input.evaluate((node: HTMLTextAreaElement) => [node.selectionStart,node.selectionEnd]),[merged.length,merged.length]);
        assert.equal(commands.find(body => body.command.type === 'prompt.cancel').command.promptId,'latest'); assert.equal(interrupts().length,0);
        // Stale queued projection cannot recall the same message again; the next newest is eligible.
        await page.keyboard.press('Escape'); await expect(page.getByText(recallHint,{exact:true})).toBeVisible();
        await page.keyboard.press('Escape'); await expect(input).toHaveValue('Older\n\n'+merged);
        assert.deepEqual(commands.filter(body=>body.command.type==='prompt.cancel').map(body=>body.command.promptId),['latest','older']);
        await context.close(); console.log('PASS newest unread recall from chat, server acknowledgement, concurrent draft merge, focus/caret and stale projection protection');
    }
    for (const mode of ['consumed','uncertain']) {
        const { context, page, input } = await fresh(false,1440,[{promptId:'racing',text:'Do not restore'}]); cancelMode=mode;
        await input.fill('Keep'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
        await expect(page.getByText(mode==='consumed'?'This message was already read or delivery started. It could not be recalled.':'Recall could not be confirmed. Your draft is unchanged.',{exact:true})).toBeVisible();
        await expect(input).toHaveValue('Keep'); assert.equal(interrupts().length,0);
        await context.close(); console.log('PASS recall '+mode+' never restores or falsely confirms success');
    }
    {
        const { context, page, input } = await fresh();
        await page.keyboard.press('Escape'); await expect(page.getByText('Press Esc again to interrupt', { exact: true })).toBeVisible();
        await page.waitForTimeout(1100); await expect(page.getByText('Press Esc again to interrupt', { exact: true })).toHaveCount(0);
        await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Deck menu', exact: true }).click();
        await page.keyboard.press('Escape'); await expect(page.getByRole('menu', { name: 'Deck', exact: true })).toHaveCount(0);
        await input.focus(); await page.keyboard.press('Escape'); await expect(page.getByText('Press Esc again to interrupt', { exact: true })).toBeVisible(); assert.equal(interrupts().length, 0);
        await page.keyboard.press('Escape'); await expect.poll(()=>interrupts().length).toBe(1);
        await context.close(); console.log('PASS hint expiration and menu dismissal resets double Esc');
    }
    {
        const { context, page, input } = await fresh();
        await input.evaluate(node => node.addEventListener('keydown', event => event.preventDefault()));
        await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(50);
        assert.equal(interrupts().length, 0); await expect(page.getByText('Press Esc again to interrupt', { exact: true })).toHaveCount(0);
        await context.close(); console.log('PASS handled Escape never arms interruption');
    }
    {
        const { context, page, input } = await fresh();
        for(let i=0;i<2;i++) await input.dispatchEvent('keydown',{key:'Escape',isComposing:true,bubbles:true});
        await page.waitForTimeout(50); assert.equal(commands.length,0);
        await input.fill('IME'); await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,bubbles:true});
        await page.waitForTimeout(50); assert.equal(commands.length,0);
        await context.close(); console.log('PASS composition Escape and Enter do not act');
    }
    {
        const { context, page, input } = await fresh(false,1440,[],false);
        await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(50);
        assert.equal(commands.length,0); await expect(page.locator('.composer-interrupt-hint')).toHaveCount(0);
        await context.close(); console.log('PASS idle session does nothing');
    }
    {
        const { context, page, input } = await fresh(true);
        assert.equal(await input.getAttribute('enterkeyhint'), 'enter');
        await input.fill('Alpha Beta\nGamma'); await input.evaluate((node: HTMLTextAreaElement)=>node.setSelectionRange(5,5));
        await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await expect(input).toHaveValue('Alpha\n\n Beta\nGamma'); assert.equal(commands.length,0);
        const multiline='1\n2\n3\n4\n5\n6'; await input.fill(multiline);
        const size = await input.evaluate(node => { const style = getComputedStyle(node); return { height: node.clientHeight, maximum: parseFloat(style.lineHeight) * 4 + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom), overflow: style.overflowY }; });
        assert(size.height <= size.maximum + 1); assert.equal(size.overflow, 'auto');
        await page.getByRole('button', { name: 'Send prompt', exact: true }).click();
        await expect.poll(() => commands.filter(body => body.command.type === 'prompt.send').length).toBe(1);
        assert.equal(commands.find(body=>body.command.type==='prompt.send').command.text,multiline);
        await context.close(); console.log('PASS coarse pointer at desktop width: cursor newlines, four-line cap, Send preserves line breaks');
    }
    {
        const { context, page, input } = await fresh(false, 800);
        assert.equal(await input.getAttribute('enterkeyhint'), 'send'); await input.fill('Narrow keyboard'); await page.keyboard.press('Enter');
        await expect.poll(() => commands.filter(body => body.command.type === 'prompt.send').length).toBe(1);
        await context.close(); console.log('PASS narrow desktop viewport retains keyboard Enter=send');
    }
    {
        const {context,page,input}=await fresh(false,1440,[],true,true);
        await expect(page.getByText('Sending…',{exact:true})).toBeVisible();
        await input.fill('Existing draft');await page.keyboard.press('Escape');await expect(page.getByText(recallHint,{exact:true})).toBeVisible();await page.keyboard.press('Escape');
        await expect(input).toHaveValue(originalText+'\n\nExisting draft');await expect(page.getByRole('button',{name:'Preview attached image 1: recalled.png'})).toBeVisible();
        assert.equal(commands.filter(body=>body.command.type==='prompt.cancel').length,1);assert.equal(interrupts().length,0);
        await page.getByRole('button',{name:'Send prompt',exact:true}).click();
        await expect.poll(()=>commands.filter(body=>body.command.type==='prompt.send').length).toBe(1);
        assert.deepEqual(commands.find(body=>body.command.type==='prompt.send').command.attachmentIds,['fixture-image']);
        await context.close();console.log('PASS recall during starting-runner restores text and managed image without interrupt or reupload');
    }
    {
        const {context,page,input}=await fresh(false,1440,[],true,true,true);
        await expect(page.getByText('Delivery unconfirmed',{exact:false})).toBeVisible();
        await input.fill('Existing draft');await page.getByRole('button',{name:'Send again',exact:true}).click();
        await expect(input).toHaveValue(originalText+'\n\nExisting draft');await expect(page.getByRole('button',{name:'Preview attached image 1: recalled.png'})).toBeVisible();
        assert.equal(commands.length,0);await context.close();console.log('PASS unconfirmed Send again copies text/images without automatic resend or recall');
    }
    assert.deepEqual(errors, []);
} finally { await browser.close(); server.stop(true); }
