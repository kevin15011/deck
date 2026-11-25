import {test,expect} from 'bun:test';
import {API} from './api';
import {parseAutoCompact} from './auto-compact';

// Protects: the settings view only renders host responses with the current API
// and a complete per-runner intent. Fails if malformed payloads are accepted.
test('automatic compaction settings accept only complete current responses',()=>{
 const ok={api:API,window:500000,claude:true,codex:false,agy:true};
 expect(parseAutoCompact(ok)).toEqual({window:500000,claude:true,codex:false,agy:true});
 for(const bad of [null,{...ok,api:API-1},{...ok,window:0},{...ok,window:'500000'},{...ok,claude:'yes'},{api:API,window:500000,claude:true,codex:false}])
  expect(()=>parseAutoCompact(bad)).toThrow();
});
