import { sanitizeRequestInput, type RequestInputEvidence } from './task-continuity';
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
/** Codex last.input already includes cachedInputTokens. Synthetic compaction is excluded by driver. */
export function codexRequestInput(value:unknown,thread:unknown,turn:unknown,model:unknown):RequestInputEvidence|undefined {
 if(!record(value)||!record(value.last))return;
 const l=value.last;
 if(![l.inputTokens,l.outputTokens,l.totalTokens,l.cachedInputTokens,l.reasoningOutputTokens].every(count)||!Number.isSafeInteger(Number(l.inputTokens)+Number(l.outputTokens))||l.totalTokens!==Number(l.inputTokens)+Number(l.outputTokens)||Number(l.cachedInputTokens)>Number(l.inputTokens)||Number(l.reasoningOutputTokens)>Number(l.outputTokens)||l.cacheWriteTokens!==undefined)return;
 return sanitizeRequestInput({tokens:l.inputTokens,cachedReadTokens:l.cachedInputTokens,basis:'codex-last-input',nativeThreadId:thread,nativeTurnId:turn,modelId:model,final:false});
}
export function claudeRequestInput(usage:unknown,thread:unknown,turn:unknown,request:unknown,model:unknown):RequestInputEvidence|undefined {
 if(!record(usage)||![usage.input_tokens,usage.cache_creation_input_tokens,usage.cache_read_input_tokens].every(count))return;
 const tokens=Number(usage.input_tokens)+Number(usage.cache_creation_input_tokens)+Number(usage.cache_read_input_tokens);
 if(typeof request!=='string'||!request.trim())return;
 return sanitizeRequestInput({tokens,cachedReadTokens:usage.cache_read_input_tokens,cacheWriteTokens:usage.cache_creation_input_tokens,basis:'claude-message-input',nativeThreadId:thread,nativeTurnId:turn,nativeRequestId:request,modelId:model,final:false});
}
