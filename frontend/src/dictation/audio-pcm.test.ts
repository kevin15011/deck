import {expect,test} from 'bun:test';
import {insertDictation,resampleTo16k,speechAudio,encodeWav16} from './audio-pcm';
// Original microphone-to-draft contract: append to edited drafts, no lost text or replacements.
test('dictation preserves concurrent edits and insertion spacing',()=>{
 expect(insertDictation('before after','before after',[7,12],' words ')).toBe('before words after');
 expect(insertDictation('newer draft','old draft',[0,4],'speech')).toBe('newer draft speech');
 expect(insertDictation('kept','kept',[0,0],'   ')).toBe('kept');
});
test('PCM rejects alias energy, silence and nonfinite input; emits mono 16k WAV',()=>{
 const input=Float32Array.from({length:48000},(_,i)=>Math.sin(2*Math.PI*1000*i/48000)*.2);
 const converted=resampleTo16k(input,48000);expect(converted.length).toBe(16000);
 const high=resampleTo16k(Float32Array.from({length:48000},(_,i)=>Math.sin(2*Math.PI*15000*i/48000)*.2),48000);
 const rms=(x:Float32Array)=>Math.sqrt(x.slice(100,-100).reduce((n,v)=>n+v*v,0)/(x.length-200));
 expect(rms(high)).toBeLessThan(rms(converted)*.02);expect(speechAudio(new Float32Array(16000)).length).toBe(0);
 const wav=encodeWav16(speechAudio(converted)),view=new DataView(wav.buffer);expect(view.getUint32(24,true)).toBe(16000);expect(view.getUint16(22,true)).toBe(1);expect(view.getUint32(40,true)).toBe(wav.length-44);
 expect(()=>resampleTo16k(input,0)).toThrow();expect([...resampleTo16k(new Float32Array([NaN,Infinity]),16000)]).toEqual([0,0]);
});
