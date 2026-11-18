import {test,expect} from 'bun:test';
import {pendingCommands,retainCommand,forgetCommand,matchesCommand,type PendingCommand} from './command-pending';
class MemoryStorage implements Storage {
 data=new Map<string,string>();get length(){return this.data.size;}key(i:number){return [...this.data.keys()][i]??null;}getItem(k:string){return this.data.get(k)??null;}setItem(k:string,v:string){this.data.set(k,v);}removeItem(k:string){this.data.delete(k);}clear(){this.data.clear();}
}
const pending=(id:string,session='session-a'):PendingCommand=>({id,session,prompt:'Answer both questions',mode:'session_v1',fresh:false,attachments:['image-a'],target:{sessionId:session,decisionId:'question-a',revision:2,questionRevision:1,question:'May we proceed?'},queue:false});
// Protects exact recovery and conditional cleanup, independently of tab/session ordering.
test('separate tabs and sessions retain immutable input including its target',()=>{
 const storage=new MemoryStorage(),a=pending('command-a'),b=pending('command-b'),c=pending('command-c','session-b');
 retainCommand(storage,'host.h.project.p.session.a',a);retainCommand(storage,'host.h.project.p.session.a',b);retainCommand(storage,'host.h.project.p.session.b',c);
 expect(pendingCommands(storage,'host.h.project.p.session.a','session-a')).toEqual([a,b]);
 expect(()=>retainCommand(storage,'host.h.project.p.session.a',{...a,target:null})).toThrow('conflicts');
 expect(()=>forgetCommand(storage,'host.h.project.p.session.a',{...a,prompt:'changed'})).toThrow();
 forgetCommand(storage,'host.h.project.p.session.a',a);
 expect(pendingCommands(storage,'host.h.project.p.session.a','session-a')).toEqual([b]);
 expect(pendingCommands(storage,'host.h.project.p.session.b','session-b')).toEqual([c]);
});
test('unattributed legacy target is never inferred from the shared key; receipt reconciliation preserves other records',()=>{
 const storage=new MemoryStorage(),scope='host.h.project.p.session.a',base='deck2.'+scope+'.';
 storage.setItem(base+'pending','legacy-a');storage.setItem(base+'pending-prompt','saved');storage.setItem(base+'pending-mode','session_v1');storage.setItem(base+'pending-fresh','false');storage.setItem('deck2.pending-target',JSON.stringify(pending('other').target));
 const [p]=pendingCommands(storage,scope,'session-a');expect(p.target).toBeUndefined();
 expect(()=>retainCommand(storage,scope,p)).toThrow();
 const newer=pending('newer');retainCommand(storage,scope,newer);forgetCommand(storage,scope,p);
 expect(pendingCommands(storage,scope,'session-a')).toEqual([newer]);expect(storage.getItem('deck2.pending-target')).not.toBeNull();
});
test('receipt matching includes exact scope and immutable payload, not the editable composer',()=>{
 const p=pending('command-a'),r={id:p.id,session:p.session,prompt:p.prompt,mode:p.mode,fresh:p.fresh,attachments:[{id:'image-a'}]} as Parameters<typeof matchesCommand>[1];
 expect(matchesCommand(p,r)).toBe(true);
 for(const delta of [{id:'other'},{session:'foreign'},{prompt:'edited'},{mode:'read_only'},{fresh:true},{attachments:[]}])expect(matchesCommand(p,{...r,...delta} as typeof r)).toBe(false);
});
