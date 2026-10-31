/** Delegated task policy. Input is request evidence, never UI occupancy or billing totals. */
export type ContinuityPolicy = {
  mode: 'policy' | 'fresh'; autoNativeMaxAgeMs: number; autoNativeMaxInputTokens: number;
  nativeHardCapInputTokens: number; handoffMaxBytes: number;
};
export const DEFAULT_CONTINUITY_POLICY: Readonly<ContinuityPolicy> = Object.freeze({mode:'policy',autoNativeMaxAgeMs:300000,autoNativeMaxInputTokens:80000,nativeHardCapInputTokens:160000,handoffMaxBytes:32768});
export function normalizeContinuityPolicy(value: unknown = {}): ContinuityPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('crossRunner.continuity must be an object');
  const d = value as Record<string,unknown>;
  for(const k of Object.keys(d)) if(!Object.hasOwn(DEFAULT_CONTINUITY_POLICY,k)) throw new Error(`crossRunner.continuity.${k} is unknown`);
  const p={...DEFAULT_CONTINUITY_POLICY,...d} as ContinuityPolicy;
  if(!['policy','fresh'].includes(p.mode)) throw new Error('crossRunner.continuity.mode must be policy or fresh');
  for(const [key,min,max] of [['autoNativeMaxAgeMs',0,3600000],['nativeHardCapInputTokens',1,Number.MAX_SAFE_INTEGER],['autoNativeMaxInputTokens',0,p.nativeHardCapInputTokens],['handoffMaxBytes',32768,131072]] as const) {
    if(!Number.isSafeInteger(p[key]) || p[key]<min || p[key]>max) throw new Error(`crossRunner.continuity.${key} must be an integer between ${min} and ${max}`);
  }
  return p;
}
export type ContinuityRole = 'work' | 'review' | 'unknown';
export type ContinuityRequest = 'auto' | 'fresh' | 'native';
export type RequestInputEvidence = {
  tokens:number; basis:'codex-last-input'|'claude-message-input'|'opencode-verified-input';
  nativeThreadId:string; nativeTurnId:string; nativeRequestId?:string; modelId:string;
  cachedReadTokens?:number; cacheWriteTokens?:number; final:boolean;
};
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const identity=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=256;
export function sanitizeRequestInput(value:unknown): RequestInputEvidence|undefined {
  if(!value||typeof value!=='object')return;
  const v=value as RequestInputEvidence;
  if(!integer(v.tokens)||!['codex-last-input','claude-message-input','opencode-verified-input'].includes(v.basis)||![v.nativeThreadId,v.nativeTurnId,v.modelId].every(identity)||typeof v.final!=='boolean')return;
  if(v.nativeRequestId!==undefined&&!identity(v.nativeRequestId))return;
  for(const x of [v.cachedReadTokens,v.cacheWriteTokens])if(x!==undefined&&(!integer(x)||x>v.tokens))return;
  return {tokens:v.tokens,basis:v.basis,nativeThreadId:v.nativeThreadId,nativeTurnId:v.nativeTurnId,modelId:v.modelId,final:v.final,...(v.nativeRequestId?{nativeRequestId:v.nativeRequestId}:{}),...(v.cachedReadTokens===undefined?{}:{cachedReadTokens:v.cachedReadTokens}),...(v.cacheWriteTokens===undefined?{}:{cacheWriteTokens:v.cacheWriteTokens})};
}
/** Produced only by a verified runner/version/effective-config resolver. Capacity is not a bound.
 * inputSafeExclusiveCap is an INPUT-equivalent exclusive cap below triggerTokens in its stated basis.
 * For non-input triggers the resolver must prove conversion, including output/reserve accounting. */
export type NativeCompactionBound = {
  runnerId:string; modelId:string; version:string; configKey:string;
  inputSafeExclusiveCap:number; triggerTokens:number; basis:'input'|'input-equivalent'; evidenceRef:string;
};
export type ContinuityInput = {
  now:number; role:ContinuityRole; request?:ContinuityRequest; justification?:string; policy?:Partial<ContinuityPolicy>;
  runnerId:string; modelId:string; bound?:NativeCompactionBound;
  predecessor?:{state:string;endedAt?:number;launched?:boolean;nativeConfirmed?:boolean;nativeSessionId?:string;input?:RequestInputEvidence;integrated?:boolean;stopOrigin?:'user'|'lead'|'system'};
};
export type ContinuitySelection = {continuity:'native'|'reseeded';reason:string;selectedAt:number;policy:ContinuityPolicy;effectiveCap?:number;bound?:NativeCompactionBound;input?:RequestInputEvidence;override:'none'|'granted'|'refused'};
export function selectContinuity(x:ContinuityInput):ContinuitySelection {
  const policy=normalizeContinuityPolicy(x.policy), requested=x.request==='native';
  const base={selectedAt:x.now,policy,override:requested?'refused' as const:'none' as const};
  let effectiveCap:number|undefined;
  const fresh=(reason:string):ContinuitySelection=>({...base,continuity:'reseeded',reason,...(effectiveCap===undefined?{}:{effectiveCap}),...(x.bound?{bound:x.bound}:{}),...(sanitizeRequestInput(x.predecessor?.input)?{input:sanitizeRequestInput(x.predecessor?.input)}:{})});
  if(x.role!=='work')return fresh(x.role==='review'?'assigned-review-role':'unknown-assigned-role');
  if(policy.mode==='fresh'||x.request==='fresh')return fresh('forced-fresh');
  const p=x.predecessor;
  if(!p)return fresh('initial-attempt');
  if(!p.launched||!p.nativeConfirmed||!identity(p.nativeSessionId)||!['completed','cancelled','interrupted','failed'].includes(p.state))return fresh('native-ownership-unproven');
  if(p.state==='failed')return fresh('failed-predecessor');
  const input=sanitizeRequestInput(p.input);
  if(!input||!input.final||input.nativeThreadId!==p.nativeSessionId||input.modelId!==x.modelId)return fresh('last-request-input-unknown');
  const b=x.bound;
  if(!b||b.runnerId!==x.runnerId||b.modelId!==x.modelId||![b.version,b.configKey,b.evidenceRef].every(identity)||!['input','input-equivalent'].includes(b.basis)||!integer(b.inputSafeExclusiveCap)||!integer(b.triggerTokens)||b.inputSafeExclusiveCap<1||b.inputSafeExclusiveCap>=b.triggerTokens)return fresh('native-compaction-bound-unknown');
  effectiveCap=Math.min(policy.nativeHardCapInputTokens,b.inputSafeExclusiveCap);
  if(input.tokens>=effectiveCap)return fresh('effective-native-cap');
  if(requested) {
    if(!x.justification?.trim()||x.justification.length>512)return fresh('native-justification-required');
    return {...fresh('justified-native-override'),continuity:'native',override:'granted'};
  }
  if(p.state!=='completed'&&p.stopOrigin!=='user'&&p.stopOrigin!=='lead')return fresh('non-operator-predecessor');
  if(p.integrated)return fresh('latest-attempt-integrated');
  const age=x.now-(p.endedAt??NaN);
  if(!Number.isFinite(age)||age<0||age>=policy.autoNativeMaxAgeMs)return fresh('predecessor-age');
  if(input.tokens>=policy.autoNativeMaxInputTokens)return fresh('automatic-input-cap');
  return {...fresh('eligible-automatic-native'),continuity:'native'};
}
