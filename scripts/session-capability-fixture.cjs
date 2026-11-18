// Isolated source-oracle fixture; never installs or modifies native user files.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync,spawn}=require('node:child_process');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
function fixture(root,cbm,rtk){
 const repo=path.resolve(__dirname,'..'),project=path.join(root,'project'),native=path.join(root,'native'),cache=path.join(root,'cache');
 for(const p of [project,native,cache,path.join(project,'.deck'),path.join(native,'agents'),path.join(native,'deck/hooks'),path.join(root,'.agents/skills/deck-lead')])fs.mkdirSync(p,{recursive:true,mode:0o700});
 fs.writeFileSync(path.join(project,'handler.py'),'def cedar_handler(value):\n    """Isolated graph fixture CEDAR-9843."""\n    return value + 73\n\ndef cedar_caller():\n    return cedar_handler(1)\n');
 fs.writeFileSync(path.join(project,'.deck/config.json'),JSON.stringify({capabilities:{'codebase-memory':{enabled:true}}}));
 const canonical=path.resolve(process.env.DECK1_ROOT||path.join(repo,'../deck'),'packages/core/src/owned-tools/rtk-hook.ts');
 const generated=spawnSync('bun',['-e',`import {rtkHookScript} from ${JSON.stringify(canonical)}; process.stdout.write(rtkHookScript(process.argv[1], 'codex'));`,rtk],{encoding:'utf8'});if(generated.status!==0)throw Error('Canonical hook generation failed');
 const script=path.join(native,'deck/hooks/deck-rtk-hook.cjs');fs.writeFileSync(script,generated.stdout);
 const command=quote(process.execPath)+' '+quote(script);
 const block='# deck-codex-hook:rtk:start\n[[hooks.PreToolUse]]\nmatcher = "^Bash$"\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = '+JSON.stringify(command)+'\ntimeout = 10\n# deck-codex-hook:rtk:end';
 const config='# deck-codex-mcp:codebase-memory\n[mcp_servers.codebase-memory]\ncommand = '+JSON.stringify(cbm)+'\n[mcp_servers.codebase-memory.env]\nCBM_CACHE_DIR = '+JSON.stringify(cache)+'\n\n'+block+'\n';
 fs.writeFileSync(path.join(native,'config.toml'),config);
 const bodies=JSON.parse(fs.readFileSync(path.join(repo,'crates/host/assets/session-roles.json'))),files={'.codex/deck/hooks/deck-rtk-hook.cjs':hash(generated.stdout)},contributions=[];
 const lead=bodies.lead.agentBody+'\n\n'+bodies.lead.skillBody;fs.writeFileSync(path.join(native,'deck/role-selection.txt'),lead);files['.codex/deck/role-selection.txt']=hash(lead);
 for(const member of ['lead','investigate','apply-deep'])fs.writeFileSync(path.join(native,'agents/deck-'+member+'.toml'),'name='+JSON.stringify('deck-'+member)+'\ndeveloper_instructions='+JSON.stringify(bodies[member].agentBody+'\n\n'+bodies[member].skillBody)+'\nsandbox_mode="read-only"\n');
 const skill=path.join(root,'.agents/skills/deck-lead/SKILL.md');fs.writeFileSync(skill,bodies.lead.skillBody);contributions.push({path:skill,selector:{kind:'file'}});
 const selector={end:'# deck-codex-hook:rtk:end',kind:'text',start:'# deck-codex-hook:rtk:start'};
 contributions.push({path:path.join(native,'config.toml'),selector,id:hash(path.join(native,'config.toml')+'\0'+JSON.stringify(selector)),hash:hash(block)});
 fs.writeFileSync(path.join(native,'deck/manifest.json'),JSON.stringify({version:1,files,contributions}));
 fs.writeFileSync(path.join(root,'native-config.json'),JSON.stringify({'codebase-memory':{command:cbm,env:{CBM_CACHE_DIR:cache}}}));
 fs.writeFileSync(path.join(root,'hook-inventory.json'),JSON.stringify([{key:'fixture-rtk',source:'user',handlerType:'command',async:false,eventName:'preToolUse',command,currentHash:'fixture-receipt-hash'}]));
 return {root,project,native,cache,command,script};
}
async function seed(f,cbm,projectName='capability-fixture'){
 const runtime=fs.mkdtempSync('/tmp/d2-seed-'),child=spawn(cbm,[],{cwd:f.project,env:{...process.env,HOME:f.root,XDG_CONFIG_HOME:path.join(f.root,'config'),XDG_DATA_HOME:path.join(f.root,'data'),XDG_CACHE_HOME:path.join(f.root,'cache-home'),CBM_CACHE_DIR:f.cache,CBM_RUNTIME_DIR:runtime},stdio:['pipe','pipe','ignore']});
 let next=0,buffer='',pending=new Map();child.stdout.on('data',chunk=>{buffer+=chunk;for(let n;(n=buffer.indexOf('\n'))>=0;){const message=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);if(pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id);}}});
 const rpc=async(method,params)=>{const id=++next;const response=new Promise(resolve=>pending.set(id,resolve));child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');const result=await Promise.race([response,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('CBM fixture deadline')),60000);t.unref();})]);if(result.error)throw Error('CBM fixture RPC error');return result.result;};
 try{await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'deck-fixture',version:'1'}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');const indexed=await rpc('tools/call',{name:'index_repository',arguments:{repo_path:f.project,name:projectName,mode:'fast',async:false}});if(indexed.isError)throw Error(JSON.stringify(indexed));const queried=await rpc('tools/call',{name:'search_graph',arguments:{project:projectName,name_pattern:'cedar_handler'}});if(queried.isError||!JSON.stringify(queried).includes('cedar_handler'))throw Error('Fixture graph oracle failed');return queried;}
 finally{child.stdin.end();await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,2000))]);if(child.exitCode===null)child.kill('SIGKILL');fs.rmSync(runtime,{recursive:true,force:true});}
}
module.exports={fixture,seed,hash};
