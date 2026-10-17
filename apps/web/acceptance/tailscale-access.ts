/** Fake Serve contract around fresh production assets; no daemon/config mutation.
 * bun apps/web/acceptance/tailscale-access.ts
 */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWebAssets } from '../../../scripts/generate-web-assets';
import { WebService } from '../../../packages/session-host/src/web-service';
import { ensureStateLayout, resolveStatePaths } from '../../../packages/session-host/src/paths';
const root=mkdtempSync(join(tmpdir(),'deck-serve-browser-'));
const paths=resolveStatePaths({env:{XDG_STATE_HOME:root}});ensureStateLayout(paths);
const origin='https://deck.tail123.ts.net';
const host=new WebService({paths,assets:await buildWebAssets(),config:{port:0,trustedProxy:'127.0.0.1',allowedOrigins:[origin],allowFunnel:false,tailscaleServeAccess:true},service:{execute:async()=>({ok:true}),openLog:()=>undefined,hasRunningWork:()=>false,query:()=>({ok:true,data:{projects:[]}})}});
host.enable();
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
 browser=await chromium.launch({executablePath:process.env.DECK_TEST_CHROME,headless:true,args:['--no-sandbox']});
 for(const identity of [true,false]) {
  const context=await browser.newContext();
  const page=await context.newPage();
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  let bootstrapStatus=0;
  // Model Serve's trusted loopback HTTP upstream and browser-facing HTTPS origin.
  await page.route(`${origin}/**`,async route=>{
   const request=route.request();
   const headers={...request.headers(),host:new URL(origin).host,'x-forwarded-proto':'https',...(identity?{'tailscale-user-login':'alice@example.com'}:{})};
   const response=await fetch(`${host.status().url}${new URL(request.url()).pathname}${new URL(request.url()).search}`,{method:request.method(),headers,body:request.postData()??undefined});
   if(request.url().endsWith('/api/local-access'))bootstrapStatus=response.status;
   await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  });
  await page.goto(origin);
  if(identity){
   await page.getByRole('heading',{name:'Choose a project',exact:true}).waitFor();
   assert.equal(bootstrapStatus,200);assert.equal(await page.getByLabel('Pairing code').count(),0);
   const cookies=await context.cookies();assert.equal(cookies.length,1);assert.equal(cookies[0]!.httpOnly,true);assert.equal(cookies[0]!.secure,true);
   await page.reload();await page.getByRole('heading',{name:'Choose a project',exact:true}).waitFor();assert.equal(host.devices().length,1);
   host.revoke(host.devices()[0]!.id);
   await page.reload();await page.getByRole('heading',{name:'Pair this browser',exact:true}).waitFor();assert.equal(bootstrapStatus,403);assert.equal(host.devices().length,1);
  }else{
   await page.getByRole('heading',{name:'Pair this browser',exact:true}).waitFor();assert.equal(bootstrapStatus,403);
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log(JSON.stringify({ok:true,checks:['serve-no-code-workspace','secure-httpOnly-cookie','reload-reuses-device','revocation-no-reenrollment','missing-identity-pairing']}));
} finally {await browser?.close();await host.close();rmSync(root,{recursive:true,force:true});}
