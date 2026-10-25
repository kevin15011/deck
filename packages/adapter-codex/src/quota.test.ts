import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshCodexQuota } from './quota';
test('Codex quota refresh initializes then reads account limits without creating a thread or turn',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cxq-test-')),exe=join(root,'fake'),capture=join(root,'calls');
 try {
 writeFileSync(exe,`#!/usr/bin/env bun\nimport {appendFileSync} from 'node:fs';\nimport {createInterface} from 'node:readline';\nfor await (const line of createInterface({input:process.stdin})){const m=JSON.parse(line);appendFileSync(process.env.QUOTA_CAPTURE,JSON.stringify({method:m.method,cwd:process.cwd()})+'\\n');if(m.id)console.log(JSON.stringify({id:m.id,result:m.method==='account/rateLimits/read'?{rateLimits:{primary:{usedPercent:2,windowDurationMins:300}},rateLimitsByLimitId:{}}:{}}));}\n`,{mode:0o700});
 expect(await refreshCodexQuota(new AbortController().signal,{executable:exe,env:{...process.env,QUOTA_CAPTURE:capture}})).toEqual({primary:{usedPercent:2,windowDurationMins:300}});
 const calls=readFileSync(capture,'utf8').trim().split('\n').map(line=>JSON.parse(line));expect(calls.map(c=>c.method)).toEqual(['initialize','initialized','account/rateLimits/read']);expect(existsSync(calls[0].cwd)).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('Codex quota refresh rejects missing executable without leaving a pending RPC',async()=>{
 await expect(refreshCodexQuota(new AbortController().signal,{executable:'/nonexistent-deck-quota-executable',timeoutMs:50})).rejects.toThrow();
});
