import {test,expect} from 'bun:test';
import {DeckHistory,parseRoute,routeURL,type DeckRoute} from './navigation';
function fixture(storageFails=false){
 const entries:{state:any;url:string}[]=[{state:null,url:'https://deck.test/?session=s#pair=secret'}];let position=0;
 const memory=new Map<string,string>();
 const adapter={get state(){return entries[position]!.state;},get url(){return entries[position]!.url;},replace:(state:any,url:string)=>{entries[position]={state,url};},push:(state:any,url:string)=>{entries.splice(position+1);entries.push({state,url});position++;},back:()=>{position--;},load:()=>{if(storageFails)throw Error('blocked');return memory.get('nav')??null;},save:(s:string)=>{if(storageFails)throw Error('blocked');memory.set('nav',s);}};
 const navigation=new DeckHistory(adapter);return{navigation,entries,adapter,back:()=>{position--;navigation.pop();},forward:()=>{position++;navigation.pop();},position:()=>position};
}
test('route parser accepts identifiers and finite anchors only; URL never carries pairing data',()=>{
 expect(parseRoute({project:'p',session:'s',tab:'chat',reply:'reply-9-8',anchor:{id:2,seq:8,offset:-14}})).toBeDefined();
 for(const value of [{project:'p',session:'../x'},{project:'p',anchor:{id:2,seq:8,offset:Infinity}},{project:'p',draft:'private'},{project:'p',tab:['chat']},{project:'p',overlay:{kind:['drawer']}},{project:'p',overlay:{kind:'image',attachmentId:'../../secret'}}])expect(parseRoute(value)).toBeUndefined();
 expect(routeURL({project:'p',session:'s',tab:'chat',reply:'reply-9-8'},'https://deck.test/#pair=secret')).toBe('https://deck.test/?session=s&reply=reply-9-8');
});
test('owned overlay predecessor is an actual recorded push edge, never depth or nonce membership alone',()=>{
 const f=fixture();f.navigation.navigate({project:'p',session:'s',tab:'chat'},'replace');
 f.navigation.navigate({...f.navigation.current.route,overlay:{kind:'drawer'}});expect(f.entries.length).toBe(2);expect(f.navigation.canBack()).toBe(true);
 const current=f.navigation.current;f.adapter.replace({deck:{...current,parent:current.key}},f.adapter.url);expect(f.navigation.canBack()).toBe(false);
 f.navigation.closeOverlay();expect(f.position()).toBe(1);expect(f.navigation.current.route.overlay).toBeUndefined();
});
test('Back/Forward restores exact entries and cached anchors without adding entries or leaking drafts',()=>{
 const f=fixture();f.navigation.navigate({project:'p',session:'s',tab:'chat'},'replace');f.navigation.anchor({id:2,seq:8,offset:-30});
 f.navigation.navigate({...f.navigation.current.route,overlay:{kind:'unread'}});
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
