export interface ExchangeIdentity {session:string;task:string;attempt:string}
export interface ExchangeMessage {sequence:number;id:string;role:string;source:string;at_ms:number;text:string;provenance:{runner:string;integration:string;content:string}}
export interface ExchangePage extends ExchangeIdentity {messages:ExchangeMessage[];nextCursor:number;more:boolean;settled:boolean;recording:'recorded'|'unavailable'}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
export function exchangePage(value:unknown,identity:ExchangeIdentity,cursor:number):ExchangePage {
 if(!object(value)||Object.entries(identity).some(([k,v])=>value[k]!==v)||!Array.isArray(value.messages)||!integer(value.nextCursor)||value.nextCursor<cursor||typeof value.more!=='boolean'||typeof value.settled!=='boolean'||!['recorded','unavailable'].includes(String(value.recording)))throw Error('Conversation identity or cursor mismatch');
 let previous=cursor;const ids=new Set<string>();
 for(const m of value.messages){if(!object(m)||!integer(m.sequence)||m.sequence<=previous||!['id','role','source','text'].every(k=>typeof m[k]==='string')||ids.has(m.id as string)||(!integer(m.at_ms)||m.at_ms>8640000000000000)||!object(m.provenance)||!['runner','integration','content'].every(k=>typeof (m.provenance as Record<string,unknown>)[k]==='string'))throw Error('Invalid recorded conversation message');previous=m.sequence;ids.add(m.id as string);}
 if(value.nextCursor!==previous||value.more&&!value.messages.length||value.recording==='unavailable'&&value.messages.length)throw Error('Invalid conversation page boundary');
 return value as unknown as ExchangePage;
}
