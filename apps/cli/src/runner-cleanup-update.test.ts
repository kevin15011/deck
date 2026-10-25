import {expect,test} from 'bun:test';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runRunnerCleanupUpdate,cleanupRoots} from './runner-cleanup-command';
import {RunnerMutationDeferredError} from '@deck/session-host';
const fixture=()=>{const home=mkdtempSync(join(tmpdir(),'nrp-update-')),roots=cleanupRoots({HOME:home});mkdirSync(roots.codex,{recursive:true});mkdirSync(join(roots.codex,'deck'),{recursive:true});writeFileSync(join(roots.codex,'config.toml'),'[mcp_servers.serena]\ncommand="user-serena"\n[mcp_servers.context-mode]\ncommand="user-context"\n');writeFileSync(join(roots.codex,'deck/old-serena'),'owned');return roots;};
const idle = async <T>(effect:()=>T|Promise<T>)=>effect();
test('unattended update preserves ambiguity; default, EOF and cancellation never consent',async()=>{
 for(const ask of [undefined,async()=>'',async()=>{throw Error('EOF');}]){
 const roots=fixture(),before=readFileSync(join(roots.codex,'config.toml'),'utf8');
 const outcome=await runRunnerCleanupUpdate(roots,['codex'],{admission:idle,ask});
 expect(readFileSync(join(roots.codex,'config.toml'),'utf8')).toBe(before);
 expect(outcome[0]?.status).toBe('review-required');expect(outcome[0]?.remaining).toBe(2);
 }
});
test('interactive review is individual and re-plans sibling preimages after each choice',async()=>{
 const roots=fixture(),questions:string[]=[];
 const outcome=await runRunnerCleanupUpdate(roots,['codex'],{admission:idle,ask:async q=>{questions.push(q);return 'remove';}});
 expect(questions).toHaveLength(2);expect(questions[0]).toContain('Preimage');expect(questions.join(' ')).toContain('serena');expect(questions.join(' ')).toContain('context-mode');
 expect(outcome[0]?.status).toBe('complete');expect(readFileSync(join(roots.codex,'config.toml'),'utf8')).not.toContain('mcp_servers');
 expect(existsSync(join(roots.codex,'deck/backups'))).toBe(true);
});
test('busy/unknown update defers without writes or backups and retry uses a fresh preimage',async()=>{
 const roots=fixture(),path=join(roots.codex,'config.toml'),before=readFileSync(path,'utf8');
 const outcome=await runRunnerCleanupUpdate(roots,['codex'],{admission:async()=>{throw new RunnerMutationDeferredError();},ask:async()=> 'remove'});
 expect(outcome[0]?.status).toBe('deferred');expect(readFileSync(path,'utf8')).toBe(before);expect(existsSync(join(roots.codex,'deck/backups'))).toBe(false);
 writeFileSync(path,before+'[user]\nvalue="user addition"\n');
 const retry=await runRunnerCleanupUpdate(roots,['codex'],{admission:idle,ask:async()=> 'remove'});
 expect(retry[0]?.status).toBe('complete');expect(readFileSync(path,'utf8')).toContain('user addition');
});
test('a change after display cannot inherit approval',async()=>{
 const roots=fixture(),path=join(roots.codex,'config.toml');
 const outcome=await runRunnerCleanupUpdate(roots,['codex'],{admission:idle,ask:async()=>{writeFileSync(path,readFileSync(path,'utf8')+'# changed\n');return 'remove';}});
 expect(outcome[0]?.status).toBe('recovery-required');expect(readFileSync(path,'utf8')).toContain('mcp_servers.serena');
});
