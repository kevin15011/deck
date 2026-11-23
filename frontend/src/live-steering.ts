import {useEffect,useReducer,useRef,useState} from 'react';
import {HttpError,request,steeringReceipt,type QueuedSteeringSource,type Receipt,type SteeringCommand,type SteeringReceipt} from './api';

type QueuedSteering = Omit<SteeringCommand,'text'> & {queuedSource:QueuedSteeringSource};
type RetainedDelivery = {root:string;command:QueuedSteering};
const key = (owner:string) => 'deck2.queued-steering.'+owner;

function retained(owner:string):RetainedDelivery|undefined {
 if(!owner)return;
 try {
  const data=JSON.parse(localStorage.getItem(key(owner))??'null');
  const command=data?.command;
  if(typeof data?.root==='string'
   && [command?.id,command?.session,command?.threadId,command?.expectedTurnId,command?.queuedSource?.id,command?.queuedSource?.attempt].every(value=>typeof value==='string'))return data;
 }catch{}
}

export function useLiveSteering(owner:string,receipts:Receipt[]){
 const [,refresh]=useReducer((revision:number)=>revision+1,0);
 const [notice,setNotice]=useState<{owner:string;text:string}>();
 const flights=useRef(new Set<string>());
 const pending=retained(owner);
 const reservation=receipts.flatMap(receipt=>receipt.steering??[])
  .find(input=>input.queuedSource&&(input.state==='pending'||input.state==='dispatching'));
 const record=receipts.find(r=>r.id===pending?.root)?.steering?.find(r=>r.id===pending?.command.id);

 function finish(delivery:RetainedDelivery,result:SteeringReceipt){
  const command=delivery.command;
  if(retained(owner)?.command.id!==command.id)return;
  if(result.id!==command.id||result.session!==command.session||result.threadId!==command.threadId
   ||result.expectedTurnId!==command.expectedTurnId||result.queuedSource?.id!==command.queuedSource.id
   ||result.queuedSource?.attempt!==command.queuedSource.attempt)throw Error('Deck received a different live delivery receipt. Check the conversation and queue.');
  if(result.state==='pending'||result.state==='dispatching')return;
  localStorage.removeItem(key(owner));
  refresh();
  setNotice(result.state==='accepted'?undefined:{owner,text:result.state==='rejected'
   ?'The current turn declined the message. Deck returned it to the queue.'
   :'Live delivery could not be confirmed. Deck will keep this message out of the queue.'});
 }

 useEffect(()=>{
  if(pending&&record){
   try{finish(pending,record);}
   catch(e){setNotice({owner,text:(e as Error).message});}
  }
 },[owner,pending?.command.id,record?.state]);

 async function deliver(delivery:RetainedDelivery){
  if(flights.current.has(owner))return;
  try{localStorage.setItem(key(owner),JSON.stringify(delivery));}
  catch{
   setNotice({owner,text:'Browser storage is unavailable. The message is still queued.'});
   return;
  }
  flights.current.add(owner);
  refresh();
  setNotice(undefined);
  try{
   const path=`/api/commands/${encodeURIComponent(delivery.root)}/steering/queued`;
   const result=await request('POST',path,delivery.command,AbortSignal.timeout(10000));
   finish(delivery,steeringReceipt(result));
  }catch(e){
   if(retained(owner)?.command.id===delivery.command.id){
    if(e instanceof HttpError&&[400,403,409,413,422].includes(e.status)){
     localStorage.removeItem(key(owner));
     setNotice({owner,text:e.message});
    }else{
     setNotice({owner,text:'Live delivery is unconfirmed. Deck is checking the receipt.'});
    }
   }
  }finally{
   flights.current.delete(owner);
   refresh();
  }
 }

 return {
  pending:pending?.command.queuedSource.id??reservation?.queuedSource?.id,
  retry:pending&&!record&&!flights.current.has(owner)?()=>void deliver(pending):undefined,
  notice:notice?.owner===owner?notice.text:undefined,
  send(target:Receipt,input:Receipt){
   if(!owner||retained(owner)||flights.current.has(owner)||!input.attempt||!target.thread||!target.turn||target.session!==input.session)return;
   void deliver({root:target.id,command:{
    id:crypto.randomUUID(),session:target.session,threadId:target.thread,expectedTurnId:target.turn,
    queuedSource:{id:input.id,attempt:input.attempt},
   }});
  },
 };
}
