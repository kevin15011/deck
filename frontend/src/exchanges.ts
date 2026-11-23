export interface ExchangeIdentity {session:string;task:string;attempt:string}
export interface ExchangeMessage {sequence:number;id:string;role:string;source:string;at_ms:number;text:string;offset?:number;delivery?:"accepted"|"undelivered"|"unknown";provenance:{runner:string;integration:string;content:string}}
export interface ExchangePage extends ExchangeIdentity {messages:ExchangeMessage[];nextCursor:number;more:boolean;settled:boolean;recording:'recorded'|'unavailable'}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
export function exchangePage(value:unknown,identity:ExchangeIdentity,cursor:number):ExchangePage {
 if(!object(value)||Object.entries(identity).some(([k,v])=>value[k]!==v)||!Array.isArray(value.messages)||!integer(value.nextCursor)||value.nextCursor<cursor||typeof value.more!=='boolean'||typeof value.settled!=='boolean'||!['recorded','unavailable'].includes(String(value.recording)))throw Error('Conversation identity or cursor mismatch');
 let previous=cursor;const ids=new Set<string>();
 for(const m of value.messages){if(!object(m)||!integer(m.sequence)||m.sequence<=previous||!['id','role','source','text'].every(k=>typeof m[k]==='string')||ids.has(m.id as string)||(!integer(m.at_ms)||m.at_ms>8640000000000000)||(m.offset!==undefined&&!integer(m.offset))||!object(m.provenance)||!['runner','integration','content'].every(k=>typeof (m.provenance as Record<string,unknown>)[k]==='string'))throw Error('Invalid recorded conversation message');if(m.source==='lead-guidance'&&(m.role!=='lead'||!['accepted','undelivered','unknown'].includes(String(m.delivery))))throw Error('Invalid guidance delivery');previous=m.sequence;ids.add(m.id as string);}
 if(value.nextCursor!==previous||value.more&&!value.messages.length||value.recording==='unavailable'&&value.messages.length)throw Error('Invalid conversation page boundary');
 return value as unknown as ExchangePage;
}

type ConversationMessage = ExchangeMessage & {nextOffset?:number};
const utf8 = new TextEncoder();

// The public ledger stores byte ranges of the attempt prompt and cumulative output.
// Keep the first row's metadata and consume only contiguous ranges of the same stream.
export function appendConversation(previous:ConversationMessage[], chunks:ExchangeMessage[]):ConversationMessage[] {
 const messages = previous.slice();
 for (const chunk of chunks) {
  if (chunk.source === 'lead-guidance') {
   // A late receipt re-issues the same input with its final delivery. It updates
   // the row already on screen instead of adding another one.
   const index = messages.findIndex(m => m.source === 'lead-guidance' && m.id === chunk.id);
   if (index >= 0) { messages[index] = {...chunk, sequence: messages[index].sequence}; continue; }
  }
  const tail = messages.at(-1);
  const nextOffset = chunk.offset === undefined ? undefined : chunk.offset + utf8.encode(chunk.text).length;
  if (tail && chunk.offset !== undefined && chunk.offset > 0 && chunk.offset === tail.nextOffset &&
      (chunk.source === 'member-output' || chunk.source === 'lead-delegation') &&
      tail.source === chunk.source && tail.role === chunk.role &&
      tail.provenance.runner === chunk.provenance.runner &&
      tail.provenance.integration === chunk.provenance.integration &&
      tail.provenance.content === chunk.provenance.content) {
   messages[messages.length - 1] = {...tail, text:tail.text + chunk.text, nextOffset};
  } else {
   messages.push({...chunk, nextOffset});
  }
 }
 return messages;
}
