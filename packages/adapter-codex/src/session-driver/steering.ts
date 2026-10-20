import type { SteeringInput, SteeringOutcome } from '@deck/core/session/steering';
import { CodexRpcError, object } from './rpc';
/** Only diagnostics observed on 0.162.1 establish definitive non-acceptance. */
export function steeringFailure(error: unknown, input:SteeringInput): SteeringOutcome {
 if(error instanceof CodexRpcError && error.code === -32600){
  if(error.diagnostic === 'no active turn to steer')return {state:'not-accepted',reason:'no-active-turn'};
  const mismatch=/^expected active turn id `([^`]+)` but found `([^`]+)`$/.exec(error.diagnostic??'');
  if(mismatch && mismatch[1]===input.nativeTurnId && mismatch[2]!==input.nativeTurnId)return {state:'not-accepted',reason:'turn-mismatch'};
 }
 return {state:'unknown',reason:'native-outcome-unconfirmed'};
}
export function reconcileHistory(input: SteeringInput, value:unknown):SteeringOutcome{
 const thread=object(object(value).thread);
 if(thread.id !== input.nativeThreadId || !Array.isArray(thread.turns))return {state:'unknown',reason:'history-unavailable'};
 const turns=thread.turns.map(object).filter(t=>t.id===input.nativeTurnId);
 const keyed=turns.flatMap(t=>Array.isArray(t.items)?t.items:[]).map(object).filter(i=>i.type==='userMessage'&&i.clientId===input.clientUserMessageId);
 const matches=keyed.filter(i=>Array.isArray(i.content)&&i.content.length===1&&object(i.content[0]).type==='text'&&object(i.content[0]).text===input.text);
 return keyed.length===1&&matches.length===1 ? {state:'accepted',...input,via:'history'} : {state:'unknown',reason:'history-absent-or-ambiguous'};
}
