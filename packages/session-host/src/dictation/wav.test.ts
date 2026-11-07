import {expect,test} from 'bun:test';
import {parseWav} from './wav';
import {encodeWav16,resampleTo16k,insertDictation} from '../../../../apps/web/src/dictation/audio-pcm';
// Protects the native decoder boundary and draft preservation; oracle: PCM format and unchanged user text.
test('PCM16 mono WAV round trips and rejects malformed audio',()=>{
 const wav=encodeWav16(new Float32Array(16000).fill(.1));
 expect(parseWav(wav).audioMs).toBe(1000);
 expect(()=>parseWav(wav.subarray(0,100))).toThrow();
 const bad=wav.slice();new DataView(bad.buffer).setUint16(22,2,true);expect(()=>parseWav(bad)).toThrow();
 expect(()=>parseWav(encodeWav16(new Float32Array(100)))).toThrow();
});
test('resampling preserves duration/DC and rejects aliasing',()=>{
 const rate=48000,n=4800;
 const dc=resampleTo16k(new Float32Array(n).fill(.25),rate);expect(dc.length).toBe(1600);expect(dc[800]).toBeCloseTo(.25,3);
 const rms=(hz:number)=>{const x=resampleTo16k(Float32Array.from({length:n},(_,i)=>Math.sin(2*Math.PI*hz*i/rate)),rate);return Math.sqrt(x.slice(100,-100).reduce((s,v)=>s+v*v,0)/(x.length-200));};
 expect(rms(1000)).toBeGreaterThan(.65);expect(rms(12000)).toBeLessThan(.03);
});
test('dictation inserts without deleting selection or concurrent edits',()=>{
 expect(insertDictation('hello world','hello world',[6,11],'new')).toBe('hello new world');
 expect(insertDictation('edited','hello',[0,5],'new')).toBe('edited new');
});
