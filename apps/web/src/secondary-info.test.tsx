import React from 'react';
import { test, expect } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SecondaryInfo, placeSecondaryPanel } from './secondary-info';

test('secondary trigger remains compact and does not render inline panel content', () => {
 const html=renderToStaticMarkup(<SecondaryInfo title="Context" label="Context" resetKey="s"><p>Long secondary detail</p></SecondaryInfo>);
 expect(html).toContain('aria-expanded="false"');expect(html).toContain('aria-haspopup="dialog"');
 expect(html).not.toContain('Long secondary detail');expect(html).not.toContain('<details');
});
test('anchored placement stays within every viewport edge, including narrow and offset visual viewports', () => {
 for(const width of [320,390,1280])for(const left of [0,width-5])for(const top of [0,800]) {
  const p=placeSecondaryPanel({left,top,right:left+5,bottom:top+20}, {width:360,height:440}, {left:0,top:0,width,height:844});
  expect(p.left).toBeGreaterThanOrEqual(8);expect(p.top).toBeGreaterThanOrEqual(8);
  expect(p.left+p.width).toBeLessThanOrEqual(width-8);expect(p.top+p.height).toBeLessThanOrEqual(844-8);
 }
 const p=placeSecondaryPanel({left:380,top:700,right:400,bottom:720},{width:360,height:600},{left:10,top:100,width:390,height:400});
 expect(p.left).toBeGreaterThanOrEqual(18);expect(p.top).toBeGreaterThanOrEqual(108);expect(p.top+p.height).toBeLessThanOrEqual(492);
});
