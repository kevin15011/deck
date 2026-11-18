import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {pendingCommands,retainCommand,forgetCommand,matchesCommand,type PendingCommand} from './command-pending';
import {acknowledgedDraft} from './command-admission';
import {readDraft,writeDraft} from './draft-storage';
import {restoreInput} from './input-recall';
import type {Receipt,ImageAttachment} from './api';

function storage(){const values=new Map<string,string>();return {get length(){return values.size;},key:(i:number)=>[...values.keys()][i]??null,getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);},clear:()=>values.clear()} as Storage;}
// Exercise the actual App callback without mounting a browser. Only browser
// state/storage and image-hook effects are supplied by this harness.
function fixture(){
 const localStorage=storage(),scope={current:'owner'},draftRef={current:'Next message'},selectionRef={current:undefined},submissionSelection={current:undefined};
 const load=(k:string)=>readDraft(localStorage,'deck2.'+k),save=(k:string,v:string)=>writeDraft(localStorage,'deck2.'+k,v);
 const imagesByOwner=new Map<string,ImageAttachment[]>();
 const images={consume:(owner:string,ids:string[])=>imagesByOwner.set(owner,(imagesByOwner.get(owner)||[]).filter(a=>!ids.includes(a.id)))};
 const setDraft=(v:string)=>{draftRef.current=v;};
 const clearPending=(p:PendingCommand,owner=scope.current)=>forgetCommand(localStorage,owner,p);
 const source=readFileSync(new URL('./app.tsx',import.meta.url),'utf8');
 const callback=source.slice(source.indexOf(' function acknowledge('),source.indexOf(' useLayoutEffect(()=>{savePreference',source.indexOf(' function acknowledge(')));
 const js=new Bun.Transpiler({loader:'ts'}).transformSync(callback+'\nreturn acknowledge;');
 const acknowledge=new Function('localStorage','scope','draftRef','selectionRef','submissionSelection','load','save','images','setDraft','clearPending','selectDecision','matchesCommand','pendingCommands','acknowledgedDraft',js)(localStorage,scope,draftRef,selectionRef,submissionSelection,load,save,images,setDraft,clearPending,()=>{},matchesCommand,pendingCommands,acknowledgedDraft) as (p:PendingCommand,r:Receipt,owner?:string)=>void;
 const p:PendingCommand={id:'input',session:'session',prompt:'Next message',mode:'session_v1',fresh:false,attachments:['image'],queue:true,target:null};
 const attachment={id:'image',size:12,mime:'image/png'} as unknown as ImageAttachment;
 const r={...p,attachments:[attachment],phase:'queued',dispatch_ms:null,attempt:'attempt'} as unknown as Receipt;
 save('owner.draft',p.prompt);imagesByOwner.set('owner',[attachment]);retainCommand(localStorage,'owner',p);
 return {localStorage,scope,draftRef,load,save,imagesByOwner,acknowledge,p,r};
}
// Protects Q99-01. Oracle: confirmed recall transfers ownership back to the
// editable draft; a late/repeated POST acknowledgment cannot consume it again.
test('poll acknowledgment then confirmed recall survives delayed and repeated POST acknowledgments',async()=>{
 const f=fixture();f.acknowledge(f.p,f.r);
 expect(f.load('owner.draft')).toBe('');expect(f.imagesByOwner.get('owner')).toEqual([]);
 await restoreInput(f.localStorage,'owner',f.r,async()=>({id:f.r.id,session:f.r.session,attempt:f.r.attempt,state:'cancelled'}),text=>{f.draftRef.current=text;},r=>{f.imagesByOwner.set('owner',r.attachments);});
 expect(f.load('owner.draft')).toBe(f.p.prompt);expect(f.imagesByOwner.get('owner')).toEqual(f.r.attachments);
 f.acknowledge(f.p,f.r);f.acknowledge(f.p,f.r);
 expect(f.load('owner.draft')).toBe(f.p.prompt);expect(f.draftRef.current).toBe(f.p.prompt);expect(f.imagesByOwner.get('owner')).toEqual(f.r.attachments);
 // Same text/images now belong to a later submission, not the original ID.
 const later={...f.p,id:'later'};retainCommand(f.localStorage,'owner',later);
 f.scope.current='other';f.draftRef.current='Other session';f.save('other.draft','Other session');f.imagesByOwner.set('other',f.r.attachments);
 f.acknowledge(f.p,f.r,'owner');
 expect(f.load('owner.draft')).toBe(f.p.prompt);expect(f.imagesByOwner.get('owner')).toEqual(f.r.attachments);
 expect(pendingCommands(f.localStorage,'owner','session')).toEqual([later]);
 expect(f.load('other.draft')).toBe('Other session');expect(f.draftRef.current).toBe('Other session');expect(f.imagesByOwner.get('other')).toEqual(f.r.attachments);
});
// Protects first acknowledgment ownership across navigation and receipt mismatch.
// Oracle: only the matching retained submission may clean its owning scope.
test('first acknowledgment after session switch cleans only its retained owner',()=>{
 const f=fixture();f.scope.current='other';f.draftRef.current=f.p.prompt;f.save('other.draft',f.p.prompt);f.imagesByOwner.set('other',f.r.attachments);
 expect(()=>f.acknowledge(f.p,{...f.r,id:'foreign'},'owner')).toThrow();
 expect(f.load('owner.draft')).toBe(f.p.prompt);
 f.acknowledge(f.p,f.r,'owner');expect(f.load('owner.draft')).toBe('');expect(f.imagesByOwner.get('owner')).toEqual([]);
 expect(f.load('other.draft')).toBe(f.p.prompt);expect(f.draftRef.current).toBe(f.p.prompt);expect(f.imagesByOwner.get('other')).toEqual(f.r.attachments);
});
