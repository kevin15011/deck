// Drive Chromium against the real host router while a Claude SDK fixture member
// emits delayed thinking/Read/Bash/result events. Run from the repository root
// after `bun run build`: node scripts/claude-member-activity-browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright');

const marker = '/tmp/deck2-browser-dir';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  fs.rmSync(marker, {force: true});
  const cargo = spawn('cargo', ['test', '-p', 'deck2', '--lib', 'claude_sdk_member_assignments_and_outcomes', '--', '--nocapture'], {
    cwd: path.resolve(__dirname, '../crates/host'),
    env: {...process.env, DECK2_BROWSER_FIXTURE: marker}, stdio: ['ignore', 'inherit', 'inherit'],
  });
  let dir;
  for (let i = 0; i < 1500 && !(dir && fs.existsSync(path.join(dir, 'serve-ready'))); i++) {
    if (!dir && fs.existsSync(marker)) dir = fs.readFileSync(marker, 'utf8');
    await sleep(200);
  }
  assert(dir && fs.existsSync(path.join(dir, 'serve-ready')), 'fixture host did not start');
  const [name, ...value] = fs.readFileSync(path.join(dir, 'serve-ready'), 'utf8').split('=');
  const release = step => fs.writeFileSync(path.join(dir, step), '');
  let browser = await chromium.launch({executablePath: process.env.DECK2_CHROMIUM || process.env.CHROMIUM, args: ['--no-sandbox'], headless: true});
  try {
    const context = await browser.newContext({serviceWorkers: 'block', viewport: {width: 1400, height: 900}});
    await context.addCookies([{name, value: value.join('='), url: 'http://127.0.0.1:32126'}]);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => console.error('pageerror', e.message));
    await page.goto('http://127.0.0.1:32126/');
    await page.waitForTimeout(3000);
    await page.getByText('Claude member fixture', {exact: true}).first().click();
    const row = page.locator('.inline-agent').first();
    const label = () => row.locator('.inline-agent-label');
    const expectText = async (locator, re, what) => {
      await locator.filter({hasText: re}).first().waitFor({timeout: 20000}).catch(async () => {
        throw new Error(`${what}: saw ${JSON.stringify(await locator.allTextContents())}`);
      });
    };
    const panelStep = page.locator('[data-live-step]');
    await page.getByRole('button', {name: 'Open Subagents'}).click();
    await expectText(label(), /Thinking…/, 'chat thinking');
    await expectText(panelStep, /Thinking…/, 'panel thinking');
    release('step-thinking-stop'); release('step-read');
    await expectText(label(), /Read/, 'chat read');
    await expectText(panelStep, /Read/, 'panel read');
    release('step-bash');
    await expectText(label(), /shell · git status/, 'chat bash');
    await expectText(panelStep, /shell · git status/, 'panel bash');
    const html = await page.content();
    for (const leak of ['fixture-private', 'fixture-secret-value', 'fixture-script-secret', 'API_TOKEN']) {
      assert(!html.includes(leak), `leaked ${leak}`);
    }
    release('step-read-result'); release('step-bash-result');
    release('release-member'); release('step-finish');
    await expectText(label(), /completed/, 'chat terminal');
    await page.waitForFunction(() => !document.querySelector('[data-live-step]'), null, {timeout: 20000});
    assert.equal(await panelStep.count(), 0, 'panel live step must clear');
    console.log('BROWSER-OK');
  } catch (e) {
    console.error(String(e));
    const pages = browser.contexts().flatMap(c => c.pages());
    if (pages[0]) { await pages[0].screenshot({path: '/tmp/deck2-browser-fail.png'}); console.error((await pages[0].locator('body').innerText()).slice(0, 1500)); }
    process.exitCode = 1;
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(dir, 'browser-done'), '');
    await new Promise(r => cargo.on('exit', r));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
