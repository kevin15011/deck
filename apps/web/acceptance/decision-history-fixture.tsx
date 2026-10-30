import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Decisions,DecisionHistory,DecisionOrigin,type DecisionView} from '../src/decisions';
import {SecondaryInfoProvider} from '../src/secondary-info';
import '../src/style.css';
const base:DecisionView={decisionId:'d',revision:1,questionRevision:1,questionSeq:1,createdSeq:1,updatedSeq:1,question:'Choose scope',state:'answered',origin:{taskId:'lead',attempt:1,admissionSeq:1},source:{promptId:'p'},key:'scope',openingFingerprint:'h',relatedTaskIds:[],replies:[],queuedReplies:[]};
const originApi=async(path:string)=>{
 const after=Number(new URL(path,'http://fixture').searchParams.get('after'));
 const seq=after+1;
 const event={v:1,sessionId:'a',seq,ts:'2026-10-29T00:00:00Z',source:{taskId:'child'},kind:seq===8?'task.created':seq===9?'task.result':'diagnostic',data:seq===8?{attempt:1}:seq===9?{summary:'Exact original report'}:{}};
 return {events:[event],seq,hasMore:true};
};
function Fixture(){
 const [session,setSession]=useState('a'),[state,setState]=useState<DecisionView['state']>('answered'),[origin,setOrigin]=useState(false),[searchOrigin,setSearchOrigin]=useState(false),[selected,setSelected]=useState(false);
 const decisions=session==='a'?[{...base,state},...(state==='pending'?[{...base,decisionId:'history',question:'Previous scope'}]:[])]:[];
 const props={decisions,connected:true,busy:false,onReply:()=>{setSelected(true);document.getElementById('prompt')?.focus();},onClear:()=>setSelected(false),onAction:(_:DecisionView,type:string)=>setState(type==='decision.defer'?'deferred':type==='decision.reopen'?'pending':'cancelled'),onOrigin:()=>setOrigin(true),onRefresh:()=>{}};
 return <SecondaryInfoProvider scopeKey={session}><header><button onClick={()=>setSearchOrigin(true)}>Search long history</button><button onClick={()=>setSession(s=>s==='a'?'b':'a')}>Switch session</button><button onClick={()=>setState('pending')}>Ask question</button><DecisionHistory key={session} {...props} sessionId={session}/></header>{origin&&<p role="status">Origin opened</p>}{searchOrigin&&<DecisionOrigin decision={{...base,source:{taskId:'child',attempt:1}}} events={[]} api={originApi} sessionId={session} onClose={()=>setSearchOrigin(false)}/>}<main><Decisions key={session} {...props} selection={selected?{sessionId:session,decisionId:'d',revision:1,questionRevision:1,question:'Choose scope'}:undefined}/><textarea id="prompt" aria-label="Message" defaultValue="Draft"/></main></SecondaryInfoProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
