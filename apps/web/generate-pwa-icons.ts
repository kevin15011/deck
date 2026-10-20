#!/usr/bin/env bun
/** Opt-in maintainer tool. Rasterizes the canonical Deck mark using an existing
 * local Chromium; no downloads, remote assets or design generation. Checked-in
 * PNGs are consumed by the normal Web asset generator without a browser. */
import {chromium} from '@playwright/test';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {FAVICON} from '../../scripts/generate-web-assets';
const browser=await chromium.launch({headless:true,executablePath:process.env.DECK_TEST_CHROME??join(homedir(),'Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')});
try{
 const page=await browser.newPage();
 const svg=FAVICON.replace(/<style>.*?<\/style>/,"<style>.i{fill:#fff3e3}</style>");
 const dir=resolve(import.meta.dir,'src/assets/pwa');await mkdir(dir,{recursive:true});
 for(const size of [180,192,512]){
  const data=await page.evaluate(async({svg,size})=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const context=canvas.getContext('2d')!;context.fillStyle='#141819';context.fillRect(0,0,size,size);const image=new Image();image.src='data:image/svg+xml,'+encodeURIComponent(svg);await image.decode();context.drawImage(image,0,0,size,size);return canvas.toDataURL('image/png').split(',')[1]!;},{svg,size});
  await writeFile(join(dir,`icon-${size}.png`),Buffer.from(data,'base64'));
 }
}finally{await browser.close();}
