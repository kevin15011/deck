// Minimal native hook host; no model execution. The pinned legacy plugin owns
// recall, batching and background capture. No Deck loopback is substituted.
import { pathToFileURL } from 'node:url';
let raw='';for await(const b of process.stdin)raw+=b;const input=JSON.parse(raw);
const messages=input.operation==='capture'?(input.messages??[]).flatMap((m,i)=>[{info:{id:m.id,role:m.role,sessionID:input.session_id,time:{created:i*3+1}},parts:[{type:'text',text:m.content}]},...(m.role==='user'?[{info:{id:`${m.id}-ack`,role:'assistant',sessionID:input.session_id,finish:'stop',time:{created:i*3+2,completed:i*3+3}},parts:[{type:'text',text:'Acknowledged.'}]}]:[])]):[];
const client={provider:{list:async()=>({data:{all:[]}})},tui:{showToast:async()=>({})},session:{messages:async()=>({data:messages}),get:async()=>({data:{id:input.session_id}})}};
const { default: loader }=await import(pathToFileURL(`${input.pluginRoot}/loader.mjs`).href);
const plugin=await loader.server({directory:input.cwd,worktree:input.cwd,client});
if(input.operation==='recall'){
 const output={message:{id:'eval-msg'},parts:[{type:'text',text:input.prompt}]};await plugin['chat.message']({sessionID:input.session_id,messageID:'eval-msg'},output);process.stdout.write(JSON.stringify(output));
}else{
 await plugin.event({event:{type:'session.idle',properties:{sessionID:input.session_id}}});
 await plugin.event({event:{type:'session.deleted',properties:{info:{id:input.session_id}}}});
 // The terminal event awaits the plugin's own runExclusive capture barrier.
}
process.exit(0);
