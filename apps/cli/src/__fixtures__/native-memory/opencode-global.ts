import "./provider.cjs";
const {default:plugin} = await import(process.argv[2]!);
const messages = [{info:{id:"global-user",sessionID:"global-open",role:"user"},parts:[{type:"text",text:"Account-global continuity uses a shared checklist."}]},{info:{id:"global-assistant",sessionID:"global-open",role:"assistant",finish:"stop"},parts:[{type:"text",text:"I recorded the shared checklist."}]}];
const hooks = await plugin.server({directory:process.argv[3]!,client:{session:{messages:async()=>({data:messages})},tui:{showToast:async()=>{}},app:{log:async()=>{}}}});
await hooks.event({event:{type:"session.idle",properties:{sessionID:"global-open"}}});
await hooks.event({event:{type:"server.instance.disposed",properties:{}}});
console.log("global-events-complete");
