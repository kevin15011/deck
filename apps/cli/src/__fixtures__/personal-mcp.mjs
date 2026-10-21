// Isolated local MCP fixture; only presence checks are written, never credential values.
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
for await (const line of createInterface({input:process.stdin})) {
 let m;try{m=JSON.parse(line);}catch{continue;}if(m.id===undefined)continue;
 let result={};
 if(m.method==='initialize') result={protocolVersion:m.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'personal-fixture',version:'1'}};
 if(m.method==='tools/list') {
  if(process.env.MARKER_FILE)writeFileSync(process.env.MARKER_FILE,JSON.stringify({env:process.env.PERSONAL_LITERAL==='FAKE_SECRET_SENTINEL',forwarded:process.env.FORWARDED_VALUE==='FAKE_FORWARDED',cwd:process.cwd(),arg:process.argv.includes('FAKE_ARG_SENTINEL')}));
  result={tools:[{name:'lookup',description:'fixture read',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}},{name:'mutate',description:'fixture write',inputSchema:{type:'object',properties:{}}}]};
 }
 if(m.method==='tools/call')result={content:[{type:'text',text:'fixture result'}]};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n');
}
