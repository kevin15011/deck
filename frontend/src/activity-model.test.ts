import {test,expect} from 'bun:test';
import {stepLabel,frameBatch,activityPage,memberStepLabel,type Step} from './activity-model';
const step=(seq:number,command='turn'):Step=>({seq,command,task:'',attempt:'attempt',item:String(seq),kind:'mcpToolCall',server:'deck-codebase-memory',tool:'search_graph',args:'{"query":"App"}',owner:'lead',runner:'codex',startedMs:1,durationMs:1,status:'done'});
// Protects deterministic provider attribution; oracle: decision 20 native names.
test('labels use actual MCP server and executable, never mentions inside arguments',()=>{
 expect(stepLabel(step(1)).label).toBe('codebase-memory · search_graph');
 expect(stepLabel({...step(1),server:'deck-context7',tool:'query-docs'}).label).toBe('context7 · query-docs');
 for(const args of ['rtk git status',"/bin/bash -lc 'rtk git status'",'env LANG=C /opt/bin/rtk git status'])expect(stepLabel({...step(1),kind:'commandExecution',args})).toMatchObject({label:'rtk',summary:'git status'});
 expect(stepLabel({...step(1),kind:'commandExecution',args:'echo "rtk git status"'}).label).toBe('shell');
 expect(stepLabel({...step(1),server:'other',args:'codebase-memory'}).label).toBe('other · search_graph');
 expect(stepLabel({...step(1),args:'token=fixture-secret'}).summary).not.toContain('fixture-secret');
});
// Protects the live and persistent labels from disclosing a multiword credential.
test('RTK labels redact the entire value of a quoted assignment',()=>{
 for(const args of [
  "rtk tool token='first private tail' --dry-run",
  `bash -lc 'rtk tool --token="first private tail" --dry-run'`,
  'rtk tool "token=first private tail" --dry-run',
 ]){
  const label=stepLabel({...step(1),kind:'commandExecution',args});
  expect(label.label).toBe('rtk');
  expect(label.summary).not.toMatch(/first|private tail/);
  expect(label.summary).toContain('--dry-run');
 }
});
// Protects burst coalescing and unmount cleanup with a deterministic fake scheduler.
test('a burst publishes only the newest value once per frame and stops after disposal',()=>{
 const callbacks=new Map<number,FrameRequestCallback>();let id=0;const values:number[]=[];
 const batch=frameBatch<number>(v=>values.push(v),cb=>{callbacks.set(++id,cb);return id;},n=>{callbacks.delete(n);});
 for(let n=0;n<10000;n++)batch.push(n);expect(callbacks.size).toBe(1);callbacks.get(1)!(0);callbacks.delete(1);expect(values).toEqual([9999]);
 batch.push(10000);expect(callbacks.size).toBe(1);batch.dispose();expect(callbacks.size).toBe(0);batch.push(10001);expect(callbacks.size).toBe(0);
});
test('pages reject foreign session, duplicate sequence and unbounded rows',()=>{
 const page={session:'s',steps:[step(1)],live:[],older:false,newer:false};expect(activityPage(page,'s')).toBe(page);
 expect(()=>activityPage(page,'other')).toThrow();expect(()=>activityPage({...page,steps:[step(1),step(1)]},'s')).toThrow();expect(()=>activityPage({...page,steps:Array.from({length:201},(_,i)=>step(i+1))},'s')).toThrow();
});
test('member previews show only observed activity and redact sensitive command arguments',()=>{
 const owner={task:'member',attempt:'current'};
 const activity={...step(1),...owner,status:'running' as const};
 expect(memberStepLabel({...activity,attempt:'previous'},owner)).toBeUndefined();
 expect(memberStepLabel({...activity,task:'sibling'},owner)).toBeUndefined();
 expect(memberStepLabel({...activity,kind:'reasoning',status:'done'},owner)).toBeUndefined();
 expect(memberStepLabel({...activity,kind:'reasoning',args:'private reasoning'},owner)).toBe('Thinking…');
 expect(memberStepLabel(activity,owner)).toBe('codebase-memory · search_graph');
 const command=memberStepLabel({...activity,kind:'commandExecution',args:`bash -lc 'rtk inspect --token "private tail" --dry-run'`},owner);
 expect(command).toContain('inspect');
 expect(command).toContain('--dry-run');
 expect(command).not.toContain('private');
});
