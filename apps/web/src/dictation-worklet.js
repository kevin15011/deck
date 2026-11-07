/* Served same-origin for CSP; batch frames to keep the message queue bounded. */
class DeckDictationCapture extends AudioWorkletProcessor {
 constructor(){super();this.buffer=new Float32Array(4096);this.offset=0;this.frames=0;this.stopped=false;this.port.onmessage=event=>{if(event.data==='stop'&&!this.stopped){this.stopped=true;if(this.offset)this.port.postMessage(this.buffer.slice(0,this.offset));this.offset=0;this.port.postMessage({flushed:true});}};}
 process(inputs,outputs){
  if(this.stopped)return false;
  const input=inputs[0]?.[0];if(!input)return true;
  const max=Math.min(sampleRate*300,16000000);
  const frame=input.subarray(0,Math.max(0,max-this.frames));this.frames+=frame.length;
  for(const x of frame){this.buffer[this.offset++]=x;if(this.offset===this.buffer.length){this.port.postMessage(this.buffer,[this.buffer.buffer]);this.buffer=new Float32Array(4096);this.offset=0;}}
  // Keep the node connected without playing the microphone.
  for(const channels of outputs)for(const channel of channels)channel.fill(0);
  if(this.frames>=max||sampleRate>192000){this.stopped=true;if(this.offset)this.port.postMessage(this.buffer.slice(0,this.offset));this.offset=0;this.port.postMessage({limit:true});return false;}
  return true;
 }
}
registerProcessor('deck-dictation-capture',DeckDictationCapture);
