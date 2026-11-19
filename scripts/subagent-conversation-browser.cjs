const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');

// Exercise the production Subagents detail with a cursor-based exchange endpoint.
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
   const root = createRoot(document.getElementById('root'));
   window.show = (phase = 'running') => root.render(
    <Subagents session="s" visible connected decisions={[]} onError={console.error}
     tasks={[{id:'t', session:'s', owner:'apply-fast', attempts:[
      {id:'old', phase:'cancelled', provenance:{}, treatments:[]},
      {id:'a', phase, provenance:{}, treatments:[]}
     ]}]} />
   );
   window.show();
  `);
  execFileSync('bun', ['build', entry, '--target=browser', '--outdir', temp], {cwd:root});
  const bundle = fs.readFileSync(path.join(temp, 'entry.js'));
  browser = await chromium.launch({executablePath:process.env.DECK2_CHROMIUM || chromium.executablePath()});
  const page = await browser.newPage();
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
  await page.route('http://conversation.test/**', route => {
   const url = new URL(route.request().url());
   if (url.pathname === '/') return route.fulfill({contentType:'text/html',body:'<div id="root"></div><script src="/app.js"></script>'});
   if (url.pathname === '/app.js') return route.fulfill({contentType:'text/javascript',body:bundle});
   const [,attempt,endpoint] = url.pathname.match(/^\/api\/sessions\/s\/tasks\/t\/attempts\/([^/]+)\/(exchanges|transcript)$/) || [];
   if (!attempt) return route.fulfill({status:404});
   const identity = {session:'s',task:'t',attempt};
   if (endpoint === 'transcript') return route.fulfill({json:{...identity,prompt:'Old assignment',text:'Old attempt only',offset:0,nextOffset:16,more:false,settled:true}});
   const cursor = Number(url.searchParams.get('cursor'));
   const pending = attempt === 'a' ? rows.filter(row => row.sequence>cursor) : [];
   const messages = pending.slice(0,32);
   return route.fulfill({json:{...identity,messages,nextCursor:messages.at(-1)?.sequence??cursor,more:pending.length>32,settled:attempt==='old'||settled,recording:attempt==='old'?'unavailable':'recorded'}});
  });
  const log = page.getByRole('log',{name:'Apply Fast conversation'});
  const articles = log.locator('article');
  const open = () => page.getByRole('button',{name:'Open full view'}).click();
  await page.goto('http://conversation.test/');
  await open();
  await log.getByText('de ayuda',{exact:true}).waitFor();
  assert.equal(await articles.count(),2);
  assert.equal(await articles.nth(1).locator('.markdown strong').textContent(),'de ayuda');
  assert.equal(await articles.nth(1).locator('.markdown br').count(),1);
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
  await page.getByLabel('Task attempt').selectOption('old');
  await log.getByText('Old attempt only',{exact:true}).waitFor();
  assert.equal(await log.getByText('de ayuda',{exact:true}).count(),0);
  await page.getByLabel('Task attempt').selectOption('a');
  await log.getByText('New message',{exact:true}).waitFor();
  assert.equal(await articles.count(),4);
  await page.reload();
  await page.evaluate(() => window.show('completed'));
  await open();
  await log.getByText('New message',{exact:true}).waitFor();
  assert.equal(await articles.count(),4);
  assert.deepEqual(errors,[]);
 } finally {
  await browser?.close();
  fs.rmSync(temp,{recursive:true,force:true});
 }
}

main().catch(error => {console.error(error);process.exitCode=1;});
