/** Durable derived reply identity and exact device display receipts. No execution effects.
 * A completed turn's trailing public assistant segment is a structural heuristic:
 * native streams do not consistently expose final vs commentary phase. */
import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, openSync, closeSync, constants, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assertPrivateFile, writePrivateFile } from './paths';
import { summarize, type AttentionItem } from './push-attention';
import type { EventLog } from './event-log';
import type { LeadReply, LeadReplyPage, LeadReplyDisplay } from '@deck/core/session/lead-replies';
type Turn = { taskId: string; attempt: number; start: number; count: number; parts: number[]; truncated?:boolean };
type Row = LeadReply & { id: number };
const columns='r.id,r.replyId,r.sessionId,r.taskId,r.attempt,r.messageSeq,r.completedSeq,r.ts,r.summary';
export class LeadReplies {
  private db: Database;
  readonly fresh: boolean;
  constructor(dir: string, private now=Date.now) {
    const file=join(dir,'lead-replies.sqlite'), metadata=join(dir,'lead-replies.json');
    // A missing/corrupt existing index is an error, never an empty successful inbox.
    this.fresh=!existsSync(metadata)&&!existsSync(file);
    let identity: string|undefined;
    if(existsSync(metadata)){assertPrivateFile(metadata);if(statSync(metadata).size>4096)throw Error('reply-storage-unavailable');const value=JSON.parse(readFileSync(metadata,'utf8'));identity=value.id;if(value.v!==1||typeof identity!=='string'||!/^[a-f0-9-]{36}$/.test(identity)||!existsSync(file))throw Error('reply-storage-unavailable');}
    if(!existsSync(file))closeSync(openSync(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW??0),0o600));
    assertPrivateFile(file);
    for(const suffix of ['-journal','-wal','-shm'])if(existsSync(file+suffix))assertPrivateFile(file+suffix);
    this.db=new Database(file,{strict:true});
    try {
      const version=(this.db.query('PRAGMA user_version').get() as {user_version:number}).user_version;
      if(version>2)throw Error('reply-storage-unavailable');
      this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-512;
        CREATE TABLE IF NOT EXISTS identity(id TEXT NOT NULL,since INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(sessionId TEXT PRIMARY KEY,seq INTEGER NOT NULL,floorSeq INTEGER NOT NULL,turn TEXT);
        CREATE TABLE IF NOT EXISTS retired_sessions(sessionId TEXT PRIMARY KEY,seq INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS replies(id INTEGER PRIMARY KEY,replyId TEXT NOT NULL,sessionId TEXT NOT NULL,taskId TEXT NOT NULL,attempt INTEGER NOT NULL,messageSeq INTEGER NOT NULL,completedSeq INTEGER NOT NULL,ts INTEGER NOT NULL,summary TEXT NOT NULL,UNIQUE(sessionId,replyId));
        CREATE INDEX IF NOT EXISTS replies_completion ON replies(sessionId,completedSeq);
        CREATE INDEX IF NOT EXISTS replies_message ON replies(sessionId,messageSeq);
        CREATE INDEX IF NOT EXISTS replies_time ON replies(sessionId,ts,id);
        CREATE TABLE IF NOT EXISTS segment_parts(sessionId TEXT NOT NULL,seq INTEGER NOT NULL,PRIMARY KEY(sessionId,seq));
        CREATE TABLE IF NOT EXISTS reply_messages(sessionId TEXT NOT NULL,seq INTEGER NOT NULL,reply INTEGER NOT NULL,PRIMARY KEY(sessionId,seq));
        CREATE TABLE IF NOT EXISTS readers(deviceId TEXT PRIMARY KEY,floor INTEGER NOT NULL,since INTEGER NOT NULL,unread INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS pending(deviceId TEXT NOT NULL,reply INTEGER NOT NULL,sessionId TEXT NOT NULL,PRIMARY KEY(deviceId,reply));
        CREATE INDEX IF NOT EXISTS pending_session ON pending(deviceId,sessionId,reply);
        CREATE TRIGGER IF NOT EXISTS pending_add AFTER INSERT ON pending BEGIN UPDATE readers SET unread=unread+1 WHERE deviceId=NEW.deviceId; END;
        CREATE TRIGGER IF NOT EXISTS pending_remove AFTER DELETE ON pending BEGIN UPDATE readers SET unread=unread-1 WHERE deviceId=OLD.deviceId; END;
        CREATE TABLE IF NOT EXISTS displayed(deviceId TEXT NOT NULL,reply INTEGER NOT NULL,PRIMARY KEY(deviceId,reply));`);
      if(version<2)this.db.transaction(()=>{
        // v1 advanced past removals without projecting them. Replay existing
        // sources, preserving enrollment floors, identities and exact receipts.
        this.db.exec('UPDATE sessions SET seq=0,turn=NULL; DELETE FROM segment_parts; PRAGMA user_version=2');
      })();
      let row=this.db.query('SELECT id,since FROM identity').get() as {id:string;since:number}|null;
      if(!row){if(identity)throw Error('reply-storage-unavailable');row={id:randomUUID(),since:this.now()};this.db.query('INSERT INTO identity VALUES (?,?)').run(row.id,row.since);}
      if(identity&&identity!==row.id)throw Error('reply-storage-unavailable');
      if(!identity)writePrivateFile(metadata,JSON.stringify({v:1,id:row.id}));

    }catch(error){this.db.close();throw error;}
  }
  initialize(log:EventLog) {this.db.query('INSERT OR IGNORE INTO sessions VALUES (?,0,?,NULL)').run(log.sessionId,log.lastSeq);}
  enroll(deviceId: string) { this.db.query('INSERT OR IGNORE INTO readers(deviceId,floor,since) SELECT ?,COALESCE(MAX(id),0),? FROM replies').run(deviceId,this.now()); }
  revoke(deviceId:string){this.db.transaction(()=>{this.db.query('DELETE FROM pending WHERE deviceId=?').run(deviceId);this.db.query('DELETE FROM displayed WHERE deviceId=?').run(deviceId);this.db.query('DELETE FROM readers WHERE deviceId=?').run(deviceId);})();}
  /** At most 4096 events per call. Checkpoint and inserted identities commit together.
   * The ledger is flushed first: a derived receipt must never outlive its source prefix. */
  sync(log:EventLog): boolean {
    const checkpoint=this.db.query('SELECT seq,floorSeq,turn FROM sessions WHERE sessionId=?').get(log.sessionId) as {seq:number;floorSeq:number;turn:string|null}|null;
    let seq=checkpoint?.seq??0, turn:Turn|undefined=checkpoint?.turn?JSON.parse(checkpoint.turn):undefined;
    let retired=!!this.db.query('SELECT 1 FROM retired_sessions WHERE sessionId=?').get(log.sessionId);
    if(seq>log.lastSeq)throw Error('reply-source-unavailable');
    if(seq===log.lastSeq)return false;
    const operations:({kind:'clear'}|{kind:'retire';seq:number}|{kind:'part';seq:number}|{kind:'reply';reply:LeadReply})[]=[];let budget=4096;
    for(const e of log.readAfter(seq)){
      if(!budget--)break;seq=e.seq;
      if(e.kind==='session.removed'&&e.data.phase==='removed'){retired=true;turn=undefined;operations.push({kind:'retire',seq:e.seq});}
      if(retired)continue;
      const taskId=e.source.taskId??'lead';
      const lead=e.source.memberId!==undefined?e.source.memberId==='lead':taskId==='lead';
      if(!lead)continue;
      if(e.kind==='task.created'||e.kind==='task.continued'){operations.push({kind:'clear'});turn={taskId,attempt:Number(e.data.attempt)||1,start:0,count:0,parts:[]};}
      if(e.kind==='turn.started'){operations.push({kind:'clear'});turn={taskId,attempt:turn?.taskId===taskId?turn.attempt:1,start:e.seq,count:0,parts:[]};}
      if(!turn||turn.taskId!==taskId||!turn.start)continue;
      turn.count=Math.min(4097,turn.count+1);
      if(e.kind==='message.completed'){
        if(e.data.role!=='assistant'||e.data.internal===true){turn.parts=[];turn.truncated=false;operations.push({kind:'clear'});}
        else if(typeof e.data.text==='string'&&e.data.text.trim()){operations.push({kind:'part',seq:e.seq});if(turn.parts.length<32)turn.parts.push(e.seq);else turn.truncated=true;}
      }else if(/^(tool\.(started|completed)|question\.|approval\.|task\.(integration|delivery|retrieval)|decision\.)/.test(e.kind)){turn.parts=[];turn.truncated=false;operations.push({kind:'clear'});}
      if(e.kind==='turn.completed'){
        if(e.data.status==='completed'&&turn.parts.length&&e.seq>(checkpoint?.floorSeq??0)){
          let text='';for(const part of turn.parts){const m=log.readEvent(part);text+=(text?'\n\n':'')+String(m?.data.text??'').slice(0,8192);if(text.length>=8192){text=text.slice(0,8192);break;}}
          operations.push({kind:'reply',reply:{replyId:`reply-${e.seq}-${turn.parts[0]}`,sessionId:log.sessionId,taskId,attempt:turn.attempt,messageSeq:turn.parts[0]!,completedSeq:e.seq,ts:Date.parse(e.ts),summary:(!turn.truncated?summarize(text):undefined)??'Lead reply available.'}});
        }
        operations.push({kind:'clear'});turn={...turn,start:0,parts:[]};
      }
    }
    log.flush();
    this.db.transaction(()=>{
      let committedRetirement=!!this.db.query('SELECT 1 FROM retired_sessions WHERE sessionId=?').get(log.sessionId);
      for(const op of operations){
        if(op.kind==='retire'){
          // Removal is a disposition, never a fabricated display receipt. Keep
          // historical identities while retiring every reader's pending rows.
          this.db.query('INSERT OR IGNORE INTO retired_sessions VALUES (?,?)').run(log.sessionId,op.seq);
          this.db.query('DELETE FROM pending WHERE sessionId=?').run(log.sessionId);
          this.db.query('DELETE FROM segment_parts WHERE sessionId=?').run(log.sessionId);committedRetirement=true;continue;
        }
        if(committedRetirement)continue;
        if(op.kind==='clear'){this.db.query('DELETE FROM segment_parts WHERE sessionId=?').run(log.sessionId);continue;}
        if(op.kind==='part'){this.db.query('INSERT OR IGNORE INTO segment_parts VALUES (?,?)').run(log.sessionId,op.seq);continue;}
        const r=op.reply;
        const inserted=this.db.query('INSERT OR IGNORE INTO replies(replyId,sessionId,taskId,attempt,messageSeq,completedSeq,ts,summary) VALUES (?,?,?,?,?,?,?,?)').run(r.replyId,r.sessionId,r.taskId,r.attempt,r.messageSeq,r.completedSeq,r.ts,r.summary);
        const row=this.db.query('SELECT id FROM replies WHERE sessionId=? AND replyId=?').get(r.sessionId,r.replyId) as {id:number};
        this.db.query('INSERT OR IGNORE INTO reply_messages SELECT sessionId,seq,? FROM segment_parts WHERE sessionId=?').run(row.id,r.sessionId);
        if(inserted.changes)this.db.query('INSERT INTO pending SELECT deviceId,?,? FROM readers WHERE floor<? AND since<=?').run(row.id,r.sessionId,row.id,r.ts);
      }
      this.db.query('INSERT INTO sessions VALUES (?,?,?,?) ON CONFLICT(sessionId) DO UPDATE SET seq=excluded.seq,turn=excluded.turn').run(log.sessionId,seq,checkpoint?.floorSeq??0,turn?JSON.stringify(turn):null);
    })();
    return seq<log.lastSeq;
  }
  private reader(deviceId:string){const row=this.db.query('SELECT floor,since FROM readers WHERE deviceId=?').get(deviceId) as {floor:number;since:number}|null;if(!row)throw Error('reply-reader-unavailable');return row;}
  list(deviceId:string,cursor=0,sessionId?:string):LeadReplyPage {
    this.reader(deviceId);
    const total=sessionId?(this.db.query('SELECT COUNT(*) AS n FROM pending WHERE deviceId=? AND sessionId=?').get(deviceId,sessionId) as {n:number}).n:(this.db.query('SELECT unread AS n FROM readers WHERE deviceId=?').get(deviceId) as {n:number}).n;
    const query=sessionId?'p.deviceId=? AND p.sessionId=? AND p.reply>?':'p.deviceId=? AND p.reply>?';
    const args=sessionId?[deviceId,sessionId,cursor]:[deviceId,cursor];
    const rows=this.db.query(`SELECT ${columns} FROM pending p JOIN replies r ON r.id=p.reply WHERE ${query} ORDER BY p.reply LIMIT 41`).all(...args) as Row[];
    const page=rows.slice(0,40);return{total,replies:page.map(({id,...r})=>r),...(rows.length>40?{nextCursor:page.at(-1)!.id}:{})};
  }

  forMessages(deviceId:string,sessionId:string,seqs:number[]):LeadReplyDisplay[]{
    if(!seqs.length)return [];
    return (this.db.query(`SELECT ${columns},m.seq AS displayMessageSeq FROM reply_messages m JOIN replies r ON r.id=m.reply WHERE m.sessionId=? AND EXISTS(SELECT 1 FROM pending p WHERE p.deviceId=? AND p.reply=r.id) AND m.seq IN (${seqs.map(()=>'?').join(',')})`).all(sessionId,deviceId,...seqs) as (Row & {displayMessageSeq:number})[]).map(({id,...r})=>r);
  }
  get(sessionId:string,replyId:string):LeadReply|undefined {const r=this.db.query(`SELECT ${columns} FROM replies r WHERE sessionId=? AND replyId=? AND NOT EXISTS(SELECT 1 FROM retired_sessions t WHERE t.sessionId=r.sessionId)`).get(sessionId,replyId) as Row|null;if(r){const {id,...reply}=r;return reply;}}
  displayed(deviceId:string,sessionId:string,replyId:string){
    const {floor,since}=this.reader(deviceId),row=this.db.query('SELECT id,ts FROM replies WHERE sessionId=? AND replyId=?').get(sessionId,replyId) as {id:number;ts:number}|null;
    if(!row||!this.get(sessionId,replyId))throw Error('reply-unknown');if(row.id<=floor||row.ts<since)return;
    this.db.transaction(()=>{this.db.query('INSERT OR IGNORE INTO displayed VALUES (?,?)').run(deviceId,row.id);this.db.query('DELETE FROM pending WHERE deviceId=? AND reply=?').run(deviceId,row.id);})();
  }
  isDisplayed(deviceId:string,sessionId:string,replyId:string){const {floor,since}=this.reader(deviceId);return !!this.db.query('SELECT 1 FROM replies r WHERE sessionId=? AND replyId=? AND NOT EXISTS(SELECT 1 FROM retired_sessions t WHERE t.sessionId=r.sessionId) AND (id<=? OR ts<? OR EXISTS(SELECT 1 FROM displayed d WHERE d.deviceId=? AND d.reply=r.id))').get(sessionId,replyId,floor,since,deviceId);}
  private attentionItem(r:LeadReply):AttentionItem{return {sessionId:r.sessionId,kind:'finished',key:r.replyId,replyId:r.replyId,revision:1,seq:r.completedSeq,ts:r.ts,...(r.summary==='Lead reply available.'?{}:{summary:r.summary})};}
  attentionPage(sessionId:string,after=0):{items:AttentionItem[];nextCursor?:number}{
    const rows=this.db.query(`SELECT ${columns} FROM replies r WHERE sessionId=? AND completedSeq>? AND ts>=? AND NOT EXISTS(SELECT 1 FROM retired_sessions t WHERE t.sessionId=r.sessionId) ORDER BY completedSeq LIMIT 33`).all(sessionId,after,this.now()-30*60_000) as Row[];
    const page=rows.slice(0,32);return {items:page.map(r=>this.attentionItem(r)),...(rows.length>32?{nextCursor:page.at(-1)!.completedSeq}:{})};
  }
  attentionReply(sessionId:string,replyId:string):AttentionItem|undefined {const r=this.get(sessionId,replyId);if(r&&r.ts>=this.now()-30*60_000)return this.attentionItem(r);}

  close(){this.db.close();}
}
