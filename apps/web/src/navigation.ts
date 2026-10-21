/** Browser navigation is presentation only. No route is a delivery/read/authority receipt. */
import {useEffect,useRef,useState} from 'react';
import {validReplyId} from '../../../packages/core/src/session/lead-replies';
export type ChatAnchor={id:number;seq:number;offset:number};
export type DeckOverlay={kind:'drawer'|'unread'|'install'|'restart'}|{kind:'origin';decisionId:string}|{kind:'image';attachmentId:string};
export type DeckRoute={project:string;session?:string;tab:'chat'|'activity'|'subagents'|'openspec';overlay?:DeckOverlay;reply?:string;anchor?:ChatAnchor};
export type DeckEntry={v:1;owner:string;key:string;parent?:string;slot:number;route:DeckRoute};
type RecordEntry={entry:DeckEntry;from?:{key:string;slot:number;signature:string}};
type Journal={v:1;owner:string;records:RecordEntry[]};
export type HistoryAdapter={readonly state:unknown;readonly url:string;push(state:unknown,url:string):void;replace(state:unknown,url:string):void;back():void;load():string|null;save(value:string):void};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const id=(v:unknown,max=64):v is string=>typeof v==='string'&&v.length<=max&&/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v)&&!v.includes('..');
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,allowed:string[])=>Object.keys(v).every(k=>allowed.includes(k));
export function parseAnchor(v:unknown):ChatAnchor|undefined{
 if(!object(v)||!keys(v,['id','seq','offset'])||!Number.isSafeInteger(v.id)||Number(v.id)<1||!Number.isSafeInteger(v.seq)||Number(v.seq)<1||typeof v.offset!=='number'||!Number.isFinite(v.offset)||Math.abs(v.offset)>10_000_000)return;
 return{id:Number(v.id),seq:Number(v.seq),offset:v.offset};
}
export function parseRoute(v:unknown):DeckRoute|undefined{
 if(!object(v)||!keys(v,['project','session','tab','overlay','reply','anchor'])||v.project!==''&&!id(v.project,128)||v.session!==undefined&&!id(v.session)||typeof(v.tab??'chat')!=='string'||!['chat','activity','subagents','openspec'].includes(String(v.tab??'chat'))||v.reply!==undefined&&(!validReplyId(v.reply)||!v.session))return;
 let overlay:DeckOverlay|undefined;
 if(v.overlay!==undefined){const o=v.overlay;if(!object(o)||typeof o.kind!=='string'||!keys(o,['kind','decisionId','attachmentId']))return;
  if(['drawer','unread','install','restart'].includes(String(o.kind))&&Object.keys(o).length===1)overlay={kind:o.kind as 'drawer'|'unread'|'install'|'restart'};
  else if(o.kind==='origin'&&v.session&&id(o.decisionId,128)&&Object.keys(o).length===2)overlay={kind:'origin',decisionId:o.decisionId};
  else if(o.kind==='image'&&v.session&&uuid(o.attachmentId)&&Object.keys(o).length===2)overlay={kind:'image',attachmentId:o.attachmentId};else return;
 }
 const anchor=v.anchor===undefined?undefined:parseAnchor(v.anchor);if(v.anchor!==undefined&&(!anchor||!v.session))return;
 return{project:v.project as string,...(v.session?{session:v.session as string}:{}),tab:(v.tab??'chat') as DeckRoute['tab'],...(overlay?{overlay}:{}),...(v.reply?{reply:v.reply as string}:{}),...(anchor?{anchor}:{})};
}
export function routeURL(route:DeckRoute,base:string){const url=new URL(base);url.search='';url.hash='';if(route.session)url.searchParams.set('session',route.session);if(route.reply)url.searchParams.set('reply',route.reply);return url.href;}
const signature=(route:DeckRoute)=>JSON.stringify([route.project,route.session??null,route.tab,route.overlay?[route.overlay.kind,'decisionId' in route.overlay?route.overlay.decisionId:'attachmentId' in route.overlay?route.overlay.attachmentId:null]:null,route.reply??null]);
export const sameRoute=(a:DeckRoute,b:DeckRoute)=>signature(a)===signature(b);
function parseEntry(value:unknown):DeckEntry|undefined{
 if(!object(value)||!keys(value,['v','owner','key','parent','slot','route'])||value.v!==1||!uuid(value.owner)||!uuid(value.key)||value.parent!==undefined&&!uuid(value.parent)||!Number.isSafeInteger(value.slot)||Number(value.slot)<0||value.parent&&Number(value.slot)<1)return;
 const route=parseRoute(value.route);if(!route)return;return{v:1,owner:value.owner,key:value.key,...(value.parent?{parent:value.parent as string}:{}),slot:Number(value.slot),route};
}
const equivalent=(a:DeckEntry,b:DeckEntry)=>a.owner===b.owner&&a.key===b.key&&a.parent===b.parent&&a.slot===b.slot&&sameRoute(a.route,b.route);
export class DeckHistory{
 current:DeckEntry;
 generation=0;
 capture?:()=>ChatAnchor|undefined;
 private journal:Journal;
 private storage=true;
 private closingKey?:string;
 private listeners=new Set<()=>void>();
 constructor(private adapter:HistoryAdapter){
  this.journal={v:1,owner:crypto.randomUUID(),records:[]};
  try{const raw=adapter.load();if(raw){const j=JSON.parse(raw);if(j?.v!==1||!uuid(j.owner)||!Array.isArray(j.records)||j.records.length>50)throw Error();
   const records:RecordEntry[]=[];for(const r of j.records){const entry=parseEntry(r.entry);if(!entry||entry.owner!==j.owner||records.some(x=>x.entry.key===entry.key))throw Error();
    if(r.from&&(!uuid(r.from.key)||!Number.isSafeInteger(r.from.slot)||typeof r.from.signature!=='string'||r.from.signature.length>1024))throw Error();records.push({entry,...(r.from?{from:r.from}:{})});}
   this.journal={v:1,owner:j.owner,records};}}
  catch{this.storage=false;}
  const existing=this.readOwned();
  this.current=existing??this.fresh(this.fallbackRoute());
  this.write(this.current,'replace');
 }
 private urlRoute():DeckRoute{const url=new URL(this.adapter.url),session=url.searchParams.get('session'),reply=url.searchParams.get('reply');return{project:'',tab:'chat',...(id(session)?{session}:{}),...(id(session)&&validReplyId(reply)?{reply}:{})};}
 private fallbackRoute():DeckRoute{const entry=object(this.adapter.state)?parseEntry(this.adapter.state.deck):undefined;return entry?.owner===this.journal.owner&&routeURL(entry.route,this.adapter.url)===this.adapter.url?entry.route:this.urlRoute();}
 private fresh(route:DeckRoute):DeckEntry{return{v:1,owner:this.journal.owner,key:crypto.randomUUID(),slot:0,route};}
 private record(key:string){return this.journal.records.find(r=>r.entry.key===key);}
 private readOwned():DeckEntry|undefined{
  const raw=object(this.adapter.state)?parseEntry(this.adapter.state.deck):undefined;
  if(!raw||raw.owner!==this.journal.owner||routeURL(raw.route,this.adapter.url)!==this.adapter.url)return;
  const record=this.record(raw.key);if(!record||!equivalent(record.entry,raw))return;
  return{...raw,route:{...raw.route,...(record.entry.route.anchor?{anchor:record.entry.route.anchor}:{})}};
 }
 private persist(){try{this.adapter.save(JSON.stringify(this.journal));}catch{this.storage=false;}}
 private remember(entry:DeckEntry,from?:RecordEntry['from']){const old=this.record(entry.key);if(old)old.entry=entry;else this.journal.records.push({entry,...(from?{from}:{})});this.journal.records=this.journal.records.slice(-50);this.persist();}
 private write(entry:DeckEntry,mode:'push'|'replace',from?:RecordEntry['from']){
  try{if(mode==='push')this.adapter.push({deck:entry},routeURL(entry.route,this.adapter.url));else this.adapter.replace({deck:entry},routeURL(entry.route,this.adapter.url));}
  catch{if(mode==='push'){entry={...this.current,route:entry.route};try{this.adapter.replace({deck:entry},routeURL(entry.route,this.adapter.url));}catch{}}}
  this.current=entry;this.remember(entry,from);
 }
 private notify(){this.generation++;for(const fn of this.listeners)fn();}
 subscribe(fn:()=>void){this.listeners.add(fn);return()=>{this.listeners.delete(fn);};}
 anchor(anchor:ChatAnchor|undefined){if(!anchor)return;const clean=parseAnchor(anchor);if(!clean||!this.current.route.session)return;
  const entry={...this.current,route:{...this.current.route,anchor:clean}};const actual=this.readOwned();
  if(actual?.key===this.current.key)this.write(entry,'replace');else this.remember(entry);
 }
 navigate(route:DeckRoute,mode:'push'|'replace'='push'){
  const clean=parseRoute(route);if(!clean)return;this.closingKey=undefined;
  const exactRequest=!!clean.reply&&!route.anchor&&!route.overlay;
  const previousSession=this.current.route.session,previousReply=this.current.route.reply;
  this.anchor(this.capture?.());
  if(!exactRequest&&clean.session&&clean.session===previousSession&&clean.reply===previousReply&&this.current.route.anchor)clean.anchor=this.current.route.anchor;
  if(!exactRequest&&clean.session&&!clean.anchor&&clean.session!==previousSession){const prior=[...this.journal.records].reverse().find(r=>r.entry.route.session===clean.session&&r.entry.route.anchor);if(prior)clean.anchor=prior.entry.route.anchor;}
  if(sameRoute(clean,this.current.route)){if(exactRequest){this.write({...this.current,route:{...clean,anchor:undefined}},'replace');this.notify();}else if(clean.anchor)this.anchor(clean.anchor);return;}
  const previous=this.current,owned=this.readOwned();
  if(mode==='push'){
   const entry={...this.fresh(clean),...(owned?.key===previous.key?{parent:previous.key,slot:previous.slot+1}:{})};
   this.write(entry,'push',entry.parent?{key:previous.key,slot:previous.slot,signature:signature(previous.route)}:undefined);
  }else this.write({...previous,route:clean},'replace');
  this.notify();
 }
 /** Async completion may annotate only its current entry. It never adds history. */
 annotate(key:string,patch:Partial<DeckRoute>){if(this.current.key!==key||this.readOwned()?.key!==key)return;const route=parseRoute({...this.current.route,...patch});if(route)this.write({...this.current,route},'replace');}
 canBack(){
  if(!this.storage)return false;const actual=this.readOwned();if(!actual||actual.key!==this.current.key||!actual.parent)return false;
  const record=this.record(actual.key),parent=this.record(actual.parent),from=record?.from;
  return !!from&&!!parent&&from.key===actual.parent&&from.slot===parent.entry.slot&&actual.slot===parent.entry.slot+1&&from.signature===signature(parent.entry.route);
 }
 closeOverlay(){if(this.closingKey===this.current.key)return;const actual=this.readOwned();if(!this.current.route.overlay)return;
  if(actual?.key===this.current.key&&actual.route.overlay&&this.canBack()){try{this.closingKey=this.current.key;this.adapter.back();return;}catch{this.closingKey=undefined;}}
  this.navigate({...this.current.route,overlay:undefined},'replace');
 }
 pop(){
  this.closingKey=undefined;
  // The DOM still shows the departing view at this point. Keep its last anchor in
  // the bounded journal; never rewrite the newly active browser entry with it.
  const saved=this.capture?.();if(saved&&this.current.route.session){const clean=parseAnchor(saved);if(clean)this.remember({...this.current,route:{...this.current.route,anchor:clean}});}
  const next=this.readOwned();this.current=next??this.fresh(this.fallbackRoute());
  if(!next)this.write(this.current,'replace');this.notify();
 }
}
export function useDeckHistory(){
 const controller=useRef<DeckHistory|undefined>(undefined);
 if(!controller.current)controller.current=new DeckHistory({get state(){return window.history.state;},get url(){return window.location.href;},push:(state,url)=>window.history.pushState(state,'',url),replace:(state,url)=>window.history.replaceState(state,'',url),back:()=>window.history.back(),load:()=>sessionStorage.getItem('deck.nav'),save:value=>sessionStorage.setItem('deck.nav',value)});
 const nav=controller.current;const [snapshot,setSnapshot]=useState(()=>({entry:nav.current,generation:nav.generation}));
 useEffect(()=>{const unsubscribe=nav.subscribe(()=>setSnapshot({entry:nav.current,generation:nav.generation}));const pop=()=>nav.pop();const show=(event:PageTransitionEvent)=>{if(event.persisted)nav.pop();};
  window.addEventListener('popstate',pop);window.addEventListener('pageshow',show);let scroll:ScrollRestoration|undefined;try{scroll=history.scrollRestoration;history.scrollRestoration='manual';}catch{}
  return()=>{unsubscribe();window.removeEventListener('popstate',pop);window.removeEventListener('pageshow',show);try{if(scroll)history.scrollRestoration=scroll;}catch{}};
 },[nav]);
 return{controller:nav,...snapshot};
}
