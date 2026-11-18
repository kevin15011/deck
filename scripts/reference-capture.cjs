// Public fixture rendered with the existing source components, read-only.
// This reference-only React bundle is never shipped in deck2.
const {chromium}=require(process.env.DECK2_PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..'),source='/home/kevin15011/deck/apps/web',out=path.join(repo,'target/reference-fixture');
fs.mkdirSync(out,{recursive:true});
const fixture=fs.readFileSync(path.join(repo,'scripts/fixtures/conversation.md'),'utf8');
fs.writeFileSync(path.join(out,'entry.ts'),`
import React from '${source}/node_modules/react/index.js';
import {createRoot} from '${source}/node_modules/react-dom/client.js';
import {DeckBrand} from '${source}/src/deck-logo.tsx';
import {Markdown} from '${source}/src/markdown.tsx';
createRoot(document.getElementById('app')).render(React.createElement('main',{style:{padding:'24px',maxWidth:'720px',margin:'0 auto',fontSize:'16px',lineHeight:1.65}},React.createElement(DeckBrand),React.createElement(Markdown,{text:${JSON.stringify(fixture)}})));
`);
const build=spawnSync('bun',['build',path.join(out,'entry.ts'),'--target','browser','--outdir',out],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
const style=fs.readFileSync(path.join(source,'src/style.css'),'utf8');
fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+style+'</style></head><body><div id="app"></div><script src="/entry.js"></script></body></html>');
const server=http.createServer((req,res)=>{const file=req.url==='/entry.js'?'entry.js':'index.html';res.setHeader('Content-Type',file.endsWith('js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(out,file)));});
let browser;
(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM || '/snap/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
 await page.locator('.markdown h2').waitFor();
 for(const [name,size] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
  await page.setViewportSize(size);
  for(const theme of ['dark','light']) {
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   await page.screenshot({path:path.join(out,name+'-'+theme+'.png'),fullPage:true});
  }
 }
 const hashes={};for(const file of ['src/deck-logo.tsx','src/markdown.tsx','src/style.css'])hashes[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(source,file))).digest('hex');
 const revision=spawnSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).stdout.trim();
 fs.writeFileSync(path.join(out,'provenance.json'),JSON.stringify({source,revision,hashes,fixture_sha256:crypto.createHash('sha256').update(fixture).digest('hex'),scope:'Existing Deck brand and Markdown components only, using a public fixture and original CSS. No old workspace/API or private data launched; no old source written.',differences:['New workspace remains restricted to Sprint 1 supported navigation and receipts.','CommonMark headings, emphasis, lists and code are formatted; GFM extras/code-copy toolbar are not part of this slice.','Both suppress executable raw HTML, block local/unsafe links and prevent remote image requests; new renderer also shows an image alt-text placeholder.','Comparison is semantic and visual, not a pixel-perfect tolerance gate.']},null,2));
 console.log(JSON.stringify({passed:true,out,revision}));
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});
