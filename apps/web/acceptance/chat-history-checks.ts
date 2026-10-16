import assert from 'node:assert/strict';
export async function accept({ page, log, host }: any) {
    const viewport = page.locator('#conversation');
    let pageRequests = 0;
    page.on('request', (r: any) => {
        if (r.url().includes('/history'))
            pageRequests++;
    });
    const anchor = () => viewport.evaluate((el: HTMLElement) => { const top = el.getBoundingClientRect().top; const row = [...el.querySelectorAll<HTMLElement>('[data-history-id]')].find(r => r.getBoundingClientRect().bottom > top); return row ? { id: row.dataset.historyId, offset: row.getBoundingClientRect().top - top, scroll: el.scrollTop } : undefined; });
    const waitPage = async () => { await page.waitForFunction(() => !document.querySelector('.history-navigation button:disabled')); await page.waitForTimeout(60); };
    await viewport.evaluate((el: HTMLElement) => { el.scrollTop = 120; });
    await page.waitForTimeout(30);
    const saved = await anchor();
    await viewport.dispatchEvent('wheel', { deltaY: -100 });
    await waitPage();
    const positioned = await viewport.evaluate((el: HTMLElement, id: string) => { const r = el.querySelector<HTMLElement>(`[data-history-id="${id}"]`)!; return r.getBoundingClientRect().top - el.getBoundingClientRect().top; }, saved.id);
    assert.ok(Math.abs(positioned - saved.offset) < 2, `prepend anchor drift ${positioned - saved.offset}`);
    const one = pageRequests;
    await page.waitForTimeout(500);
    assert.equal(pageRequests, one, 'no automatic page cascade');
    // Read beyond the former 500-row cap while keeping only a bounded window.
    for (let i = 0; i < 15; i++) {
        await viewport.evaluate((el: HTMLElement) => { el.scrollTop = 110; });
        await page.waitForTimeout(5);
        const a = await anchor();
        await page.locator('.history-navigation button').evaluate((b: HTMLButtonElement) => b.click());
        await waitPage();
        const offset = await viewport.evaluate((el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`[data-history-id="${id}"]`)!.getBoundingClientRect().top - el.getBoundingClientRect().top, a.id);
        assert.ok(Math.abs(offset - a.offset) < 2, `eviction anchor drift ${offset - a.offset}`);
        assert.ok(await page.locator('[data-history-id]').count() <= 120);
    }
    assert.match(await viewport.innerText(), /Synthetic message 53\d\d/);
    // Variable-height content above the visible row must preserve the same offset.
    await viewport.evaluate((el: HTMLElement) => { el.scrollTop = 1500; });
    await page.waitForTimeout(30);
    const beforeReflow = await anchor();
    await viewport.evaluate((el: HTMLElement) => { const row = el.querySelector<HTMLElement>('[data-history-id]')!; row.style.paddingTop = '177px'; });
    await page.waitForTimeout(100);
    const reflowOffset = await viewport.evaluate((el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`[data-history-id="${id}"]`)!.getBoundingClientRect().top - el.getBoundingClientRect().top, beforeReflow.id);
    assert.ok(Math.abs(reflowOffset - beforeReflow.offset) < 2, `reflow anchor drift ${reflowOffset - beforeReflow.offset}`);
    const reading = await anchor();
    log.append({ kind: 'approval.requested', source: { taskId: 'lead' }, data: { approvalId: 'visible-control' } });
    await page.getByRole('button', { name: 'Deny', exact: true }).waitFor();
    log.append({ kind: 'approval.resolved', data: { approvalId: 'visible-control' } });
    log.append({ kind: 'message.completed', source: { taskId: 'lead' }, data: { role: 'assistant', text: 'Synthetic live arrival' } });
    await page.waitForTimeout(100);
    assert.equal(await page.getByRole('button', { name: 'Deny', exact: true }).count(), 0);
    const stillReading = await anchor();
    assert.equal(stillReading.id, reading.id);
    assert.ok(Math.abs(stillReading.offset - reading.offset) < 2);
    assert.equal(await viewport.getByText('Synthetic live arrival', { exact: true }).count(), 0);
    // Close only this synthetic browser's socket, then receive more data while offline.
    await page.evaluate(() => {
        for (const ws of (window as any).__chatSockets ?? [])
            ws.close();
    });
    log.append({ kind: 'message.completed', source: { taskId: 'lead' }, data: { role: 'assistant', text: 'Synthetic reconnect arrival' } });
    await page.waitForTimeout(1400);
    const afterReconnect = await anchor();
    assert.equal(afterReconnect.id, reading.id);
    assert.ok(Math.abs(afterReconnect.offset - reading.offset) < 2);
    await page.getByRole('button', { name: 'Jump to latest ↓', exact: true }).click();
    await waitPage();
    await viewport.getByText('Synthetic reconnect arrival', { exact: true }).waitFor();
    assert.equal(await viewport.getByText('Synthetic live arrival', { exact: true }).count(), 1);
    assert.ok(await page.locator('[data-history-id]').count() <= 120);
    // Mobile has a separate layout and different wrapping heights.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(80);
    await viewport.evaluate((el: HTMLElement) => { el.scrollTop = 100; });
    await page.waitForTimeout(10);
    const mobile = await anchor();
    await viewport.evaluate((el: HTMLElement) => {
        for (const [kind, y] of [['touchstart', 100], ['touchmove', 150]] as const) {
            const e = new Event(kind, { bubbles: true });
            Object.defineProperty(e, 'touches', { value: [{ clientY: y }] });
            el.dispatchEvent(e);
        }
    });
    await waitPage();
    const mobileOffset = await viewport.evaluate((el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`[data-history-id="${id}"]`)!.getBoundingClientRect().top - el.getBoundingClientRect().top, mobile.id);
    assert.ok(Math.abs(mobileOffset - mobile.offset) < 2, `mobile anchor drift ${mobileOffset - mobile.offset}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.screenshot({ path: '/tmp/chat-history-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Walk to the beginning, exercising eviction and re-fetch rather than retaining DOM.
    let traversed = 0;
    while (await page.locator('.history-navigation button').count()) {
        await page.locator('.history-navigation button').evaluate((b: HTMLButtonElement) => b.click());
        await waitPage();
        traversed++;
        assert.ok(traversed < 160);
        assert.ok(await page.locator('[data-history-id]').count() <= 120);
    }
    assert.match(await viewport.innerText(), /Synthetic message 0\n/);
    // Forward navigation restores discarded rows without gaps.
    await page.getByRole('button', { name: 'Newer messages', exact: true }).evaluate((b: HTMLButtonElement) => b.click());
    await waitPage();
    const ids = await page.locator('[data-history-id]').evaluateAll((rows: HTMLElement[]) => rows.map(r => Number(r.dataset.historyId)));
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id: number, i: number) => !i || id === ids[i - 1] + 1));
    const navigatedDOM = await page.locator('[data-history-id]').count();
    const samples = [];
    for (let i = 0; i < 25; i++) {
        const start = performance.now();
        await page.locator('#prompt').pressSequentially('z');
        samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    // Latest fetch races with live deltas: replay only post-fence deltas, once.
    await page.getByRole('button', { name: 'Jump to latest ↓', exact: true }).click();
    await waitPage();
    await viewport.evaluate((el: HTMLElement) => { el.scrollTop = 100; });
    await viewport.dispatchEvent('wheel', { deltaY: -100 });
    await waitPage();
    let raced = false;
    await page.route('**/api/sessions/s/history', async (route: any) => {
        const response = await route.fetch();
        raced = true;
        log.append({ kind: 'message.delta', source: { taskId: 'lead' }, data: { text: 'Synthetic race ' } });
        log.append({ kind: 'message.delta', source: { taskId: 'lead' }, data: { text: 'arrived' } });
        await new Promise(r => setTimeout(r, 100));
        await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Jump to latest ↓', exact: true }).click();
    await waitPage();
    assert.ok(raced);
    await viewport.getByText('Synthetic race arrived', { exact: true }).waitFor();
    log.append({ kind: 'message.completed', source: { taskId: 'lead' }, data: { text: 'Synthetic completed race' } });
    await viewport.getByText('Synthetic completed race', { exact: true }).waitFor();
    assert.equal(await viewport.getByText('Synthetic race arrived', { exact: true }).count(), 0);
    await page.unroute('**/api/sessions/s/history');
    // A delayed old page may complete after a different session was selected.
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(r => release = r), pending = new Promise<void>(r => started = r);
    await page.route('**/api/sessions/s/history?before=*', async (route: any) => { const response = await route.fetch(); started(); await gate; await route.fulfill({ response }).catch(() => { }); });
    await page.locator('.history-navigation button').evaluate((b: HTMLButtonElement) => b.click());
    await pending;
    await page.getByRole('button', { name: 'Other session', exact: true }).click();
    release();
    await viewport.getByText('Other synthetic session', { exact: true }).waitFor();
    await page.waitForTimeout(150);
    assert.equal(await viewport.getByText(/Synthetic message/).count(), 0);
    assert.equal(await page.locator('[data-history-id]').count(), 1);
    await page.unroute('**/api/sessions/s/history?before=*');
    await page.getByRole('button', { name: 'Synthetic history', exact: true }).click();
    await page.locator('#prompt').waitFor();
    await waitPage();
    // Draft clearing follows the currently mounted composer across switches.
    let finishSend!: () => void, sendStarted!: () => void;
    const sendGate = new Promise<void>(r => finishSend = r), sendPending = new Promise<void>(r => sendStarted = r);
    await page.route('**/api/commands', async (route: any) => { sendStarted(); await sendGate; await route.fulfill({ json: { ok: true, data: {} } }); });
    await page.getByRole('button', { name: 'Send prompt', exact: true }).click();
    await sendPending;
    await page.getByRole('button', { name: 'Other session', exact: true }).click();
    await viewport.getByText('Other synthetic session', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Synthetic history', exact: true }).click();
    await page.locator('#prompt').waitFor();
    finishSend();
    await page.waitForFunction(() => (document.querySelector('#prompt') as HTMLTextAreaElement)?.value === '');
    await page.unroute('**/api/commands');
    // Typing does not mutate the conversation tree.
    await viewport.evaluate((el: HTMLElement) => { (window as any).__chatMutations = 0; new MutationObserver(records => (window as any).__chatMutations += records.length).observe(el, { subtree: true, childList: true, characterData: true, attributes: true }); });
    await page.locator('#prompt').pressSequentially('Synthetic typing');
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => (window as any).__chatMutations), 0);
    await viewport.dispatchEvent('wheel', { deltaY: 100 });
    log.append({ kind: 'message.completed', source: { taskId: 'lead' }, data: { text: 'Synthetic following at bottom' } });
    await viewport.getByText('Synthetic following at bottom', { exact: true }).waitFor();
    await page.waitForTimeout(60);
    assert.ok(await viewport.evaluate((el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 2));
    // Jump to latest remains effective while an older page is already in flight.
    let finishOlder!: () => void, olderStarted!: () => void;
    const olderGate = new Promise<void>(r => finishOlder = r), olderPending = new Promise<void>(r => olderStarted = r);
    await page.route('**/api/sessions/s/history?before=*', async (route: any) => { const response = await route.fetch(); olderStarted(); await olderGate; await route.fulfill({ response }); });
    await page.locator('.history-navigation button').evaluate((button: HTMLButtonElement) => button.click());
    await olderPending;
    log.append({ kind: 'message.completed', source: { taskId: 'lead' }, data: { text: 'Synthetic latest while loading' } });
    await page.getByRole('button', { name: 'Jump to latest ↓', exact: true }).click();
    finishOlder();
    await viewport.getByText('Synthetic latest while loading', { exact: true }).waitFor();
    await page.waitForTimeout(80);
    assert.ok(await viewport.evaluate((el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 2));
    await page.unroute('**/api/sessions/s/history?before=*');
    // An old visible stream can complete offline outside the recent 40-row page.
    log.append({ kind: 'turn.started', source: { taskId: 'lead' } });
    const offlineStart = log.append({ kind: 'message.delta', source: { taskId: 'lead' }, data: { text: 'Synthetic offline partial' } });
    for (let i = 0; i < 60; i++)
        log.append({ kind: 'message.completed', source: { taskId: 'lead' }, data: { role: 'user', text: `Synthetic offline user ${i}` } });
    await viewport.getByText('Synthetic offline user 59', { exact: true }).waitFor();
    await viewport.evaluate((el: HTMLElement, id: number) => { const row = el.querySelector<HTMLElement>(`[data-history-id="${id}"]`)!; el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - 50; }, offlineStart.seq);
    await page.waitForTimeout(40);
    const offlineAnchor = await anchor();
    await page.evaluate(() => {
        for (const ws of (window as any).__chatSockets ?? [])
            ws.close();
    });
    log.append({ kind: 'message.completed', source: { taskId: 'lead' }, data: { text: 'Synthetic offline completion' } });
    await viewport.getByText('Synthetic offline completion', { exact: true }).waitFor({ timeout: 5000 });
    assert.equal(await viewport.getByText('Synthetic offline partial', { exact: true }).count(), 0);
    const recoveredAnchor = await anchor();
    assert.equal(recoveredAnchor.id, offlineAnchor.id);
    assert.ok(Math.abs(recoveredAnchor.offset - offlineAnchor.offset) < 2);
    // Opening a task detail fetches its own bounded transcript, preserving all older turns.
    log.append({ kind: 'task.created', source: { taskId: 'child', memberId: 'deck-investigate' }, data: { taskId: 'child', memberId: 'deck-investigate', runnerId: 'synthetic', state: 'completed' } });
    for (let i = 0; i < 100; i++)
        log.append({ kind: 'message.completed', source: { taskId: 'child', memberId: 'deck-investigate' }, data: { text: `Synthetic child ${i}` } });
    await page.getByRole('tab', { name: 'Subagents', exact: true }).click();
    await page.getByRole('button', { name: 'Open full view' }).click();
    const taskTranscript = page.getByRole('log', { name: 'Investigate conversation', exact: true });
    await taskTranscript.getByText('Synthetic child 99', { exact: true }).waitFor();
    assert.equal(await taskTranscript.locator('[data-history-id]').count(), 40);
    assert.equal(await viewport.getByText(/Synthetic child/).count(), 0);
    await taskTranscript.evaluate((el:HTMLElement)=>{el.scrollTop=100;});
    await taskTranscript.dispatchEvent('wheel',{deltaY:-100});
    await page.waitForFunction(()=>document.querySelector('.progressive-transcript')?.querySelectorAll('[data-history-id]').length===80);
    await taskTranscript.getByRole('button',{name:'Older messages',exact:true}).evaluate((button:HTMLButtonElement)=>button.click());
    await taskTranscript.getByText('Synthetic child 0', { exact: true }).waitFor();
    assert.equal(await taskTranscript.locator('[data-history-id]').count(), 100);
    await taskTranscript.evaluate((el:HTMLElement)=>{el.scrollTop=100;});await page.waitForTimeout(60);
    const taskAnchor = await taskTranscript.evaluate((el: HTMLElement) => el.scrollTop);
    log.append({ kind: 'message.completed', source: { taskId: 'child', memberId: 'deck-investigate' }, data: { text: 'Synthetic child live' } });
    await page.waitForTimeout(80);
    assert.ok(Math.abs(await taskTranscript.evaluate((el: HTMLElement) => el.scrollTop) - taskAnchor) < 2);
    // A failed task-history request has a visible recovery action.
    await page.getByRole('button',{name:'← Subagents',exact:true}).click();
    await page.route('**/api/sessions/s/history?taskId=child',async(route:any)=>route.fulfill({status:503,json:{ok:false,code:'synthetic-history-failed'}}));
    await page.getByRole('button',{name:'Open full view'}).click();
    await page.getByRole('button',{name:'Retry history',exact:true}).waitFor();
    await page.unroute('**/api/sessions/s/history?taskId=child');
    await page.getByRole('button',{name:'Retry history',exact:true}).click();
    await taskTranscript.getByText('Synthetic child live',{exact:true}).waitFor();
    await page.screenshot({ path: '/tmp/chat-history-desktop.png' });
    console.log(JSON.stringify({ acceptance: 'passed', pageRequests, traversedToBeginning: traversed, anchorDrift: positioned - saved.offset, mobileAnchorDrift: mobileOffset - mobile.offset, domMessages: await viewport.locator('[data-history-id]').count(), navigatedDOM, typingAfterNavigation: { median: samples[12], p95: samples[23] } }, null, 2));
}
