import { describe, expect, test } from 'bun:test';
import { selectContinuity, normalizeContinuityPolicy, sanitizeRequestInput, type ContinuityInput } from './task-continuity';
const evidence = { tokens: 79999, basis: 'codex-last-input', nativeThreadId: 'n', nativeTurnId: 't', modelId: 'm', final: true } as const;
const bound = { runnerId:'codex', modelId:'m', version:'fixture', configKey:'effective', inputSafeExclusiveCap:170000, triggerTokens:170001, basis:'input', evidenceRef:'fixture' } as const;
const input = (): ContinuityInput => ({ now:399999, role:'work', request:'auto', runnerId:'codex', modelId:'m', predecessor:{ state:'completed', endedAt:100000, launched:true, nativeConfirmed:true, nativeSessionId:'n', input:evidence }, bound });
describe('delegated continuity', () => {
 test('uses strict terminal-age and last input boundaries', () => {
  expect(selectContinuity(input()).continuity).toBe('native');
  expect(selectContinuity({...input(),now:400000}).continuity).toBe('reseeded');
  expect(selectContinuity({...input(),predecessor:{...input().predecessor!,input:{...evidence,tokens:80000}}}).continuity).toBe('reseeded');
 });
 test('override cannot bypass failed predecessor, unknown input/bound, or lower compaction cap', () => {
  const x={...input(),request:'native' as const,justification:'Preserve local investigation'};
  expect(selectContinuity({...x,now:999999}).override).toBe('granted');
  for(const state of ['failed','ownership-unsettled']) expect(selectContinuity({...x,predecessor:{...x.predecessor!,state}}).override).toBe('refused');
  expect(selectContinuity({...x,bound:undefined}).override).toBe('refused');
  expect(selectContinuity({...x,predecessor:{...x.predecessor!,input:undefined}}).override).toBe('refused');
  expect(selectContinuity({...x,bound:{...bound,inputSafeExclusiveCap:79999,triggerTokens:80000}}).override).toBe('refused');
  for(const tokens of [159999,160000]) expect(selectContinuity({...x,predecessor:{...x.predecessor!,input:{...evidence,tokens}}}).continuity).toBe(tokens===159999?'native':'reseeded');
 });
 test('requires launched explicit settled operator interruptions for automatic reuse', () => {
  for(const state of ['cancelled','interrupted']) {
   const predecessor={...input().predecessor!,state};
   expect(selectContinuity({...input(),predecessor}).continuity).toBe('reseeded');
   expect(selectContinuity({...input(),predecessor:{...predecessor,stopOrigin:'lead'}}).continuity).toBe('native');
   expect(selectContinuity({...input(),predecessor:{...predecessor,stopOrigin:'system'}}).continuity).toBe('reseeded');
   expect(selectContinuity({...input(),predecessor:{...predecessor,stopOrigin:'user',launched:false}}).continuity).toBe('reseeded');
  }
 });
 test('review, unknown roles and fresh policy take precedence', () => {
  for(const role of ['review','unknown'] as const) expect(selectContinuity({...input(),role,request:'native',justification:'x'}).override).toBe('refused');
  expect(selectContinuity({...input(),policy:{mode:'fresh'}}).continuity).toBe('reseeded');
  expect(selectContinuity({...input(),predecessor:{...input().predecessor!,integrated:true}}).continuity).toBe('reseeded');
 });
 test('genuine zero is eligible; stale model, clock anomalies and nonfinal evidence are not', () => {
  expect(selectContinuity({...input(),predecessor:{...input().predecessor!,input:{...evidence,tokens:0}}}).continuity).toBe('native');
  for(const patch of [{final:false},{modelId:'other'},{tokens:NaN},{nativeThreadId:'other'}]) expect(selectContinuity({...input(),predecessor:{...input().predecessor!,input:{...evidence,...patch}}}).continuity).toBe('reseeded');
  expect(selectContinuity({...input(),now:99999}).continuity).toBe('reseeded');
  expect(sanitizeRequestInput({...evidence,tokens:null})).toBeUndefined();
 });
 test('rejects invalid config and unknown fields, supports zero disabling auto reuse', () => {
  for(const p of [{mode:'legacy'}, {autoNativeMaxAgeMs:-1}, {handoffMaxBytes:16384}, {nativeHardCapInputTokens:0}, {extra:1},null]) expect(()=>normalizeContinuityPolicy(p)).toThrow('crossRunner.continuity');
  expect(selectContinuity({...input(),policy:{autoNativeMaxAgeMs:0}}).continuity).toBe('reseeded');
 });
});
