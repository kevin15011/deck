import {test,expect} from 'bun:test';
import {contextReading,contextEstimate,leadContextReceipt} from './context-window';
const observation={basis:'codex-last-total',tokens:34794,capacity:258400,native_thread_id:'thread',native_turn_id:'turn',attempt:'attempt',model_id:'observed',observed_ms:100};
test('exact current attempt/thread/turn only, malformed and compacted observations are unavailable',()=>{
 const state={observation,compacted:false};
 const c=contextReading(state,'attempt','thread','turn');expect(contextEstimate(c)).toEqual({used:34794,max:258400,percent:9});
 for(const args of [['foreign','thread','turn'],['attempt','other','turn'],['attempt','thread','old']] as const)expect(contextReading(state,...args)).toBeUndefined();
 for(const patch of [{tokens:-1},{tokens:1.5},{tokens:Number.MAX_SAFE_INTEGER+1},{capacity:0},{observed_ms:Infinity},{basis:'cumulative-session'},{model_id:{raw:'private'}}])expect(contextReading({observation:{...observation,...patch}},'attempt','thread','turn')).toBeUndefined();
 expect(contextReading({...state,compacted:true},'attempt','thread','turn')).toBeUndefined();
 expect(contextEstimate()).toEqual({used:null,max:null,percent:null});
 expect(contextEstimate({...observation,tokens:null} as any).percent).toBeNull();
 expect(contextEstimate({...observation,capacity:12000} as any).percent).toBe(100);
});

// ASSIGN81-Q02: current ownership selects the indicator; old observations remain
// available in immutable receipt history. Oracle: generation/context contract.
test('Lead context follows generation and native ownership, preserving historical readings',()=>{
 const session:any={id:'s',contract:{generation:2,leadTask:'lead'},native:null};
 const old:any={id:'old',session:'s',phase:'completed',mode:'session_v1',attempt:'attempt',thread:'thread',turn:'turn',context:{observation},configuration:{session_contract:{generation:1,leadTask:'lead'}}};
 const receipts=[old],history=JSON.stringify(receipts);
 expect(leadContextReceipt(session,receipts)).toBeUndefined();
 session.native={thread:'thread',mode:'session_v1'};
 expect(leadContextReceipt(session,receipts)).toBeUndefined();
 const current:any={...old,id:'new',attempt:'new-attempt',thread:'new-thread',context:{observation:{...observation,attempt:'new-attempt',native_thread_id:'new-thread'}},configuration:{session_contract:{generation:2,leadTask:'lead'}}};
 session.native.thread='new-thread';
 expect(leadContextReceipt(session,[old,current])).toBe(current);
 expect(contextReading(current.context,current.attempt,current.thread,current.turn)).toEqual(current.context.observation);
 expect(leadContextReceipt(session,[old,{...current,phase:'queued'}])).toBeUndefined();
 expect(leadContextReceipt(session,[old,{...current,session:'foreign'}])).toBeUndefined();
 expect(leadContextReceipt(session,[old,{...current,configuration:{session_contract:{generation:2,leadTask:'foreign'}}}])).toBeUndefined();
 // Member-only and no-op changes keep generation/context, including on restart.
 expect(leadContextReceipt(JSON.parse(JSON.stringify({...session,contract:{...session.contract,revision:9}})),[old,current])).toBe(current);
 expect(leadContextReceipt({...session,native:null},[old,current])).toBeUndefined();
 const legacy:any={id:'s',native:{thread:'thread',mode:'read_only'}};
 expect(leadContextReceipt(legacy,[{...old,mode:'read_only',configuration:null}])).toBeDefined();
 expect(leadContextReceipt({...legacy,native:{...legacy.native,thread:'released'}},[old])).toBeUndefined();
 expect(JSON.stringify(receipts)).toBe(history);
});

// Claude context is the CLI's own current-request occupancy; percent is the plain ratio.
test('Claude basis is accepted per exact owner, with a plain-ratio percentage',()=>{
 const claude={...observation,basis:'claude-context-usage',tokens:50000,capacity:200000};
 const c=contextReading({observation:claude},'attempt','thread','turn');
 expect(contextEstimate(c)).toEqual({used:50000,max:200000,percent:25});
 expect(contextEstimate({...claude,tokens:300000} as any).percent).toBe(100);
 expect(contextReading({observation:claude},'attempt','thread','other')).toBeUndefined();
 expect(contextReading({observation:claude,compacted:true},'attempt','thread','turn')).toBeUndefined();
});

test('valid tokens with an absent capacity stay tokens-only, never a guessed percentage',()=>{
 const c=contextReading({observation:{...observation,basis:'claude-context-usage',tokens:42000,capacity:null}},'attempt','thread','turn');
 expect(contextEstimate(c)).toEqual({used:42000,max:null,percent:null});
});
