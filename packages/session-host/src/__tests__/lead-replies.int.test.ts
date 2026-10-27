import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '../event-log';
import { LeadReplies } from '../lead-replies';

test('direct replies survive later independent completion, exact device receipts and restart', () => {
  const dir=mkdtempSync(join(tmpdir(),'deck-replies-')); let now=1000;
  const log=EventLog.open({dir:join(dir,'log'),sessionId:'s',clock:{now:()=>now,setTimeout,clearTimeout} as any});
  let store:LeadReplies|undefined;
  const turn=(text:string)=>{log.append({kind:'turn.started',source:{taskId:'l',memberId:'lead'},data:{}});log.append({kind:'message.completed',source:{taskId:'l',memberId:'lead'},data:{role:'assistant',text}});log.append({kind:'turn.completed',source:{taskId:'l',memberId:'lead'},data:{status:'completed'}});};
  try {
    turn('Historical reply.'); store=new LeadReplies(dir,()=>now); store.enroll('a');store.enroll('b');store.initialize(log);store.sync(log);
    expect(store.list('a').total).toBe(0); now=2000;
    turn('Research answer, while child work continues.');store.sync(log);
    const first=store.list('a').replies[0]!;expect(first.summary).toContain('Research answer');
    now=3000; turn('Independent background result.');store.sync(log);
    expect(store.list('a').total).toBe(2);
    store.displayed('a','s',first.replyId);
    expect(store.list('a').total).toBe(1);expect(store.list('b').total).toBe(2);
    store.close();store=new LeadReplies(dir,()=>now);store.sync(log);
    expect(store.list('a').total).toBe(1);expect(store.list('b').total).toBe(2);
    store.displayed('a','s',first.replyId);expect(store.list('a').total).toBe(1);
    expect(()=>store!.displayed('a','other',first.replyId)).toThrow();
    expect(statSync(join(dir,'lead-replies.sqlite')).mode&0o777).toBe(0o600);
  }finally{store?.close();log.close();rmSync(dir,{recursive:true,force:true});}
});

test('progress/tool/internal/failed and interrupted text are not replies; bounded trailing public segment is',()=>{
  const dir=mkdtempSync(join(tmpdir(),'deck-replies-'));let now=1000;
  const log=EventLog.open({dir:join(dir,'log'),sessionId:'s'});const store=new LeadReplies(dir,()=>now);store.enroll('a');now=2000;
  const emit=(kind:any,data:any,memberId='lead')=>log.append({kind,source:{taskId:memberId,memberId},data});
  try {
    emit('turn.started',{});emit('message.completed',{role:'assistant',text:'Checking progress.'});emit('tool.started',{toolName:'x'});emit('turn.completed',{status:'completed'});store.sync(log);expect(store.list('a').total).toBe(0);
    emit('turn.started',{});emit('message.completed',{role:'assistant',text:'Interrupted.'});emit('turn.completed',{status:'interrupted'});store.sync(log);expect(store.list('a').total).toBe(0);
    emit('turn.started',{});emit('message.completed',{role:'assistant',text:'Hidden.',internal:true});emit('turn.completed',{status:'completed'});store.sync(log);expect(store.list('a').total).toBe(0);
    emit('turn.started',{});emit('message.completed',{role:'assistant',text:'Child.'},'child');emit('message.completed',{role:'assistant',text:'Ready.'});emit('turn.completed',{status:'completed'});store.sync(log);expect(store.list('a').total).toBe(1);
  }finally{store.close();log.close();rmSync(dir,{recursive:true,force:true});}
});

test('bounded replay retains a committed prefix and all reply identities through pagination',()=>{
  const dir=mkdtempSync(join(tmpdir(),'deck-replies-'));const log=EventLog.open({dir:join(dir,'log'),sessionId:'s'});let store=new LeadReplies(dir,()=>1000);store.enroll('a');
  const emit=(kind:any,data:any)=>log.append({kind,source:{memberId:'lead',taskId:'lead'},data});
  try{
    for(let n=0;n<43;n++){emit('turn.started',{});emit('message.completed',{role:'assistant',text:`Reply ${n}.`});emit('turn.completed',{status:'completed'});}
    store.sync(log);const first=store.list('a');expect(first.total).toBe(43);expect(first.replies.length).toBe(40);expect(store.list('a',first.nextCursor).replies.length).toBe(3);
    // A ledger-flush failure cannot advance the derived cursor or acknowledge a reply.
    emit('turn.started',{});emit('message.completed',{role:'assistant',text:'Committed prefix answer.'});store.sync(log);store.close();store=new LeadReplies(dir,()=>1000);
    emit('turn.completed',{status:'completed'});const flush=log.flush.bind(log);log.flush=()=>{throw Error('disk');};expect(()=>store.sync(log)).toThrow('disk');expect(store.list('a').total).toBe(43);log.flush=flush;store.sync(log);expect(store.list('a').total).toBe(44);store.sync(log);expect(store.list('a').total).toBe(44);
    emit('turn.started',{});for(let n=0;n<4100;n++)emit('message.completed',{role:'assistant',text:'Overlong segment.'});emit('turn.completed',{status:'completed'});
    expect(store.sync(log)).toBe(true);store.close();store=new LeadReplies(dir,()=>1000);expect(store.sync(log)).toBe(false);expect(store.list('a').total).toBe(45);
  }finally{store.close();log.close();rmSync(dir,{recursive:true,force:true});}
});

test('receipt/index write contention is explicit and retry stays exact; missing index never resets reads',()=>{
 const dir=mkdtempSync(join(tmpdir(),'deck-replies-'));const log=EventLog.open({dir:join(dir,'log'),sessionId:'s'});let store=new LeadReplies(dir,()=>1000);store.enroll('a');
 try{
  log.append({kind:'turn.started',source:{taskId:'lead',memberId:'lead'}});log.append({kind:'message.completed',source:{taskId:'lead',memberId:'lead'},data:{role:'assistant',text:'Durable reply.'}});log.append({kind:'turn.completed',source:{taskId:'lead',memberId:'lead'},data:{status:'completed'}});store.sync(log);const reply=store.list('a').replies[0]!;
  const lock=new Database(join(dir,'lead-replies.sqlite'));try{lock.exec('BEGIN IMMEDIATE');expect(()=>store.displayed('a','s',reply.replyId)).toThrow();expect(store.list('a').total).toBe(1);lock.exec('ROLLBACK');}finally{lock.close();}
  store.displayed('a','s',reply.replyId);store.displayed('a','s',reply.replyId);expect(store.list('a').total).toBe(0);store.close();
  rmSync(join(dir,'lead-replies.sqlite'));expect(()=>new LeadReplies(dir,()=>1000)).toThrow('reply-storage-unavailable');
 }finally{store.close();log.close();rmSync(dir,{recursive:true,force:true});}
});
import { Database } from 'bun:sqlite';

test('every trailing native text block maps to the same exact reply, including later visible blocks',()=>{
 const dir=mkdtempSync(join(tmpdir(),'deck-replies-'));const log=EventLog.open({dir:join(dir,'log'),sessionId:'s'});const store=new LeadReplies(dir,()=>1000);store.enroll('a');
 try{
  log.append({kind:'turn.started',source:{taskId:'lead',memberId:'lead'}});const parts=[];
  for(let n=0;n<45;n++)parts.push(log.append({kind:'message.completed',source:{taskId:'lead',memberId:'lead'},data:{role:'assistant',text:`Answer block ${n}.`}}).seq);
  log.append({kind:'turn.completed',source:{taskId:'lead',memberId:'lead'},data:{status:'completed'}});store.sync(log);
  const reply=store.list('a').replies[0]!;expect(store.list('a').total).toBe(1);
  const display=store.forMessages('a','s',[parts[0]!,parts[44]!]);expect(display.map(r=>r.replyId)).toEqual([reply.replyId,reply.replyId]);expect(display[1]!.displayMessageSeq).toBe(parts[44]!);expect(display[1]!.messageSeq).toBe(parts[0]!);
  store.displayed('a','s',reply.replyId);expect(store.forMessages('a','s',[parts[44]!])).toEqual([]);
 }finally{store.close();log.close();rmSync(dir,{recursive:true,force:true});}
});

test('explicit removal is durable retirement, not display: all readers/counts/pages/push retire, retained lifecycle states survive',()=>{
 const dir=mkdtempSync(join(tmpdir(),'deck-replies-retirement-')),log=EventLog.open({dir:join(dir,'log'),sessionId:'s'});let store=new LeadReplies(dir);store.enroll('a');store.enroll('b');
 const emit=(kind:any,data:any)=>log.append({kind,source:{taskId:'lead',memberId:'lead'},data});
 try{
  for(let n=0;n<43;n++){emit('turn.started',{});emit('message.completed',{role:'assistant',text:`Retain ${n}.`});emit('turn.completed',{status:'completed'});}store.sync(log);
  const first=store.list('a'),reply=first.replies[0]!;expect(first.total).toBe(43);expect(store.list('a',first.nextCursor).replies).toHaveLength(3);
  for(const [kind,data] of [['prompt.queue',{paused:true}],['session.state',{state:'ended'}],['session.released',{phase:'released'}],['session.removed',{phase:'removing'}]] as const){emit(kind,data);store.sync(log);expect(store.list('a').total).toBe(43);expect(store.get('s',reply.replyId)).toBeDefined();}
  emit('session.removed',{phase:'removed'});store.sync(log);
  expect(store.list('a')).toEqual({total:0,replies:[]});expect(store.list('b').total).toBe(0);expect(store.list('a',first.nextCursor).replies).toEqual([]);expect(store.list('a',0,'s').total).toBe(0);
  expect(store.get('s',reply.replyId)).toBeUndefined();expect(store.attentionPage('s').items).toEqual([]);expect(store.attentionReply('s',reply.replyId)).toBeUndefined();expect(store.forMessages('a','s',[reply.messageSeq])).toEqual([]);expect(store.isDisplayed('a','s',reply.replyId)).toBe(false);expect(()=>store.displayed('a','s',reply.replyId)).toThrow('reply-unknown');
  // A late completed native segment cannot resurrect retired attention.
  emit('turn.started',{});emit('message.completed',{role:'assistant',text:'Late native completion.'});emit('turn.completed',{status:'completed'});store.sync(log);store.close();store=new LeadReplies(dir);store.sync(log);expect(store.list('a').total).toBe(0);
  const db=new Database(join(dir,'lead-replies.sqlite'));try{expect((db.query('SELECT COUNT(*) AS n FROM displayed').get() as any).n).toBe(0);expect((db.query('SELECT COUNT(*) AS n FROM replies').get() as any).n).toBe(43);}finally{db.close();}
 }finally{store.close();log.close();rmSync(dir,{recursive:true,force:true});}
});

test('retirement preserves its committed source prefix and recovers atomic failures plus bounded replay',()=>{
 const dir=mkdtempSync(join(tmpdir(),'deck-replies-retirement-')),log=EventLog.open({dir:join(dir,'log'),sessionId:'s'});let store=new LeadReplies(dir);store.enroll('a');
 const emit=(kind:any,data:any)=>log.append({kind,source:{taskId:'lead',memberId:'lead'},data});
 try{
  emit('turn.started',{});emit('message.completed',{role:'assistant',text:'Pending.'});emit('turn.completed',{status:'completed'});store.sync(log);
  emit('session.removed',{phase:'removed'});const flush=log.flush.bind(log);log.flush=()=>{throw Error('retirement fsync');};expect(()=>store.sync(log)).toThrow('retirement fsync');expect(store.list('a').total).toBe(1);log.flush=flush;
  const db=new Database(join(dir,'lead-replies.sqlite'));try{
   db.exec('BEGIN IMMEDIATE');expect(()=>store.sync(log)).toThrow();expect(store.list('a').total).toBe(1);db.exec('ROLLBACK');
   db.exec("CREATE TRIGGER reject_retirement BEFORE DELETE ON pending BEGIN SELECT RAISE(ABORT,'retirement failure'); END");expect(()=>store.sync(log)).toThrow('retirement failure');expect(store.list('a').total).toBe(1);expect((db.query('SELECT COUNT(*) AS n FROM retired_sessions').get() as any).n).toBe(0);db.exec('DROP TRIGGER reject_retirement');
  }finally{if(db.inTransaction)db.exec('ROLLBACK');db.close();}
  store.close();store=new LeadReplies(dir);store.sync(log);store.sync(log);expect(store.list('a').total).toBe(0);
  for(let n=0;n<4100;n++)emit('message.completed',{role:'assistant',text:'Late removed-session data.'});expect(store.sync(log)).toBe(true);store.close();store=new LeadReplies(dir);expect(store.sync(log)).toBe(false);expect(store.list('a').total).toBe(0);
 }finally{store.close();log.close();rmSync(dir,{recursive:true,force:true});}
});

test('v1 projection that already skipped removal replays without re-enrolling or fabricating display',()=>{
 const dir=mkdtempSync(join(tmpdir(),'deck-replies-v1-')),log=EventLog.open({dir:join(dir,'log'),sessionId:'s'}),retained=EventLog.open({dir:join(dir,'retained'),sessionId:'t'});let store=new LeadReplies(dir);store.enroll('a');store.enroll('b');
 try{
  log.append({kind:'turn.started'});log.append({kind:'message.completed',data:{role:'assistant',text:'Old pending reply.'}});log.append({kind:'turn.completed',data:{status:'completed'}});store.sync(log);expect(store.list('a').total).toBe(1);
  retained.append({kind:'turn.started'});retained.append({kind:'message.completed',data:{role:'assistant',text:'Other retained session reply.'}});retained.append({kind:'turn.completed',data:{status:'completed'}});store.sync(retained);const other=store.list('a',0,'t').replies[0]!;store.displayed('b','t',other.replyId);
  log.append({kind:'session.removed',data:{phase:'removed'}});log.flush();store.close();
  // Frozen v1 shape: removal was ignored but its source cursor was committed.
  const db=new Database(join(dir,'lead-replies.sqlite'));try{db.exec('DROP TABLE IF EXISTS retired_sessions; PRAGMA user_version=1');db.query('UPDATE sessions SET seq=?,turn=NULL WHERE sessionId=?').run(log.lastSeq,'s');}finally{db.close();}
  store=new LeadReplies(dir);while(store.sync(log)){}store.sync(retained);expect(store.list('a',0,'s')).toEqual({total:0,replies:[]});expect(store.list('a').replies).toEqual([other]);expect(store.list('a').total).toBe(1);expect(store.list('b').total).toBe(0);expect(store.isDisplayed('b','t',other.replyId)).toBe(true);
  store.close();store=new LeadReplies(dir);store.sync(log);store.sync(retained);expect(store.list('a').total).toBe(1);expect(store.list('b').total).toBe(0);
 }finally{store.close();log.close();retained.close();rmSync(dir,{recursive:true,force:true});}
});

test('a projection checkpoint ahead of its source cannot establish currentness',()=>{
 const dir=mkdtempSync(join(tmpdir(),'deck-replies-source-')),log=EventLog.open({dir:join(dir,'log'),sessionId:'s'}),store=new LeadReplies(dir);
 try{
  store.enroll('a');log.append({kind:'turn.started'});log.append({kind:'message.completed',data:{role:'assistant',text:'Retained reply.'}});log.append({kind:'turn.completed',data:{status:'completed'}});store.sync(log);
  const db=new Database(join(dir,'lead-replies.sqlite'));try{db.query('UPDATE sessions SET seq=? WHERE sessionId=?').run(log.lastSeq+1,'s');}finally{db.close();}
  expect(()=>store.sync(log)).toThrow('reply-source-unavailable');expect(store.list('a').total).toBe(1);
 }finally{store.close();log.close();rmSync(dir,{recursive:true,force:true});}
});
