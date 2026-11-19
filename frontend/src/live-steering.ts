import {useEffect,useReducer,useRef,useState} from 'react';
import {HttpError,isSteeringCommand,request,steeringReceipt,type Receipt,type SteeringCommand,type SteeringReceipt} from './api';

type RetainedSteering={root:string;command:SteeringCommand};
const key=(owner:string)=>'deck2.live-steering.'+owner;

function retained(owner:string):RetainedSteering|undefined {
 if(!owner)return;
 try {
  const data=JSON.parse(localStorage.getItem(key(owner))??'null');
  if(data&&typeof data.root==='string'&&isSteeringCommand(data.command))return data;
 }catch{}
}

function sameCommand(a:SteeringCommand,b:SteeringCommand){
 return a.id===b.id&&a.session===b.session&&a.threadId===b.threadId&&a.expectedTurnId===b.expectedTurnId&&a.text===b.text;
}

export function useLiveSteering(owner:string,receipts:Receipt[],clearDraft:(owner:string,text:string)=>void){
 const [,refresh]=useReducer((revision:number)=>revision+1,0);
 const [notice,setNotice]=useState<{owner:string;text:string}>();
 const flights=useRef(new Set<string>());
 const pending=retained(owner);
 const record=receipts.find(r=>r.id===pending?.root)?.steering?.find(r=>r.id===pending?.command.id);

 function finish(owner:string,p:RetainedSteering,record:SteeringReceipt){
  if(retained(owner)?.command.id!==p.command.id)return;
  if(!sameCommand(p.command,record))throw Error('The recorded live message differs from the retained input. Your draft is kept.');
  if(record.state==='pending'||record.state==='dispatching')return;
  if(record.state==='accepted')clearDraft(owner,p.command.text);
  localStorage.removeItem(key(owner));
  refresh();
  setNotice(record.state==='accepted'?undefined:{owner,text:record.state==='rejected'
   ?'The Lead turn could not receive your live message. Your draft is kept.'
   :'Live delivery could not be confirmed. Check the conversation before sending this draft again.'});
 }

 useEffect(()=>{
  if(pending&&record){
   try{finish(owner,pending,record);}
   catch(e){setNotice({owner,text:(e as Error).message});}
  }
 },[owner,pending?.command.id,record?.state]);

 async function deliver(p:RetainedSteering){
  if(flights.current.has(owner))return;
  try{localStorage.setItem(key(owner),JSON.stringify(p));}
  catch{
   setNotice({owner,text:'Browser storage is unavailable. Your live message was not sent.'});
   return;
  }
  flights.current.add(owner);
  refresh();
  setNotice(undefined);
  try{
   const result=await request('POST',`/api/commands/${encodeURIComponent(p.root)}/steering`,p.command,AbortSignal.timeout(10000));
   finish(owner,p,steeringReceipt(result));
  }catch(e){
   if(retained(owner)?.command.id===p.command.id){
    if(e instanceof HttpError&&[400,403,409,413,422].includes(e.status)){
     localStorage.removeItem(key(owner));
     setNotice({owner,text:e.message});
    }else{
     setNotice({owner,text:'Live delivery is unconfirmed. Deck is checking the receipt. Your draft is kept.'});
    }
   }
  }finally{
   flights.current.delete(owner);
   refresh();
  }
 }
 return {
  pending:!!pending,
  retry:pending&&!record&&!flights.current.has(owner)?()=>void deliver(pending):undefined,
  notice:notice?.owner===owner?notice.text:undefined,
  send(target:Receipt,text:string){
   if(!owner||retained(owner)||flights.current.has(owner)||!target.thread||!target.turn||!text.trim())return;
   void deliver({root:target.id,command:{id:crypto.randomUUID(),session:target.session,threadId:target.thread,expectedTurnId:target.turn,text}});
  },
 };
}
