import {encodeWav16,resampleTo16k,speechAudio} from './audio-pcm';
export type Capture={limitSeconds:number;stop():Promise<Uint8Array>;cancel():void};
export const captureAvailable=()=>window.isSecureContext&&!!navigator.mediaDevices?.getUserMedia&&typeof AudioWorkletNode!=='undefined';
/** The permission promise may outlive cancellation. Always stop a late stream. */
export async function startCapture(signal:AbortSignal,onLimit:()=>void,onLevel?:(level:number)=>void,onInterrupted?:()=>void):Promise<Capture>{
 const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
 if(signal.aborted){stream.getTracks().forEach(t=>t.stop());throw Error('Dictation cancelled');}
 let context:AudioContext;try{context=new AudioContext();}catch(error){stream.getTracks().forEach(t=>t.stop());throw error;}const chunks:Float32Array[]=[];let count=0,closed=false,node:AudioWorkletNode|undefined,flushed:(()=>void)|undefined;
 const close=()=>{if(closed)return;closed=true;stream.getTracks().forEach(t=>t.stop());node?.disconnect();void context.close();signal.removeEventListener('abort',cancel);};
 const cancel=()=>{close();chunks.length=0;};signal.addEventListener('abort',cancel,{once:true});
 try{
  if(context.sampleRate>192000)throw Error('Unsupported microphone sample rate');
  await context.audioWorklet.addModule('/dictation-worklet.js');if(signal.aborted)throw Error('Dictation cancelled');
  node=new AudioWorkletNode(context,'deck-dictation-capture');
  const source=context.createMediaStreamSource(stream);source.connect(node);node.connect(context.destination);
  const max=Math.min(context.sampleRate*300,16000000);
  const limit=()=>{close();onLimit();};
  node.port.onmessage=event=>{if(event.data?.flushed){flushed?.();return;}if(closed)return;if(event.data?.limit){limit();return;}const data=event.data as Float32Array;if(!(data instanceof Float32Array))return;const remaining=max-count;if(remaining>0){const frame=data.length>remaining?data.slice(0,remaining):data;chunks.push(frame);count+=frame.length;let energy=0;for(const x of frame)energy+=x*x;onLevel?.(Math.sqrt(energy/frame.length));}if(count>=max)limit();};
  stream.getAudioTracks().forEach(track=>track.addEventListener('ended',()=>{if(!closed){cancel();onInterrupted?.();}},{once:true}));
  await context.resume();
  return{limitSeconds:max/context.sampleRate,cancel,stop:async()=>{
   stream.getTracks().forEach(t=>t.stop());
   if(!closed)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,250);flushed=()=>{clearTimeout(timer);resolve();};node?.port.postMessage('stop');});close();signal.throwIfAborted();
   const pcm=new Float32Array(count);let offset=0;for(const chunk of chunks){pcm.set(chunk,offset);offset+=chunk.length;}chunks.length=0;
   // Yield between one-second blocks so long clips remain cancellable during conversion.
   const parts:Float32Array[]=[];let samples=0;const block=context.sampleRate;
   for(let i=0;i<pcm.length;i+=block){signal.throwIfAborted();const part=resampleTo16k(pcm.subarray(i,i+block),context.sampleRate);parts.push(part);samples+=part.length;await new Promise<void>(resolve=>setTimeout(resolve,0));}
   signal.throwIfAborted();const converted=new Float32Array(samples);offset=0;for(const part of parts){converted.set(part,offset);offset+=part.length;}
   const audio=speechAudio(converted);if(audio.length<4800)throw Error('No speech detected. Try again.');return encodeWav16(audio);}};
 }catch(error){cancel();throw error;}
}
