import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from '@playwright/test';
import fixture from './acceptance/composer-focus.html';
const server=Bun.serve({hostname:'127.0.0.1',port:0,routes:{'/*':fixture},development:{hmr:false,console:false}});
const browser=await chromium.launch({executablePath:'/snap/bin/chromium',headless:true});
mkdirSync('/tmp/deck-composer-frames',{recursive:true});
try{
const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(`http://127.0.0.1:${server.port}`);const input=page.getByRole('textbox');await input.focus();
const offset=()=>page.locator('.composer-focus-light circle').first().getAttribute('cx');
await page.waitForTimeout(100);const first=await offset();await page.screenshot({path:'/tmp/deck-composer-frames/phase-a.png'});await page.waitForTimeout(200);assert.notEqual(await offset(),first);await page.screenshot({path:'/tmp/deck-composer-frames/phase-b.png'});
const old=await page.locator('svg').getAttribute('viewBox');await input.fill('line\n'.repeat(8));await page.waitForTimeout(80);assert.notEqual(await page.locator('svg').getAttribute('viewBox'),old);
await page.getByRole('button').focus();const stopped=await offset();await page.waitForTimeout(150);assert.equal(await offset(),stopped);assert.equal(await page.locator('svg').evaluate(e=>getComputedStyle(e).visibility),'hidden');
await input.focus();await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(60);const reduced=await offset();await page.waitForTimeout(150);assert.equal(await offset(),reduced);assert.equal(await page.locator('form').evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
await page.emulateMedia({forcedColors:'active'});assert.equal(await page.locator('form').evaluate(e=>getComputedStyle(e).outlineStyle),'solid');
await page.emulateMedia({forcedColors:'none',reducedMotion:'no-preference'});await page.waitForTimeout(80);assert.notEqual(await offset(),reduced);
await page.locator('form').evaluate(e=>(e as HTMLElement).hidden=true);await page.waitForTimeout(50);const hidden=await offset();await page.waitForTimeout(120);assert.equal(await offset(),hidden);await page.locator('form').evaluate(e=>(e as HTMLElement).hidden=false);
for(const width of [1440,390]){await page.setViewportSize({width,height:900});await input.focus();await page.screenshot({path:`/tmp/deck-composer-frames/${width}.png`});}
for(let i=0;i<4;i++){await page.getByRole('button').focus();await input.focus();}
await page.waitForTimeout(80);
assert(await page.locator('.composer-focus-light').evaluate(svg=>{
 const pools=Array.from(svg.querySelectorAll('circle'));const box=(svg as SVGSVGElement).viewBox.baseVal;
 return Math.abs(Number(pools[0]!.getAttribute('cx'))+Number(pools[1]!.getAttribute('cx'))-box.width)<1 && Math.abs(Number(pools[0]!.getAttribute('cy'))+Number(pools[1]!.getAttribute('cy'))-box.height)<1;
}));
assert.equal(await page.evaluate(()=> (window as any).fixture.gsap.globalTimeline.getChildren().filter((t:any)=>t.repeat()===-1).length),1);
// Paint oracle: changing the moving layer may affect only the thin rounded band.
await page.evaluate(()=> { (window as any).fixture.gsap.globalTimeline.pause(); });
const composer=page.locator('form'),box=(await composer.boundingBox())!;
const lit=await composer.screenshot();
await page.locator('.composer-focus-light').evaluate(e=>(e as SVGElement).style.visibility='hidden');
const unlit=await composer.screenshot();
const paint=await page.evaluate(async ({a,b,width,height})=>{
 const decode=async(data:string)=>{const image=new Image();image.src=`data:image/png;base64,${data}`;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);return {data:ctx.getImageData(0,0,c.width,c.height).data,w:c.width,h:c.height};};
 const x=await decode(a),y=await decode(b);let changed=0,outside=0;const stray:unknown[]=[];
 const radius=parseFloat(getComputedStyle(document.querySelector('form')!).borderTopLeftRadius);
 for(let j=0;j<x.h;j++)for(let i=0;i<x.w;i++){
  const k=(j*x.w+i)*4;if(![0,1,2].some(c=>x.data[k+c]!==y.data[k+c]))continue;changed++;
  const qx=Math.abs(i+.5-width/2)-(width/2-radius),qy=Math.abs(j+.5-height/2)-(height/2-radius);
  const distance=Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-radius;
  if(distance < -2 || distance > .5){outside++;stray.push({i,j,distance,a:[...x.data.slice(k,k+4)],b:[...y.data.slice(k,k+4)]});}
 }return {changed,outside,stray};
},{a:lit.toString('base64'),b:unlit.toString('base64'),width:box.width,height:box.height});
console.log(JSON.stringify({box,paint}));
assert(paint.changed>0,'Moving border must paint');assert.equal(paint.outside,0,'No moving paint outside border band');
await Bun.write('/tmp/deck-composer-frames/border-paint.json',JSON.stringify({box,...paint}));
console.log('Border paint',paint);

await page.evaluate(()=> (window as any).fixture.dispose());assert.equal(await page.evaluate(()=> (window as any).fixture.gsap.globalTimeline.getChildren().filter((t:any)=>t.repeat()===-1).length),0);assert.equal(await page.locator('.composer-focus-light').count(),0);assert.deepEqual(errors,[]);console.log('PASS focus/blur/refocus, resize, hidden, reduced motion, forced colors, disposal');
}finally{await browser.close();server.stop(true)}
