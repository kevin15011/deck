import {test,expect} from 'bun:test';
import {receiptPresentation,decisionPresentation,runtimeState} from './presentation';
// Protects neutral evidence and fail-closed unavailable states. Oracle: runtime116 API contract;
// fails if transport names select a renderer, absent identity is invented, or malformed capability is trusted.
test('normalized evidence accepts arbitrary recorded runners and acknowledged reasoning',()=>{
 const p={version:1,recorded_runner:'fixture-runner',integration_available:true,retained_runtime_supported:false,reasoning:{model:'fixture-model',effort:'deliberate',validated:true,basis:'native_acknowledgement'}};
 expect(receiptPresentation(p,'fixture-model')?.recorded_runner).toBe('fixture-runner');
 expect(receiptPresentation(undefined,null)).toBeUndefined();
 expect(receiptPresentation({...p,recorded_runner:null,reasoning:null},null)?.reasoning).toBeNull();
 for(const change of [{version:2},{integration_available:'yes'},{reasoning:{...p.reasoning,validated:false}},{reasoning:{...p.reasoning,model:'foreign'}}])expect(()=>receiptPresentation({...p,...change},'fixture-model')).toThrow();
});
test('action projections require validated capabilities and bounded structured details',()=>{
 const p={version:1,kind:'external_action',validated:true,details:{operation:'fixture',input:{recipient:'alpha'}},responses:['allow_once','deny']};
 expect(decisionPresentation(p)?.details).toEqual(p.details);
 expect(decisionPresentation({version:1,kind:'unavailable',validated:false,details:null})?.validated).toBe(false);
 for(const change of [{validated:'yes'},{responses:['invented_grant']},{details:{huge:'x'.repeat(65537)}},{validated:false}])expect(()=>decisionPresentation({...p,...change})).toThrow();
});
test('runtime capabilities distinguish unsupported sessions and reject malformed resource states',()=>{
 const p={api:7,session:'s',epoch:1,state:'unsupported',capabilities:{retained_runtime:false,target_restart:false,simultaneous_retained_turns:false},resources:null,catalog_policy:'unavailable',catalog_verified:false,catalog:[],catalog_observed_ms:null,idle_timeout_seconds:1800,message:'Unavailable'};
 expect(runtimeState(p,'s').state).toBe('unsupported');
 const retained={...p,state:'loaded',catalog_policy:'retained_lead',capabilities:{retained_runtime:true,target_restart:true,simultaneous_retained_turns:true},resources:{state:'leased',threads:2,processes:1,thread_limit:8,process_limit:4}};
 expect(runtimeState(retained,'s').resources?.state).toBe('leased');
 for(const change of [{session:'foreign'},{capabilities:{retained_runtime:true}},{resources:{...retained.resources,state:'guessed'}}])expect(()=>runtimeState({...retained,...change},'s')).toThrow();
});
