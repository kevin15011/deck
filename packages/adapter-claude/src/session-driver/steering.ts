import {constants, openSync, closeSync, fstatSync, readSync, lstatSync} from 'node:fs';
import {join, isAbsolute,dirname} from 'node:path';
import type {SteeringInput, SteeringOutcome} from '@deck/core/session/steering';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES=4*1024*1024, MAX_ROWS=4096;
const object=(v:unknown):Record<string,any>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
const unknown=(reason='claude-fold-unconfirmed'):SteeringOutcome=>({state:'unknown',reason});

/** Native 2.1.296 project encoding. Unsupported long-path layouts fail closed. */
export function claudeTranscriptPath(cwd:string,sessionId:string,env:Readonly<Record<string,string|undefined>>):string|undefined {
 const config=env.CLAUDE_CONFIG_DIR || (env.HOME?join(env.HOME,'.claude'):undefined);
 const project=cwd.replace(/[^a-zA-Z0-9]/g,'-');
 if(!config||!isAbsolute(config)||!UUID.test(sessionId)||!isAbsolute(cwd)||project.length>200)return undefined;
 return join(config,'projects',project,`${sessionId}.jsonl`);
}

/** Bounded inert read of committed JSONL prefixes. Never opens another session or resends input. */
export function readClaudeTranscript(path:string|undefined):unknown[] {
 if(!path)return [];
 let fd:number|undefined;
 try{
  if(lstatSync(path).isSymbolicLink()||lstatSync(dirname(path)).isSymbolicLink()||lstatSync(dirname(dirname(path))).isSymbolicLink())return [];
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  const stat=fstatSync(fd);if(!stat.isFile())return [];
  const start=Math.max(0,stat.size-MAX_BYTES),buffer=Buffer.alloc(Math.min(stat.size,MAX_BYTES));
  let used=0;while(used<buffer.length){const n=readSync(fd,buffer,used,buffer.length-used,start+used);if(!n)break;used+=n;}
  let text=buffer.subarray(0,used).toString('utf8');
  if(start>0)text=text.slice(text.indexOf('\n')+1);
  text=text.slice(0,text.lastIndexOf('\n')+1);
  const lines=text.split('\n').filter(Boolean);if(lines.length>MAX_ROWS)return [];
  return lines.map(line=>JSON.parse(line));
 }catch{return [];}finally{if(fd!==undefined)closeSync(fd);}
}

/** A replay echo or transcript-only row proves neither folding nor selected-execution acceptance. */
export function reconcileClaudeHistory(input:SteeringInput,values:readonly unknown[]):SteeringOutcome {
 if(!UUID.test(input.nativeThreadId)||!UUID.test(input.nativeTurnId)||!UUID.test(input.clientUserMessageId)||values.length>MAX_ROWS)return unknown();
 const rows=values.map(object).filter(r=>r.sessionId===input.nativeThreadId);
 const keyed=rows.filter(r=>r.uuid===input.clientUserMessageId);
 const attachments=rows.filter(r=>r.type==='attachment'&&object(r.attachment).type==='queued_command'&&object(r.attachment).source_uuid===input.clientUserMessageId);
 if(keyed.length)return unknown(keyed.some(r=>r.queueTranscriptOnly===true)?'claude-transcript-only':'claude-history-ambiguous');
 if(attachments.length!==1)return unknown();
 const row=attachments[0]!,a=object(row.attachment);
 if(a.prompt!==input.text||a.commandMode!=='prompt'||object(a.origin).kind!=='human'||a.humanTurn!==true||!UUID.test(a.delivery_id??'')||row.uuid===input.clientUserMessageId)return unknown();
 const removals=rows.filter(r=>r.type==='queue-operation'&&r.operation==='remove'&&r.reason==='absorbed_mid_turn'&&r.commandUuid===input.clientUserMessageId);
 if(removals.length!==1||removals[0]!.deliveryId!==a.delivery_id||removals[0]!.content!==input.text||rows.indexOf(removals[0]!)<=rows.indexOf(row))return unknown();
 const byId=new Map<string,Record<string,any>[]>();
 for(const r of rows)if(typeof r.uuid==='string')byId.set(r.uuid,[...(byId.get(r.uuid)??[]),r]);
 const exact=(id:unknown)=>typeof id==='string'&&byId.get(id)?.length===1?byId.get(id)![0]:undefined;
 const root=exact(input.nativeTurnId),parent=exact(row.parentUuid);
 if(!root||root.type!=='user'||object(root.message).role!=='user'||root.queueTranscriptOnly===true||typeof object(root.message).content!=='string'||!parent||parent.type!=='user'||object(parent.message).role!=='user')return unknown();
 const results=object(parent.message).content;
 if(!Array.isArray(results)||!results.some(v=>object(v).type==='tool_result'&&object(v).is_error!==true)||object(parent.toolUseResult).interrupted===true)return unknown();
 const tool=exact(parent.sourceToolAssistantUUID);
 if(!tool||tool.type!=='assistant'||object(tool.message).role!=='assistant'||parent.parentUuid!==tool.uuid)return unknown();
 const calls=object(tool.message).content;
 if(!Array.isArray(calls)||!results.some(r=>object(r).type==='tool_result'&&calls.some(c=>object(c).type==='tool_use'&&object(c).id===object(r).tool_use_id)))return unknown();
 let cursor:Record<string,any>|undefined=row;const visited=new Set<string>();
 for(let n=0;cursor&&n<512;n++){
  if(cursor.version!=='2.1.296'||cursor.isSidechain===true||visited.has(cursor.uuid))return unknown();
  visited.add(cursor.uuid);
  if(cursor.uuid===input.nativeTurnId)return {state:'accepted',...input,via:'history'};
  if(cursor.type==='assistant'&&object(cursor.message).stop_reason==='end_turn')return unknown();
  if(cursor.type==='user'&&!Array.isArray(object(cursor.message).content))return unknown();
  // Native SDK context attachments can be appended before their user root; UUID ancestry,
  // rather than JSONL position or receipt time, identifies the original execution.
  cursor=exact(cursor.parentUuid);
 }
 return unknown();
}
