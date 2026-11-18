import {expect,test} from 'bun:test';
import type {Receipt} from './api';
import {beginCommandTiming,markCommandHeaders,markCommandRequest,observeCommandReceipt} from './command-timing';

test('command timings retain only bounded, receipt-correlated measurements',()=>{
 const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
 const entries=(command:string)=>performance.getEntriesByType('mark').filter(e=>e.name.startsWith('deck.command.'+command+'.'));
 for(let n=0;n<33;n++)beginCommandTiming(id(n),performance.now());
 expect(entries(id(0))).toHaveLength(0);
 const command=id(32);
 markCommandRequest(command);
 markCommandHeaders(command,new Response('private payload',{headers:{'Server-Timing':'deck_commit;dur=1.25, deck_receipt;dur=2.50'}}));
 const receipt={id:command,prompt:'private prompt',text:'private answer',accepted_ms:10,dispatch_ms:20,first_output_ms:30} as Receipt;
 observeCommandReceipt({...receipt,id:id(0)},'workspace');
 expect(entries(id(0))).toHaveLength(0);
 observeCommandReceipt(receipt,'workspace');
 observeCommandReceipt(receipt,'http');
 expect(entries(command)).toHaveLength(5);
 expect(entries(command).map(e=>(e as PerformanceMark).detail).slice(2)).toEqual([
  {status:200,hostCommitMs:1.25,hostReceiptMs:2.5},
  {source:'workspace',hostAcceptedMs:10},
  {source:'workspace',hostAcceptedMs:10,hostDispatchMs:20,hostFirstOutputMs:30},
 ]);
 beginCommandTiming(command,performance.now());
 markCommandRequest(command);
 expect(entries(command)).toHaveLength(7); // Manual retry preserves the preceding attempt's timing.
 expect(entries(id(1))).toHaveLength(0);

});
