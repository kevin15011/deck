import {test,expect} from 'bun:test';
import {DeckHistory,parseRoute,routeURL,type DeckRoute} from './navigation';
function fixture(storageFails=false,asyncBack=false){
 const entries:{state:any;url:string}[]=[{state:null,url:'https://deck.test/?session=s#pair=secret'}];let position=0,pending=0;
 const memory=new Map<string,string>();
 const adapter={get state(){return entries[position]!.state;},get url(){return entries[position]!.url;},replace:(state:any,url:string)=>{entries[position]={state,url};},push:(state:any,url:string)=>{entries.splice(position+1);entries.push({state,url});position++;},back:()=>{if(asyncBack)pending++;else position--;},load:()=>{if(storageFails)throw Error('blocked');return memory.get('nav')??null;},save:(s:string)=>{if(storageFails)throw Error('blocked');memory.set('nav',s);}};
 const navigation=new DeckHistory(adapter);return{navigation,entries,adapter,flushBack:()=>{expect(pending).toBeGreaterThan(0);pending--;position--;navigation.pop();},back:()=>{position--;navigation.pop();},forward:()=>{position++;navigation.pop();},position:()=>position};
}
test('route parser accepts identifiers and finite anchors only; URL never carries pairing data',()=>{
 expect(parseRoute({project:'p',session:'s',tab:'chat',reply:'reply-9-8',anchor:{id:2,seq:8,offset:-14}})).toBeDefined();
 for(const value of [{project:'p',session:'../x'},{project:'p',anchor:{id:2,seq:8,offset:Infinity}},{project:'p',draft:'private'},{project:'p',tab:['chat']},{project:'p',overlay:{kind:['drawer']}},{project:'p',overlay:{kind:'image',attachmentId:'../../secret'}}])expect(parseRoute(value)).toBeUndefined();
 expect(routeURL({project:'p',session:'s',tab:'chat',reply:'reply-9-8'},'https://deck.test/#pair=secret')).toBe('https://deck.test/?session=s&reply=reply-9-8');
});

test('secondary information uses one transient Back entry without changing route, generation or captured scroll',()=>{
 const f=fixture();f.navigation.navigate({project:'p',session:'s',tab:'chat'},'replace');
 let captures=0;f.navigation.capture=()=>{captures++;return{id:2,seq:3,offset:10};};
 const entry=f.navigation.current,generation=f.navigation.generation;
 f.navigation.openSecondary('context-lead');f.navigation.openSecondary('mcp-servers');
 expect(f.entries.length).toBe(2);expect(f.navigation.secondary).toBe('mcp-servers');
 expect(f.navigation.current).toBe(entry);expect(f.navigation.generation).toBe(generation);expect(captures).toBe(0);
 f.navigation.closeSecondary();f.navigation.closeSecondary();expect(f.position()).toBe(0);f.navigation.pop();
 expect(f.navigation.secondary).toBeUndefined();expect(f.navigation.current).toBe(entry);expect(f.navigation.generation).toBe(generation);expect(captures).toBe(0);
 f.forward();expect(f.navigation.secondary).toBe('mcp-servers');expect(f.navigation.generation).toBe(generation);
 f.navigation.closeSecondary(true);expect(f.navigation.secondary).toBeUndefined();expect(f.position()).toBe(0);f.navigation.pop();
 f.navigation.navigate({...entry.route,overlay:{kind:'restart'}});expect(f.navigation.current.route.overlay?.kind).toBe('restart');
 f.navigation.openSecondary('context-lead');expect(f.navigation.secondary).toBeUndefined();
});
test('owned overlay predecessor is an actual recorded push edge, never depth or nonce membership alone',()=>{
 const f=fixture();f.navigation.navigate({project:'p',session:'s',tab:'chat'},'replace');
 f.navigation.navigate({...f.navigation.current.route,overlay:{kind:'drawer'}});expect(f.entries.length).toBe(2);expect(f.navigation.canBack()).toBe(true);
 const current=f.navigation.current;f.adapter.replace({deck:{...current,parent:current.key}},f.adapter.url);expect(f.navigation.canBack()).toBe(false);
 f.navigation.closeOverlay();expect(f.position()).toBe(1);expect(f.navigation.current.route.overlay).toBeUndefined();
});
test('Back/Forward restores exact entries and cached anchors without adding entries or leaking drafts',()=>{
 const f=fixture();f.navigation.navigate({project:'p',session:'s',tab:'chat'},'replace');f.navigation.anchor({id:2,seq:8,offset:-30});
 f.navigation.navigate({...f.navigation.current.route,overlay:{kind:'drawer'}});
 f.navigation.navigate({project:'p2',session:'other',tab:'chat',reply:'reply-20-18'},'replace');
 f.back();expect(f.navigation.current.route.session).toBe('s');expect(f.navigation.current.route.anchor).toEqual({id:2,seq:8,offset:-30});f.forward();expect(f.navigation.current.route.reply).toBe('reply-20-18');expect(f.entries.length).toBe(2);
 const length=f.entries.length;f.navigation.navigate({...f.navigation.current.route});expect(f.entries.length).toBe(length);
});
test('reload reuses a verified current entry; missing/corrupt ownership and storage failure never navigate Back',()=>{
 const f=fixture();f.navigation.navigate({project:'p',session:'s',tab:'chat',overlay:{kind:'install'}});const reloaded=new DeckHistory(f.adapter);expect(reloaded.canBack()).toBe(true);
 const foreign={...reloaded.current,parent:'00000000-0000-0000-0000-000000000000'};f.adapter.replace({deck:foreign},f.adapter.url);reloaded.pop();expect(reloaded.canBack()).toBe(false);
 const blocked=fixture(true);blocked.navigation.navigate({project:'p',session:'s',tab:'chat',overlay:{kind:'install'}});blocked.navigation.closeOverlay();expect(blocked.position()).toBe(1);expect(blocked.navigation.current.route.overlay).toBeUndefined();
});
test('duplicate overlay close cannot pop twice; duplicate exact link refocuses without adding an entry',()=>{
 const f=fixture();f.navigation.navigate({project:'p',session:'s',tab:'chat'},'replace');f.navigation.navigate({...f.navigation.current.route,overlay:{kind:'drawer'}});f.navigation.closeOverlay();f.navigation.closeOverlay();expect(f.position()).toBe(0);f.navigation.pop();
 f.navigation.navigate({project:'p',session:'s',tab:'chat',reply:'reply-9-8'});f.navigation.anchor({id:5,seq:7,offset:-30});const length=f.entries.length,generation=f.navigation.generation;
 f.navigation.navigate({project:'p',session:'s',tab:'chat',reply:'reply-9-8'});expect(f.entries.length).toBe(length);expect(f.navigation.current.route.anchor).toBeUndefined();expect(f.navigation.generation).toBeGreaterThan(generation);
});
test('bounded ownership journal preserves safe old view restoration without inventing an owned predecessor',()=>{
 const f=fixture();f.navigation.navigate({project:'p',session:'s',tab:'chat'},'replace');
 for(let n=0;n<60;n++)f.navigation.navigate({project:'p',session:'s',tab:n%2?'subagents':'activity'});
 for(let n=0;n<55;n++)f.back();expect(f.navigation.current.route.tab).toBe('activity');expect(f.navigation.canBack()).toBe(false);expect(f.entries.length).toBe(61);
});


test('navigating away while a secondary surface is open consumes its transient entry',()=>{
 const f=fixture();f.navigation.navigate({project:'p',session:'prior',tab:'chat'},'replace');
 f.navigation.navigate({project:'p',session:'s',tab:'chat'});f.navigation.openSecondary('context-lead');
 f.navigation.navigate({project:'p',session:'other',tab:'chat'});
 expect(f.entries.length).toBe(3);expect(f.navigation.current.route.session).toBe('other');
 f.back();expect(f.navigation.current.route.session).toBe('s');const generation=f.navigation.generation;
 f.back();expect(f.navigation.current.route.session).toBe('prior');expect(f.navigation.generation).toBe(generation+1);
 f.forward();f.forward();expect(f.navigation.current.route.session).toBe('other');expect(f.navigation.secondary).toBeUndefined();
});

test('automatic task dismissal traverses its owned transient; a forward tombstone never navigates or reopens',()=>{
 const f=fixture();f.navigation.navigate({project:'p',session:'prior',tab:'chat'},'replace');f.navigation.navigate({project:'p',session:'s',tab:'chat'});
 f.navigation.openSecondary('task-context');const generation=f.navigation.generation;
 f.navigation.closeSecondary(true);expect(f.position()).toBe(1);expect(f.navigation.secondary).toBeUndefined();f.navigation.pop();
 expect(f.navigation.generation).toBe(generation);
 f.forward();expect(f.position()).toBe(1);f.navigation.pop();expect(f.navigation.generation).toBe(generation);expect(f.navigation.secondary).toBeUndefined();
 f.back();expect(f.navigation.current.route.session).toBe('prior');
});

test('pending owned dismissal queues fast navigation until traversal and preserves anchor/generation',()=>{
 const f=fixture(false,true);f.navigation.navigate({project:'p',session:'s',tab:'chat'},'replace');
 f.navigation.capture=()=>({id:3,seq:9,offset:42});f.navigation.openSecondary('context');const generation=f.navigation.generation;
 f.navigation.closeSecondary(true);f.navigation.navigate({project:'p',session:'other',tab:'chat'});f.navigation.navigate({project:'p',session:'latest',tab:'chat'});
 expect(f.navigation.current.route.session).toBe('s');f.flushBack();
 expect(f.navigation.current.route.session).toBe('latest');expect(f.navigation.generation).toBe(generation+1);expect(f.entries.length).toBe(2);
 f.back();expect(f.navigation.current.route.session).toBe('s');expect(f.navigation.current.route.anchor?.offset).toBe(42);
});

test('reload preserves normal secondary Back/Forward and foreign state never authorizes automatic traversal',()=>{
 const f=fixture();f.navigation.navigate({project:'p',session:'s',tab:'chat'},'replace');f.navigation.openSecondary('context');
 const reload=new DeckHistory(f.adapter);expect(reload.secondary).toBe('context');reload.closeSecondary();expect(f.position()).toBe(0);reload.pop();
 expect(reload.secondary).toBeUndefined();
 const foreign={deck:{...reload.current,owner:crypto.randomUUID()},deckSecondary:{owner:crypto.randomUUID(),key:reload.current.key,panelId:'foreign',dismissed:true}};
 f.adapter.push(foreign,f.adapter.url);reload.pop();const position=f.position();reload.closeSecondary(true);expect(f.position()).toBe(position);
});

test('a new secondary trigger waits for pending dismissal without stacking duplicate entries',()=>{
 const f=fixture(false,true);f.navigation.navigate({project:'p',session:'s',tab:'chat'},'replace');
 f.navigation.openSecondary('context');f.navigation.closeSecondary(true);f.navigation.openSecondary('mcp');f.flushBack();
 expect(f.navigation.secondary).toBe('mcp');expect(f.entries.length).toBe(2);
});

test('consuming a secondary preserves primary overlay edges and stale async generation fences',()=>{
 const f=fixture();f.navigation.navigate({project:'p',session:'prior',tab:'chat'},'replace');f.navigation.navigate({project:'p',session:'s',tab:'chat'});
 const base=f.navigation.current;f.navigation.openSecondary('context');f.navigation.navigate({...base.route,overlay:{kind:'restart'}});
 expect(f.navigation.canBack()).toBe(true);expect(f.entries.length).toBe(3);f.navigation.closeOverlay();f.navigation.pop();
 expect(f.navigation.current.key).toBe(base.key);expect(f.navigation.current.route.overlay).toBeUndefined();
 f.navigation.openSecondary('context');f.navigation.closeSecondary(true);const generation=f.navigation.generation;
 f.navigation.navigate({project:'p',session:'other',tab:'chat'});f.navigation.annotate(base.key,{session:'stale'});f.navigation.pop();
 expect(f.navigation.current.route.session).toBe('other');expect(f.navigation.generation).toBe(generation+1);
 f.navigation.annotate(base.key,{session:'stale'});expect(f.navigation.current.route.session).toBe('other');
});

test('pending secondary cleanup never commits queued navigation across a foreign base boundary',()=>{
 const f=fixture();f.navigation.navigate({project:'p',session:'s',tab:'chat'},'replace');f.navigation.openSecondary('context');f.navigation.closeSecondary(true);
 f.navigation.navigate({project:'p',session:'other',tab:'chat'});const length=f.entries.length;
 f.adapter.replace({foreign:true},f.adapter.url);f.navigation.pop();
 expect(f.navigation.current.route.session).toBe('s');expect(f.entries.length).toBe(length);expect(f.position()).toBe(0);
});

test('reload of an owned dismissed marker cleans up only that base and unknown markers do not authorize traversal',()=>{
 const f=fixture();f.navigation.navigate({project:'p',session:'s',tab:'chat'},'replace');f.navigation.openSecondary('context');
 const marker=f.adapter.state;f.adapter.replace({...marker,deckSecondary:{...marker.deckSecondary,dismissed:true}},f.adapter.url);
 const reload=new DeckHistory(f.adapter);const stop=reload.subscribe(()=>{});expect(f.position()).toBe(0);reload.pop();expect(reload.generation).toBe(0);stop();
 const unknown={...marker.deck,key:crypto.randomUUID()};f.adapter.push({deck:unknown,deckSecondary:{owner:unknown.owner,key:unknown.key,panelId:'context',dismissed:true}},f.adapter.url);
 const position=f.position();new DeckHistory(f.adapter).subscribe(()=>{});expect(f.position()).toBe(position);
});

test('outside dismissal followed by a session click waits for overlay Back without losing the click',()=>{
 const f=fixture(false,true);f.navigation.navigate({project:'p',session:'s',tab:'chat'},'replace');
 f.navigation.navigate({...f.navigation.current.route,overlay:{kind:'drawer'}});
 f.navigation.closeOverlay();f.navigation.navigate({project:'p',session:'other',tab:'chat'});
 expect(f.navigation.current.route.session).toBe('s');f.flushBack();
 expect(f.navigation.current.route.session).toBe('other');expect(f.navigation.current.route.overlay).toBeUndefined();
 f.back();expect(f.navigation.current.route.session).toBe('s');expect(f.navigation.current.route.overlay).toBeUndefined();
});


test('queued overlay navigation is discarded when Back reaches a foreign entry',()=>{
 const f=fixture(false,true);f.navigation.navigate({project:'p',session:'s',tab:'chat'},'replace');f.navigation.navigate({...f.navigation.current.route,overlay:{kind:'drawer'}});
 f.navigation.closeOverlay();f.navigation.navigate({project:'p',session:'other',tab:'chat'});
 f.entries[0]!.state={foreign:true};f.flushBack();expect(f.navigation.current.route.session).toBe('s');
});

test('legacy OpenSpec routes migrate to Review without losing session',()=>{
 expect(parseRoute({project:'p',session:'s',tab:'openspec'})).toEqual({project:'p',session:'s',tab:'git'});
});
