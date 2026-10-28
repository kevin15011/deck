import React from 'react';
import { test, expect } from 'bun:test';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { QuotaContents, QuotaSectionView, quotaSummary } from './quota';
const now=1900000000000;
test('quota dialog renders accessible reported windows only, runner colors and local reset times',()=>{
 const html=render(<QuotaContents now={now} state={{runners:{claude:{refreshAfter:0,refreshing:false,snapshot:{runnerId:'claude',updatedAt:now-120000,windows:[{id:'five-hour',usedPercent:90,resetsAt:now+3600000}],overageStatus:'rejected'}},codex:{refreshAfter:now+59000,refreshing:false,snapshot:{runnerId:'codex',updatedAt:now,windows:[{id:'seven-day',usedPercent:7}],plan:'pro'}}}}} onRefresh={()=>{}}/>);
 expect(html.match(/role="progressbar"/g)).toHaveLength(2);expect(html).toContain('Claude 5-hour usage');expect(html).not.toContain('Claude 7-day usage');expect(html).toContain('Codex 7-day usage');expect(html).not.toContain('Codex 5-hour usage');
 expect(html).toContain('aria-valuenow="90"');expect(html).toContain('quota-claude');expect(html).toContain('quota-codex');expect(html).toContain('90% used');expect(html).toContain('Updated 2m ago');expect(html).toContain('Refresh in 59s');expect(html).toContain('uses a tiny amount of Claude quota');expect(html).not.toContain('Overage');expect(html).not.toContain('Extra usage');expect(html).toContain('Plan: pro');
});
test('no reported windows shows subscription quota unavailable, never invents bars',()=>{
 const html=render(<QuotaContents now={now} state={{runners:{claude:{refreshAfter:0,refreshing:false},codex:{refreshAfter:0,refreshing:false,snapshot:{runnerId:'codex',updatedAt:now,windows:[],plan:'api'}}}}} onRefresh={()=>{}}/>);
 expect(html).not.toContain('role="progressbar"');expect(html).toContain('No subscription quota data');expect(html).toContain('No quota snapshot yet');
});
test('usage section folds with a compact summary and expands to the full quota view',()=>{
 const state={runners:{claude:{refreshAfter:0,refreshing:false,snapshot:{runnerId:'claude',updatedAt:now,windows:[{id:'five-hour',usedPercent:40},{id:'seven-day',usedPercent:72}]}},codex:{refreshAfter:0,refreshing:false}}} as any;
 expect(quotaSummary(state)).toBe('Claude 72%');
 const props={state,now,loading:false,message:'',onRefresh:()=>{},onToggle:()=>{}};
 const folded=render(<QuotaSectionView {...props} collapsed/>);
 expect(folded).toContain('aria-expanded="false"');expect(folded).toContain('Claude 72%');expect(folded).toMatch(/id="usage-section-body"[^>]*hidden/);
 const open=render(<QuotaSectionView {...props} collapsed={false}/>);
 expect(open).toContain('aria-expanded="true"');expect(open).not.toContain('usage-summary');expect(open.match(/role="progressbar"/g)).toHaveLength(2);
});
