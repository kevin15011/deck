import { expect, test } from 'bun:test';
import { syncWithNewBinary } from './new-binary-sync';
// Oracle: only the new executable synchronizes content after replacement; child failure defers.
test('new executable receives exact argv and parsed results; failures defer without leaking stderr', () => {
 const outcome={outcomes:[],manifestEntries:[]};
 let argv:readonly string[]=[];
 expect(syncWithNewBinary({executable:'/new deck',backupId:'backup-1',projectRoot:'/fixture',spawn:(command,args)=>{expect(command).toBe('/new deck');argv=args;return {status:0,stdout:JSON.stringify(outcome)};}})).toEqual(outcome);
 expect(argv).toEqual(['internal','runner-sync','--backup-id','backup-1','--json']);
 for(const result of [{status:1,stdout:'secret=abc'},{status:0,stdout:'{}'},{status:null,stdout:''}]) {
  const actual=syncWithNewBinary({executable:'/new',projectRoot:'/fixture',spawn:()=>result});
  expect(actual.outcomes[0]?.status).toBe('deferred');
  expect(JSON.stringify(actual)).not.toContain('secret');
 }
});
