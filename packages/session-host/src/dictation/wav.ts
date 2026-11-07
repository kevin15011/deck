import {DICTATION_LIMITS} from '@deck/core/session/dictation';
export class DictationError extends Error {constructor(public code:string,public status=409){super(code);}}
export function parseWav(bytes:Uint8Array):{audioMs:number}{
 const fail=()=>{throw new DictationError('dictation-audio-format',415);};
 if(bytes.length>DICTATION_LIMITS.maxBytes)throw new DictationError('dictation-audio-too-large',413);
 if(bytes.length<44) return fail();
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),tag=(i:number)=>String.fromCharCode(...bytes.subarray(i,i+4));
 if(tag(0)!=='RIFF'||tag(8)!=='WAVE'||v.getUint32(4,true)!==bytes.length-8)return fail();
 let fmt=false,data:number|undefined;
 for(let i=12;i<bytes.length;){
  if(i+8>bytes.length)return fail();const size=v.getUint32(i+4,true),start=i+8,end=start+size;if(end>bytes.length)return fail();
  if(tag(i)==='fmt '){if(fmt||size!==16||v.getUint16(start,true)!==1||v.getUint16(start+2,true)!==1||v.getUint32(start+4,true)!==16000||v.getUint32(start+8,true)!==32000||v.getUint16(start+12,true)!==2||v.getUint16(start+14,true)!==16)return fail();fmt=true;}
  if(tag(i)==='data'){if(data!==undefined||size%2)return fail();data=size;}
  i=end+(size%2);if(i>bytes.length)return fail();
 }
 if(!fmt||data===undefined)return fail();const audioMs=data/32;
 if(audioMs<DICTATION_LIMITS.minAudioMs)throw new DictationError('dictation-audio-too-short',422);
 if(audioMs>DICTATION_LIMITS.maxAudioMs)throw new DictationError('dictation-audio-too-long',413);
 return{audioMs};
}
