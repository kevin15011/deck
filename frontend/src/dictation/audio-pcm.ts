/** Windowed-sinc low-pass resampling; reject out-of-band energy before decimation. */
export function resampleTo16k(input:Float32Array,rate:number):Float32Array{
 if(!Number.isFinite(rate)||rate<8000||rate>192000)throw Error('Unsupported microphone sample rate');
 const length=Math.floor(input.length*16000/rate),out=new Float32Array(length),cutoff=Math.min(1,16000/rate)*.94,radius=32;
 for(let j=0;j<length;j++){const position=j*rate/16000,center=Math.floor(position);let sum=0,weight=0;
  for(let k=center-radius+1;k<=center+radius;k++){if(k<0||k>=input.length)continue;const d=k-position;if(Math.abs(d)>=radius)continue;const x=Math.PI*d*cutoff,w=(Math.abs(x)<1e-8?cutoff:Math.sin(x)/(Math.PI*d))*(.5+.5*Math.cos(Math.PI*d/radius));sum+=(Number.isFinite(input[k])?input[k]!:0)*w;weight+=w;}
  out[j]=weight?sum/weight:0;
 }return out;
}
export function encodeWav16(pcm:Float32Array):Uint8Array{
 const bytes=new Uint8Array(44+pcm.length*2),v=new DataView(bytes.buffer),tag=(p:number,s:string)=>{for(let i=0;i<s.length;i++)bytes[p+i]=s.charCodeAt(i);};
 tag(0,'RIFF');v.setUint32(4,bytes.length-8,true);tag(8,'WAVE');tag(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);tag(36,'data');v.setUint32(40,pcm.length*2,true);
 pcm.forEach((x,i)=>v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,Number.isFinite(x)?x:0))*(x<0?32768:32767)),true));return bytes;
}
export function speechAudio(pcm:Float32Array):Float32Array{
 const block=320;let first=-1,last=0;
 for(let i=0;i<pcm.length;i+=block){let energy=0;for(let j=i;j<Math.min(i+block,pcm.length);j++)energy+=pcm[j]!**2;if(Math.sqrt(energy/block)>.008){if(first<0)first=i;last=i+block;}}
 return first<0?new Float32Array():pcm.slice(Math.max(0,first-3200),Math.min(pcm.length,last+3200));
}
export function insertDictation(current:string,initial:string,selection:readonly[number,number]|undefined,text:string):string{
 text=text.trim();if(!text)return current;
 const at=current===initial&&selection?Math.max(0,Math.min(current.length,selection[0])):current.length;
 const left=current.slice(0,at),right=current.slice(at);
 return left+(left&&!/\s$/.test(left)?' ':'')+text+(right&&!/^\s/.test(right)?' ':'')+right;
}
