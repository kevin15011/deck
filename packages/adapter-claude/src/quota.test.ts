import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeQuotaArgs, refreshClaudeQuota } from './quota';
test('Claude quota refresh uses an isolated tool-free one-shot and discards output and cwd',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cq-test-')),capture=join(root,'capture'),exe=join(root,'fake');
 try {
 writeFileSync(exe,`#!/usr/bin/env bun\nimport {writeFileSync} from 'node:fs';\nwriteFileSync(process.env.QUOTA_CAPTURE,JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),deck:process.env.DECK_SECRET}));\nconsole.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'PRIVATE'}]}}));\nconsole.log(JSON.stringify({type:'rate_limit_event',rate_limit_info:{unifiedWindows:{five_hour:{utilization:.2,resetsAt:1900000000}},accountId:'PRIVATE',credits:123}}));\n`,{mode:0o700});
 const value=await refreshClaudeQuota(new AbortController().signal,{executable:exe,env:{...process.env,QUOTA_CAPTURE:capture,DECK_SECRET:'PRIVATE'}});
 const launch=JSON.parse(readFileSync(capture,'utf8'));expect(launch.deck).toBeUndefined();expect(launch.cwd).not.toBe(process.cwd());expect(existsSync(launch.cwd)).toBe(false);
 expect(launch.args).toEqual(claudeQuotaArgs());expect(launch.args).toContain('--safe-mode');expect(launch.args).toContain('--no-session-persistence');expect(launch.args[launch.args.indexOf('--tools')+1]).toBe('');expect(launch.args[launch.args.indexOf('--max-turns')+1]).toBe('1');
 expect(JSON.stringify(value)).not.toContain('PRIVATE');expect(value).toMatchObject({unifiedWindows:{five_hour:{utilization:.2}}});
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('Claude no-event and timed-out processes preserve a no-data/failure distinction',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cq-test-')),exe=join(root,'fake');
 try {
 writeFileSync(exe,'#!/usr/bin/env bun\nconsole.log("No event");\n',{mode:0o700});
 expect(await refreshClaudeQuota(new AbortController().signal,{executable:exe})).toBeUndefined();
 writeFileSync(exe,'#!/usr/bin/env bun\nsetInterval(()=>{},1000);\n',{mode:0o700});
 await expect(refreshClaudeQuota(new AbortController().signal,{executable:exe,timeoutMs:25})).rejects.toThrow('quota-refresh-failed');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('an exhausted Claude turn may exit unsuccessfully while still reporting valid quota',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cq-test-')),exe=join(root,'fake');
 try {
 writeFileSync(exe,`#!/usr/bin/env bun\nconsole.log(JSON.stringify({type:'rate_limit_event',rate_limit_info:{status:'rejected',unifiedWindows:{five_hour:{utilization:1}}}}));\nprocess.exit(1);\n`,{mode:0o700});
 expect(await refreshClaudeQuota(new AbortController().signal,{executable:exe})).toMatchObject({status:'rejected',unifiedWindows:{five_hour:{utilization:1}}});
 }finally{rmSync(root,{recursive:true,force:true});}
});
