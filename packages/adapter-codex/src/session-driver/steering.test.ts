import {expect,test} from 'bun:test';
import {reconcileHistory,steeringFailure} from './steering';
import {CodexRpcError} from './rpc';
import fixture from './__fixtures__/0.162.1/steering.json';
const input={nativeThreadId:fixture.threadId,nativeTurnId:fixture.turnId,clientUserMessageId:fixture.liveUserItem.clientId,text:fixture.liveUserItem.content[0]!.text};
test('native fixture reconciles exact same-turn client and text despite different live/history item IDs',()=>{
 expect(reconcileHistory(input,fixture.history)).toMatchObject({state:'accepted',via:'history',...input});
 const historyUser=fixture.history.thread.turns[0]!.items.find((i:any)=>i.type==='userMessage'&&i.clientId===input.clientUserMessageId)!;
 expect(historyUser.id).not.toBe(fixture.liveUserItem.id);
});
test('missing, wrong-thread, wrong-turn, different client/text and ambiguous duplicate history remain unknown',()=>{
 for(const candidate of [{},{...input,nativeThreadId:'foreign'},{...input,nativeTurnId:'foreign'},{...input,clientUserMessageId:'foreign'},{...input,text:'different'}])expect(reconcileHistory(candidate as any,fixture.history)).toMatchObject({state:'unknown'});
 const history=structuredClone(fixture.history),turn=history.thread.turns[0]!;turn.items.push(turn.items.find((i:any)=>i.clientId===input.clientUserMessageId)!);
 expect(reconcileHistory(input,history)).toMatchObject({state:'unknown'});
});
test('only exact observed native refusals classify as not-accepted; generic and non-steerable failures stay unknown',()=>{
 expect(steeringFailure(new CodexRpcError(-32600,'no active turn to steer'),input)).toEqual({state:'not-accepted',reason:'no-active-turn'});
 expect(steeringFailure(new CodexRpcError(-32600,`expected active turn id \`${input.nativeTurnId}\` but found \`different\``),input)).toEqual({state:'not-accepted',reason:'turn-mismatch'});
 for(const error of [new Error('timeout'),new CodexRpcError(-32600,'active turn is not steerable'),new CodexRpcError(-32600,undefined),new CodexRpcError(-32602,'no active turn to steer'),new CodexRpcError(-32600,'no active turn to steer extra'),new CodexRpcError(-32600,'expected active turn id `foreign` but found `other`')])expect(steeringFailure(error,input)).toMatchObject({state:'unknown'});
});
