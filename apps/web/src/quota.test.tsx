import React from 'react';
import { test, expect } from 'bun:test';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { QuotaContents } from './quota';
import { DeckMenu } from './install-deck';
const now=1900000000000;
test('quota dialog renders accessible reported windows only, runner colors and local reset times',()=>{
 const html=render(<QuotaContents now={now} state={{runners:{claude:{refreshAfter:0,refreshing:false,snapshot:{runnerId:'claude',updatedAt:now-120000,windows:[{id:'five-hour',usedPercent:90,resetsAt:now+3600000}],overageStatus:'rejected'}},codex:{refreshAfter:now+59000,refreshing:false,snapshot:{runnerId:'codex',updatedAt:now,windows:[{id:'seven-day',usedPercent:7}],plan:'pro'}}}}} onRefresh={()=>{}}/>);
 expect(html.match(/role="progressbar"/g)).toHaveLength(2);expect(html).toContain('Claude 5-hour usage');expect(html).not.toContain('Claude 7-day usage');expect(html).toContain('Codex 7-day usage');expect(html).not.toContain('Codex 5-hour usage');
 expect(html).toContain('aria-valuenow="90"');expect(html).toContain('quota-claude');expect(html).toContain('quota-codex');expect(html).toContain('90% used');expect(html).toContain('Updated 2m ago');expect(html).toContain('Refresh in 59s');expect(html).toContain('uses a tiny amount of Claude quota');expect(html).toContain('Overage: rejected');expect(html).toContain('Plan: pro');
});
test('no reported windows shows subscription quota unavailable, never invents bars',()=>{
 const html=render(<QuotaContents now={now} state={{runners:{claude:{refreshAfter:0,refreshing:false},codex:{refreshAfter:0,refreshing:false,snapshot:{runnerId:'codex',updatedAt:now,windows:[],plan:'api'}}}}} onRefresh={()=>{}}/>);
 expect(html).not.toContain('role="progressbar"');expect(html).toContain('No subscription quota data');expect(html).toContain('No quota snapshot yet');
});
test('quota usage is accessible from the mobile drawer and keeps the desktop menu available',()=>{
 const props={hidden:true,onInstall:()=>{},onQuota:()=>{}};
 expect(render(<DeckMenu {...props} inline/>)).toContain('Quota usage');expect(render(<DeckMenu {...props}/>)).toContain('Deck menu');
});
