// Execute original Deck1 storage code against disposable fixture paths only.
const original=process.env.DECK1_ROOT;if(!original)throw Error('explicit original source root required');
const {LeadReplies}=await import(original+'/packages/session-host/src/lead-replies.ts');
const {PushAttentionStore}=await import(original+'/packages/session-host/src/push-attention-store.ts');
const {WebPush}=await import(original+'/packages/session-host/src/web-push.ts');
import {Database} from 'bun:sqlite';
import {join} from 'node:path';
const [dir,origin,encoded]=process.argv.slice(2);
if(!dir||!origin||!encoded||!dir.includes('/deck2-identity-'))throw Error('isolated fixture required');
const now=Date.now();
const paths={webDir:dir} as any;
const push=new WebPush({paths,isDeviceActive:()=>true,isCurrent:()=>false,send:async()=>{throw Error('fixture forbids network');},now:()=>now});
push.status('original-device',origin);push.subscribe('original-device',origin,JSON.parse(encoded));push.close();
const replies=new LeadReplies(dir,()=>now-7200000);replies.enroll('original-device');replies.close();
const db=new Database(join(dir,'lead-replies.sqlite'));
db.query("INSERT INTO replies VALUES (1,'reply-3-2',?,'lead',1,2,3,?,'Lead reply available.')").run('original-browser-session',now-3600000);
db.query("INSERT INTO reply_messages VALUES (?,2,1)").run('original-browser-session');
db.query("INSERT INTO pending VALUES ('original-device',1,?)").run('original-browser-session');
db.close();
// Old accepted transport outcome, still exact per item. It must not replay.
const receipts=new PushAttentionStore(dir,()=>now);receipts.record(JSON.stringify(['original-device',origin]),{sessionId:'original-browser-session',kind:'finished',key:'reply-3-2',replyId:'reply-3-2',revision:1,seq:3,ts:now-3600000},'sent');receipts.close();
