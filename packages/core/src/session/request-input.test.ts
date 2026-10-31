import {expect,test} from 'bun:test';
import {codexRequestInput,claudeRequestInput} from './request-input';
test('Codex uses last input including cache once, validates totals and never uses cumulative/output/UI counters',()=>{
 const last={inputTokens:100,cachedInputTokens:90,outputTokens:50,reasoningOutputTokens:10,totalTokens:150};
 expect(codexRequestInput({last,total:{inputTokens:999999}},'n','t','m')?.tokens).toBe(100);
 for(const change of [{inputTokens:undefined},{totalTokens:151},{cachedInputTokens:101},{reasoningOutputTokens:51}])expect(codexRequestInput({last:{...last,...change}},'n','t','m')).toBeUndefined();
 expect(codexRequestInput({last:{inputTokens:0,cachedInputTokens:0,outputTokens:0,reasoningOutputTokens:0,totalTokens:0}},'n','t','m')?.tokens).toBe(0);
});
test('Claude adds cache read/write to uncached request input; missing counters are unknown',()=>{
 expect(claudeRequestInput({input_tokens:1,cache_creation_input_tokens:2,cache_read_input_tokens:3,output_tokens:900},'n','t','r','m')?.tokens).toBe(6);
 expect(claudeRequestInput({input_tokens:1},'n','t','r','m')).toBeUndefined();
 expect(claudeRequestInput({input_tokens:1,cache_creation_input_tokens:0,cache_read_input_tokens:0},'n','t',undefined,'m')).toBeUndefined();
});
