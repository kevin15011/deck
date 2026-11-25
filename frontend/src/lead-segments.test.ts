import {test,expect} from 'bun:test';
import {partitionLeadSegments,isLeadUpdateReplacement} from './lead-segments';
test('partitions progress and answers while preserving legacy receipts',()=>{
 const times=[{start:0,at_ms:1,kind:'progress' as const},{start:5,at_ms:2,kind:'answer' as const}];
 expect(partitionLeadSegments('one\n\ntwo',times)).toEqual({progress:[{start:0,at_ms:1,kind:'progress',text:'one'}],answers:[{start:5,at_ms:2,kind:'answer',text:'two'}]});
 expect(partitionLeadSegments('old',[{start:0,at_ms:1}])).toBeNull();
});
test('only a different live segment replaces an update',()=>{
 expect(isLeadUpdateReplacement(0,0,true)).toBe(false);
 expect(isLeadUpdateReplacement(0,5,true)).toBe(true);
 expect(isLeadUpdateReplacement(0,5,false)).toBe(false);
});
