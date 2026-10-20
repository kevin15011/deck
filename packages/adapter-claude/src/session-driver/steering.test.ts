import {afterEach, expect, test} from 'bun:test';
import {mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import fixture from './__fixtures__/2.1.296/steering.json';
import {claudeTranscriptPath, readClaudeTranscript, reconcileClaudeHistory} from './steering';

const dirs:string[]=[];
afterEach(()=>{for(const p of dirs.splice(0))rmSync(p,{recursive:true,force:true});});
test('exact folded source UUID, text, delivery removal and original tool ancestry prove acceptance',()=>{
 expect(reconcileClaudeHistory(fixture.folded.target,fixture.folded.records)).toEqual({state:'accepted',...fixture.folded.target,via:'history'});
});
test('transcript-only user history never proves acceptance by the selected execution',()=>{
 expect(reconcileClaudeHistory(fixture.transcriptOnly.target,fixture.transcriptOnly.records)).toEqual({state:'unknown',reason:'claude-transcript-only'});
 expect(reconcileClaudeHistory(fixture.folded.target,[]).state).toBe('unknown');
});
test.each(['session','source','text','delivery','ancestry','cycle','other-turn','duplicate','version'] as const)('rejects %s drift or ambiguity',kind=>{
 const rows=structuredClone(fixture.folded.records) as any[];
 const a=rows.find(r=>r.type==='attachment'&&r.attachment?.type==='queued_command');
 const removed=rows.find(r=>r.type==='queue-operation');
 if(kind==='session')a.sessionId='foreign';
 if(kind==='source')a.attachment.source_uuid='00000000-0000-4000-8000-000000000001';
 if(kind==='text')a.attachment.prompt+=' changed';
 if(kind==='delivery')removed.deliveryId='foreign';
 if(kind==='ancestry')a.parentUuid='missing-parent';
 if(kind==='cycle')rows.find(r=>r.type==='assistant'&&r.message?.stop_reason==='tool_use').parentUuid=a.uuid;
 if(kind==='other-turn')rows.find(r=>r.uuid===a.parentUuid).message={role:'user',content:'An unrelated later genuine prompt'};
 if(kind==='duplicate')rows.push(structuredClone(a));
 if(kind==='version')a.version='2.1.297';
 expect(reconcileClaudeHistory(fixture.folded.target,rows).state).toBe('unknown');
});
test('attachment without its committed removal record is insufficient',()=>{
 expect(reconcileClaudeHistory(fixture.folded.target,fixture.folded.records.filter(r=>r.type!=='queue-operation')).state).toBe('unknown');
});
test('default native history reader reads only the selected profile/session and committed lines',()=>{
 const home=mkdtempSync(join(tmpdir(),'deck-claude-history-'));dirs.push(home);
 const env={HOME:home},path=claudeTranscriptPath('/work/project',fixture.folded.target.nativeThreadId,env)!;
 mkdirSync(join(home,'.claude','projects','-work-project'),{recursive:true});
 writeFileSync(path,fixture.folded.records.map(r=>JSON.stringify(r)).join('\n')+'\n{"partial":');
 expect(reconcileClaudeHistory(fixture.folded.target,readClaudeTranscript(path)).state).toBe('accepted');
 expect(claudeTranscriptPath('/work/project','../../foreign',env)).toBeUndefined();
 expect(readClaudeTranscript(path+'-missing')).toEqual([]);
});
test('native history symlinks are inert, not a cross-profile read',()=>{
 const home=mkdtempSync(join(tmpdir(),'deck-claude-history-'));dirs.push(home);
 const target=join(home,'real'),link=join(home,'link');writeFileSync(target,'{}\n');symlinkSync(target,link);
 expect(readClaudeTranscript(link)).toEqual([]);
});
test('a bounded history tail missing the original execution root remains unknown',()=>{
 const home=mkdtempSync(join(tmpdir(),'deck-claude-history-'));dirs.push(home);const path=join(home,'history');
 const root=fixture.folded.records.find(r=>r.uuid===fixture.folded.target.nativeTurnId)!;
 writeFileSync(path,JSON.stringify(root)+'\n'+JSON.stringify({padding:'x'.repeat(4*1024*1024)})+'\n'+fixture.folded.records.filter(r=>r!==root).map(r=>JSON.stringify(r)).join('\n')+'\n');
 expect(reconcileClaudeHistory(fixture.folded.target,readClaudeTranscript(path)).state).toBe('unknown');
});
