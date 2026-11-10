import {expect,spyOn,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {startCapture,type Capture} from './capture';
import * as audio from './audio-pcm';

// Protects bounded recording retention and microphone release. Oracle: the capture
// limit stops acquisition but explicit Transcribe/Cancel owns the retained audio.
for(const rate of [48000,96000])test(`capture retains bounded audio at ${rate}Hz until explicit stop`,async()=>{
 const originalContext=globalThis.AudioContext,originalNode=globalThis.AudioWorkletNode;
 const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 let ended:(()=>void)|undefined;let stopped=false,disconnected=false,closed=false,handler:((e:any)=>void)|undefined;
 const track={stop(){stopped=true;},addEventListener(_event:string,fn:()=>void){ended=fn;}};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]})}}});
 globalThis.AudioContext=class{sampleRate=rate;audioWorklet={addModule:async()=>{}};destination={};createMediaStreamSource(){return{connect(){}};}async resume(){}async close(){closed=true;}} as any;
 globalThis.AudioWorkletNode=class{port={set onmessage(fn:any){handler=fn;},postMessage(){handler?.({data:{flushed:true}});}};connect(){}disconnect(){disconnected=true;}} as any;
 // Signal quality is exercised with the real filter in dictation/wav.test.ts.
 // Here a length-preserving non-silent substitute isolates retention/lifecycle.
 const resampler=spyOn(audio,'resampleTo16k').mockImplementation((input,rate)=>
  new Float32Array(Math.floor(input.length*16000/rate)).fill(input[0]??0));
 const captures:Capture[]=[],stops:Promise<Uint8Array>[]=[];
 const stop=(capture:Capture)=>{const result=capture.stop();stops.push(result);return result;};
 try{
  let limited=0;const capture=await startCapture(new AbortController().signal,()=>limited++);captures.push(capture);
  const max=Math.min(rate*300,16000000),frame=new Float32Array(4096).fill(.2);
  for(let n=0;n<max;n+=frame.length)handler!({data:frame});
  expect(limited).toBe(1);expect(stopped&&disconnected&&closed).toBe(true);
  expect(capture.limitSeconds).toBeCloseTo(max/rate);
  handler!({data:{limit:true}});expect(limited).toBe(1);
  const wav=await stop(capture);expect(wav.length).toBeGreaterThan(44+(max/rate-.001)*16000*2);
  expect(wav.length).toBeLessThanOrEqual(44+Math.ceil(max/rate*16000)*2);
  // The processor can report a limit independently of the main-thread count.
  const early=await startCapture(new AbortController().signal,()=>limited++);captures.push(early);
  handler!({data:new Float32Array(rate).fill(.2)});handler!({data:{limit:true}});
  expect(limited).toBe(2);expect((await stop(early)).length).toBeGreaterThan(44);
  let interrupted=false;const controller=new AbortController();
  const pending=await startCapture(controller.signal,()=>limited++,undefined,()=>interrupted=true);captures.push(pending);
  handler!({data:new Float32Array(rate).fill(.2)});ended!();
  expect(interrupted).toBe(true);expect(limited).toBe(2);expect(stopped).toBe(true);
  controller.abort();await expect(stop(pending)).rejects.toThrow();
 }finally{captures.forEach(capture=>capture.cancel());await Promise.allSettled(stops);resampler.mockRestore();globalThis.AudioContext=originalContext;globalThis.AudioWorkletNode=originalNode;if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else Reflect.deleteProperty(globalThis,'navigator');}
},15000);
// Exercise the actual served processor, including its partial final batch.
test('worklet delivers its bounded final samples before the limit message',()=>{
 let Processor:any;const messages:any[]=[];
 runInNewContext(readFileSync(new URL('../dictation-worklet.js',import.meta.url),'utf8'),{sampleRate:96000,Float32Array,AudioWorkletProcessor:class{port={postMessage:(data:any)=>messages.push(data)};},registerProcessor:(_name:string,ctor:any)=>Processor=ctor});
 const processor=new Processor(),input=new Float32Array(128).fill(.2);
 let running=true;for(let n=0;n<130000&&running;n++)running=processor.process([[input]],[]);
 const chunks=messages.filter(x=>x instanceof Float32Array);
 expect(chunks.reduce((n,x)=>n+x.length,0)).toBe(16000000);
 expect(messages.at(-1)).toEqual({limit:true});
 expect(running).toBe(false);
});
