const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');

// Exercise the production Subagents inspector with controlled workspace snapshots and exchanges.
async function main() {
 const root = path.resolve(__dirname, '..');
 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-conversation-'));
 let browser;
 try {
  fs.symlinkSync(path.join(root, 'node_modules'),path.join(temp, 'node_modules'),'dir');
  const entry = path.join(temp, 'entry.jsx');
  fs.writeFileSync(entry, `
   import React from ${JSON.stringify(path.join(root, 'node_modules/react/index.js'))};
   import {createRoot} from ${JSON.stringify(path.join(root, 'node_modules/react-dom/client.js'))};
   import {Subagents} from ${JSON.stringify(path.join(root, 'frontend/src/subagents.tsx'))};
   import {InlineSubagent} from ${JSON.stringify(path.join(root, 'frontend/src/inline-subagents.tsx'))};
   import {Markdown} from ${JSON.stringify(path.join(root, 'frontend/src/markdown.tsx'))};
   import {conversationTimeline,timelineRowCost} from ${JSON.stringify(path.join(root, 'frontend/src/conversation-timeline.ts'))};
   import {LiveTranscriptWindow} from ${JSON.stringify(path.join(root, 'frontend/src/transcript-window.tsx'))};
   import {Inspector} from ${JSON.stringify(path.join(root, 'frontend/src/inspector.tsx'))};
   import {workerCounts} from ${JSON.stringify(path.join(root, 'frontend/src/sidebar-state.ts'))};
   import ${JSON.stringify(path.join(root, 'frontend/src/style.css'))};
   import ${JSON.stringify(path.join(root, 'frontend/src/themes.css'))};
   import ${JSON.stringify(path.join(root, 'frontend/src/slice.css'))};
   import ${JSON.stringify(path.join(root, 'frontend/src/calm-workspace.css'))};
   import ${JSON.stringify(path.join(root, 'frontend/src/activity.css'))};
   const root = createRoot(document.getElementById('root'));
   const accepted_ms = Date.now() - 60_000;
   window.show = (phase = 'running') => root.render(
    <Subagents session="s" visible connected decisions={[]} onError={console.error}
     tasks={[{id:'t', session:'s', owner:'apply-fast', attempts:[
      {id:'old', accepted_ms, phase:'cancelled', provenance:{}, treatments:[]},
      ...Array.from({length:14}, (_,i) => ({id:'prior-'+i, accepted_ms, phase:'completed', provenance:{}, treatments:[]})),
      {id:'a', accepted_ms, phase, provenance:{}, treatments:[]}
     ]}]} />
   );
   const task = (id,phase,time,report = null) => ({
    id,session:'s',owner:'apply-fast',attempts:[{id:'a',accepted_ms:time,phase,report,provenance:{},treatments:[]}]
   });
   const previous = Array.from({length:9}, (_,i) => task('previous-'+i,'completed',100+i));
   const trigger = {current:null};
   window.showList = (phase, extra) => {
    const tasks = [task('initial','running',200), ...previous];
    if (phase) tasks.push(task('fresh',phase,201,phase==='completed'?{digest:'fresh',text:'Fresh result'}:null));
    for(let i=0;i<(extra??0);i++) tasks.push(task('later-'+i,'running',202+i));
    root.render(<Inspector session="list" open narrow={false} returnFocus={trigger}>
     <div className="workspace-tabs"><aside role="status">{workerCounts({tasks,receipts:[]},'s').active} active subagents</aside></div>
     <div className="workspace-stack"><section className="workspace-panel">
      <Subagents session="s" historySession visible connected decisions={[]} onError={console.error} tasks={tasks}/>
     </section></div>
    </Inspector>);
   };
   const lead = (id,accepted_ms,text) => ({id,session:'s',attempt:'lead-'+id,accepted_ms,phase:'completed',prompt:'',text});
   const turns = [lead('initial',100,'Original Lead receipt'),lead('retry',300,'Completed retry Lead receipt')];
   const prior = {id:'original-attempt',accepted_ms:110,phase:'failed',settled_ms:130,number:1,provenance:{runner:'codex'},report:{text:'Original attempt report'}};
   const retry = {id:'retried-attempt',accepted_ms:420,phase:'running',number:2,provenance:{runner:'codex'},authority:{root:'retry',attempt:'lead-retry'}};
   function LiveTimeline({attempts,step,receipts,layout=false}){
    const viewport=React.useRef(null),following=React.useRef(true);
    const task={id:'continued-task',session:'s',owner:'apply-fast',root:'initial',parent_attempt:'lead-initial',attempts};
    const rows=conversationTimeline(receipts,[task], 's');
    React.useLayoutEffect(()=>{
     if(!layout&&following.current)viewport.current.scrollTop=viewport.current.scrollHeight;
    });
    return <section ref={viewport} className="conversation" style={{height:layout?700:300}}>
     <LiveTranscriptWindow rows={rows} viewport={viewport} following={following} limit={120} preferStart={false} rowCost={timelineRowCost}>
      {row=>row.receipt?<Markdown text={row.receipt.text}/>:<InlineSubagent task={row.task} attempt={row.attempt} step={step} connected/>}
     </LiveTranscriptWindow>
    </section>;
   }
   window.showTimeline = state => root.render(<LiveTimeline
    receipts={[...turns,lead('next',400,'Later Lead receipt')]}
    attempts={state===0?[prior]:[prior,state===2?{...retry,phase:'completed',settled_ms:500,report:{text:'Retry attempt report'}}:retry]}
    step={{task:'continued-task',attempt:retry.id,kind:'reasoning',status:'running'}}/>);
   const lines = (count,label) => Array.from({length:count}, (_,i) => '- '+label+' '+i).join('\\n');
   window.showLayout = state => root.render(<LiveTimeline layout
    receipts={[lead('dense',100,lines(100,'Older line')),
     {...lead('live',200,state===0?'Awaiting native output':lines(18,'Live line')+(state===2?'\\n\\nLive reply updated':'')),phase:'running'},
     ...(state===2?[lead('new',500,'Latest receipt')]:[])]}
    attempts={[{...retry,accepted_ms:300,phase:state===0?'preparing':'running'},
     {...retry,id:'second-attempt',accepted_ms:350,phase:'preparing'}]}/>);
   if (location.search === '?layout') window.showLayout(0);
   else if (location.search === '?timeline') window.showTimeline(0);
   else if (location.search) window.showList();
   else window.show();
  `);
  execFileSync('bun', ['build', entry, '--target=browser', '--outdir', temp], {cwd:root});
  const bundle = fs.readFileSync(path.join(temp, 'entry.js'));
  const css = fs.readFileSync(path.join(temp, 'entry.css'));
  browser = process.env.DECK2_BROWSER_CDP
   ? await chromium.connectOverCDP(process.env.DECK2_BROWSER_CDP)
   : await chromium.launch({executablePath:process.env.DECK2_CHROMIUM || chromium.executablePath()});
  const page = await browser.newPage({viewport:{width:360,height:740}});
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const provenance = {runner:'codex', integration:'v1', content:'hash'};
  const rows = [];
  function append(source, role, offset, text, origin = provenance) {
   const sequence = (rows.length+1)*3;
   rows.push({sequence,id:String(sequence),source,role,offset,text,at_ms:110,provenance:origin});
   return offset+Buffer.byteLength(text);
  }
  append('lead-delegation','lead',0,'Actual prompt');
  let offset = append('member-output','apply-fast',0,'Sé buen  ');
  offset = append('member-output','apply-fast',offset,'\ncolega.');
  for (let i=0;i<28;i++) offset = append('member-output','apply-fast',offset,' ');
  offset = append('member-output','apply-fast',offset,'\n\n**de');
  offset = append('member-output','apply-fast',offset,' ayuda');
  offset = append('member-output','apply-fast',offset,'**');
  let settled = false;
  let freshActivity = false;
  const historyTask = i => ({
   id:'history-'+i, member:'quality', order:i,
   attempts:[{number:1,state:'completed',runner:'codex',model:'recorded',result:null}]
  });
  await page.route('http://conversation.test/**', route => {
   const url = new URL(route.request().url());
   if (url.pathname === '/' && url.search)
    return route.fulfill({contentType:'text/html',body:'<meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root" class="slice-panes" style="width:100vw;height:100vh"></div><script src="/app.js"></script>'});
   if (url.pathname === '/') return route.fulfill({contentType:'text/html',body:'<meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div class="slice-panes"><aside id="root" class="inspector" data-mode="floating" style="position:fixed;top:24px;right:12px;left:12px;height:650px;transform:translate(0)"></aside></div><script src="/app.js"></script>'});
   if (url.pathname === '/app.js') return route.fulfill({contentType:'text/javascript',body:bundle});
   if (url.pathname === '/avatars/apply-fast.png') return route.fulfill({path:path.join(root,'frontend/public/avatars/apply-fast.png')});
   if (url.pathname === '/app.css') return route.fulfill({contentType:'text/css',body:css});
   if (url.pathname.endsWith('/cancel')) return route.fulfill({json:{}});
   if (url.pathname === '/api/history/sessions/s') {
    const next = url.searchParams.has('tasksAfter');
    return route.fulfill({json:{session:'s',metadata:{projectRoot:'/fixture'},snapshot:'s',nextTask:next?null:'older',
     agentTasks:Array.from({length:next?20:35},(_,i)=>historyTask((next?1:21)+i))}});
   }
   const listTask = url.pathname.match(/^\/api\/sessions\/s\/tasks\/(fresh|initial|later-\d+)\/attempts\/a\/exchanges$/)?.[1];
   if (listTask) {
    const cursor = Number(url.searchParams.get('cursor'));
    const messages = listTask==='fresh'&&freshActivity&&!cursor?
     [{sequence:1,id:'1',source:'member-output',role:'apply-fast',offset:0,text:'Fresh activity',at_ms:110,provenance}]:[];
    return route.fulfill({json:{session:'s',task:listTask,attempt:'a',messages,nextCursor:messages.length?1:cursor,
     more:false,settled:false,recording:'recorded'}});
   }
   const [,attempt,endpoint] = url.pathname.match(/^\/api\/sessions\/s\/tasks\/t\/attempts\/([^/]+)\/(exchanges|transcript)$/) || [];
   if (!attempt) return route.fulfill({status:404});
   const identity = {session:'s',task:'t',attempt};
   if (endpoint === 'transcript') return route.fulfill({json:{...identity,prompt:'Old assignment',text:'Old attempt only',offset:0,nextOffset:16,more:false,settled:true}});
   const cursor = Number(url.searchParams.get('cursor'));
   const pending = attempt === 'a' ? rows.filter(row => row.sequence>cursor) : [];
   const messages = pending.slice(0,32);
   return route.fulfill({json:{...identity,messages,nextCursor:messages.at(-1)?.sequence??cursor,more:pending.length>32,settled:attempt==='old'||settled,recording:attempt==='old'?'unavailable':'recorded'}});
  });
  // A workspace update arrives after the Lead has completed the delegation turn.
  await page.goto('http://conversation.test/?timeline');
  const priorAttempt = page.getByRole('button',{name:/Apply Fast failed/});
  await priorAttempt.click();
  await page.getByText('Original attempt report',{exact:true}).waitFor();
  await page.evaluate(() => window.showTimeline(1));
  const retryAttempt = page.getByRole('button',{name:/Apply Fast Thinking/});
  await retryAttempt.waitFor();
  assert.equal(await priorAttempt.getAttribute('aria-expanded'),'true');
  assert.deepEqual(await page.locator('[data-timeline-key]').evaluateAll(rows=>rows.map(row=>row.dataset.timelineKey)),[
   'receipt:initial','task:continued-task:original-attempt','receipt:retry','task:continued-task:retried-attempt','receipt:next',
  ]);
  assert(await retryAttempt.evaluate(button=>{
   const rect=button.getBoundingClientRect();
   return rect.height>0&&button.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));
  }), 'The live retry must be visible without scrolling');
  await page.evaluate(() => window.showTimeline(2));
  await page.getByRole('button',{name:/Apply Fast completed/}).click();
  await page.getByText('Retry attempt report',{exact:true}).waitFor();
  await page.getByText('Original attempt report',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  await page.goto('http://conversation.test/?layout');
  const transcript = page.locator('.conversation');
  await page.getByText('Awaiting native output',{exact:true}).waitFor();
  const geometry = () => transcript.evaluate(node => ({
   bottomGap: node.scrollHeight-node.clientHeight-node.scrollTop,
   topGap: node.firstElementChild.firstElementChild.getBoundingClientRect().top-node.getBoundingClientRect().top,
   tailGap: node.getBoundingClientRect().bottom-node.firstElementChild.getBoundingClientRect().bottom,
  }));
  const painted = () => page.evaluate(() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await painted();
  const initial = await geometry();
  console.log('Preparing tail geometry',initial);
  assert(initial.tailGap<48 && initial.bottomGap<=2 && initial.topGap<0,
   'The preparing tail must fill the viewport and follow without manual scrolling');
  await page.evaluate(() => window.showLayout(1));
  await page.getByText('Live line 17',{exact:true}).waitFor();
  await painted();
  assert((await geometry()).bottomGap<=2,'Growth from live Lead and task updates must stay in view');
  await transcript.hover();
  await page.mouse.wheel(0,-400);
  await page.waitForFunction(() => document.querySelector('.conversation').scrollTop <
   document.querySelector('.conversation').scrollHeight-document.querySelector('.conversation').clientHeight-200);
  const reading = await geometry();
  await page.evaluate(() => window.showLayout(2));
  await page.getByText('Live reply updated',{exact:true}).waitFor({state:'attached'});
  await painted();
  assert.equal((await geometry()).topGap,reading.topGap,'A live arrival must preserve the reader’s anchor');
  assert.deepEqual(errors,[]);
  if (process.argv.includes('--timeline-only')) return;

  const log = page.getByRole('log',{name:'Apply Fast conversation'});
  const articles = log.locator('article');
  const open = () => page.getByRole('button',{name:'Open full view'}).click();
  await page.goto('http://conversation.test/');
  await open();
  await log.getByText('de ayuda',{exact:true}).waitFor();
  assert.equal(await articles.count(),2);
  assert.equal(await articles.nth(1).locator('.markdown strong').textContent(),'de ayuda');
  assert.equal(await articles.nth(1).locator('.markdown br').count(),1);
  const cancel = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/cancel'));
  await page.getByRole('button',{name:'Cancel specialist'}).click();
  assert.equal(new URL((await cancel).url()).pathname,'/api/tasks/t/attempts/a/cancel');
  settled = true;
  await page.evaluate(() => window.show('completed'));
  const terminalPoll = await page.waitForResponse(response =>
   response.url().includes(`/attempts/a/exchanges?cursor=${rows.at(-1).sequence}&`));
  assert.equal((await terminalPoll.json()).settled,true);
  offset = append('member-output','apply-fast',offset,'.');
  offset = append('member-output','apply-fast',offset,'Separate provenance',{...provenance,content:'other'});
  append('member-output','apply-fast',0,'New message');
  await log.getByText('New message',{exact:true}).waitFor();
  assert.equal(await articles.count(),4);
  assert.equal(await articles.nth(1).locator('.markdown p').last().textContent(),'de ayuda.');
  assert.match(await articles.nth(2).locator('[title]').getAttribute('title'),/Content: other$/);
  const picker = page.getByRole('button',{name:/^Task attempt:/});
  const options = page.getByRole('group',{name:'Task attempts'});
  const current = options.getByRole('button',{pressed:true});
  await picker.focus();
  await picker.press('Enter');
  await current.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-pressed') === 'true');
  const anchor = await picker.boundingBox();
  const popup = await options.boundingBox();
  assert(popup.x >= 0 && popup.x + popup.width <= 360);
  assert(popup.y >= anchor.y + anchor.height || popup.y + popup.height <= anchor.y);
  assert(await options.evaluate(node => node.scrollHeight > node.clientHeight));
  await page.keyboard.press('Escape');
  await options.waitFor({state:'hidden'});
  assert(await picker.evaluate(node => document.activeElement === node));
  await picker.click();
  await options.waitFor();
  await page.getByRole('heading',{name:'Apply Fast',exact:true}).click();
  await options.waitFor({state:'hidden'});
  await picker.click();
  await options.getByRole('button',{name:/^Attempt 1 cancelled/}).click();
  await log.getByText('Old attempt only',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:/Cancel specialist|Cancellation requested/}).count(),0);
  assert.equal(await log.getByText('de ayuda',{exact:true}).count(),0);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await picker.press('Enter');
  await current.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-pressed') === 'true');
  const latest = options.getByRole('button',{name:/^Attempt 16 completed/});
  await page.keyboard.press('ArrowDown');
  assert(await options.getByRole('button',{name:/^Attempt 2 completed/}).evaluate(node => document.activeElement === node));
  await page.keyboard.press('End');
  assert(await latest.evaluate(node => document.activeElement === node));
  await page.keyboard.press('Enter');
  await options.waitFor({state:'hidden'});
  await log.getByText('New message',{exact:true}).waitFor();
  assert.equal(await articles.count(),4);
  await page.reload();
  await page.evaluate(() => window.show('completed'));
  await open();
  await log.getByText('New message',{exact:true}).waitFor();
  assert.equal(await articles.count(),4);

  await page.setViewportSize({width:1200,height:800});
  await page.goto('http://conversation.test/?list');
  const list = page.locator('.subagent-content:not(.subagent-detail)');
  const viewportTop = text => page.waitForFunction(text => {
   const node = document.querySelector('.subagent-content:not(.subagent-detail)');
   const match = [...node.querySelectorAll('[data-task], .task-progress p, .task-result p')].find(el =>
    el.dataset.task===text || el.textContent.trim()===text);
   if (!match || node.scrollTop !== 0) return false;
   const row = match.getBoundingClientRect(), viewport = node.getBoundingClientRect();
   return row.top>=viewport.top&&row.bottom<=viewport.bottom&&
    match.contains(document.elementFromPoint(row.left+row.width/2,row.top+row.height/2));
  }, text);
  await page.getByText('1 active subagents',{exact:true}).waitFor();
  await list.getByRole('button',{name:'More historical tasks'}).waitFor();
  // Use geometry and hit-testing rather than a Playwright action that scrolls the card into view.
  await viewportTop('initial');
  await page.evaluate(() => window.showList('running'));
  await page.getByText('2 active subagents',{exact:true}).waitFor();
  await viewportTop('fresh');
  freshActivity = true;
  await viewportTop('Fresh activity');
  await page.evaluate(() => window.showList('completed'));
  await page.getByText('1 active subagents',{exact:true}).waitFor();
  await viewportTop('Fresh result');

  // Explicit history paging keeps its retained cards and reader position during a fresh arrival.
  await list.getByRole('button',{name:'More historical tasks'}).click();
  await list.getByRole('button',{name:'More historical tasks'}).waitFor({state:'hidden'});
  await viewportTop('fresh');
  await list.getByRole('button',{name:'Load older subagents'}).click();
  const readingPosition = () => list.evaluate(node => {
   const viewport = node.getBoundingClientRect();
   const cards = [...node.querySelectorAll('[data-timeline-key]')];
   const visible = cards.find(card => {
    const rect = card.getBoundingClientRect();
    return rect.top>=viewport.top && rect.bottom<=viewport.bottom;
   });
   return {page:cards.map(card=>card.dataset.timelineKey),visible:visible?.dataset.timelineKey,
    offset:Math.round(visible?.getBoundingClientRect().top-viewport.top),top:node.scrollTop};
  });
  const historyPosition = await readingPosition();
  assert(historyPosition.top > 0 && historyPosition.visible);
  await page.evaluate(() => window.showList('completed',1));
  await page.getByText('2 active subagents',{exact:true}).waitFor();
  assert.deepEqual(await readingPosition(),historyPosition);

  const card = list.locator('[data-timeline-key]').filter({has:page.locator('[data-task]')})
   .nth(historyPosition.page.indexOf(historyPosition.visible));
  await card.getByRole('button',{name:'Open full view'}).click();
  const back = page.getByRole('button',{name:'← Subagents'});
  await back.waitFor();
  await page.evaluate(() => window.showList('completed',2));
  await page.getByText('3 active subagents',{exact:true}).waitFor();
  assert(await back.isVisible());
  await back.click();
  await list.waitFor();
  assert.deepEqual(await readingPosition(),historyPosition);

  const newer = list.getByRole('button',{name:'Load newer subagents'});
  for (let i=0; i<3 && await newer.isVisible(); i++) await newer.click();
  await viewportTop('later-1');
  await page.getByRole('button',{name:'Dock inspector'}).click();
  await page.waitForFunction(() => document.querySelector('#session-inspector').dataset.mode==='docked');
  await page.evaluate(() => window.showList('completed',3));
  await page.getByText('4 active subagents',{exact:true}).waitFor();
  await viewportTop('later-2');

  // Scrolling down within the latest page also counts as reading history.
  const readingViewport = await list.boundingBox();
  await page.mouse.move(readingViewport.x+readingViewport.width/2,readingViewport.y+readingViewport.height/2);
  await page.mouse.wheel(0,300);
  await page.waitForFunction(() => document.querySelector('.subagent-content').scrollTop>=300);
  const scrolled = await readingPosition();
  await page.evaluate(() => window.showList('completed',4));
  await page.getByText('5 active subagents',{exact:true}).waitFor();
  const afterArrival = await readingPosition();
  assert.deepEqual(afterArrival.page,scrolled.page);
  assert.equal(afterArrival.visible,scrolled.visible);
  assert.equal(afterArrival.offset,scrolled.offset);
  await newer.click();
  await viewportTop('later-3');
  assert.deepEqual(errors,[]);
 } finally {
  await browser?.close();
  fs.rmSync(temp,{recursive:true,force:true});
 }
}

main().catch(error => {console.error(error);process.exitCode=1;});
