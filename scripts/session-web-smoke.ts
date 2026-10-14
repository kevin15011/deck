/** No browser dependencies. Copy with fixtures/fake-claude.mjs; pass --deck /absolute/binary. */
import {chmodSync,copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,resolve} from 'node:path';
const deck=process.argv[process.argv.indexOf('--deck')+1];if(!deck||!deck.startsWith('/'))throw new Error('--deck requires absolute compiled binary');
const base=realpathSync(mkdtempSync(join(realpathSync(tmpdir()),'deck-web-bin-'))),home=join(base,'home'),bin=join(base,'bin'),project=join(base,'project');for(const p of[home,bin,project])mkdirSync(p,{recursive:true});
const artifactDir=join(project,'openspec/changes/web-check');mkdirSync(artifactDir,{recursive:true});writeFileSync(join(artifactDir,'proposal.md'),'# Compiled artifact\n\n- [x] Read-only workspace\n');
const archiveDir=join(project,'openspec/changes/archive/old-check');mkdirSync(archiveDir,{recursive:true});writeFileSync(join(archiveDir,'proposal.md'),'Archived');
writeFileSync(join(project,'private.txt'),'Not a browser artifact');
copyFileSync(process.env.DECK_TEST_CLAUDE_FIXTURE??resolve(import.meta.dir,'fixtures/fake-claude.mjs'),join(base,'fake-claude.mjs'));
writeFileSync(join(bin,'claude'),`#!/bin/sh\nexec "${process.execPath}" "${join(base,'fake-claude.mjs')}" "$@"\n`);chmodSync(join(bin,'claude'),0o755);
const env={HOME:home,XDG_CONFIG_HOME:join(home,'.config'),XDG_STATE_HOME:join(home,'.local/state'),XDG_DATA_HOME:join(home,'.local/share'),TMPDIR:base,PATH:`${bin}:/usr/bin:/bin`,FAKE_CLAUDE_APPROVAL:'1',DECK_SESSION_DAEMON_IDLE_MS:'600000'};
const owned=new Set<Bun.Subprocess>();
const spawn=(args:string[],stdin:'ignore'|'pipe'='ignore')=>{const p=Bun.spawn([deck,...args],{cwd:project,env,stdin,stdout:'pipe',stderr:'pipe'});owned.add(p);void p.exited.then(()=>owned.delete(p));return p};
const run=async(args:string[])=>{const p=spawn(args);const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);if(code!==0)throw new Error(`${args.join(' ')}: ${err||out}`);return out};
const until=async(fn:()=>boolean)=>{const deadline=Date.now()+30000;while(!fn()){if(Date.now()>deadline)throw new Error('Timed out waiting for daemon/session');await Bun.sleep(50)}};

try{
 const portProbe=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response('probe')}),webPort=portProbe.port;portProbe.stop(true);
 await run(['session','ack-claude-tos','--yes']);const configPath=join(env.XDG_CONFIG_HOME,'deck/config.json'),config=JSON.parse(readFileSync(configPath,'utf8'));config.crossRunner={...config.crossRunner,enabled:true,members:{lead:{runnerId:'claude',modelId:'haiku'}},web:{...config.crossRunner?.web,port:webPort}};writeFileSync(configPath,JSON.stringify(config));
 const daemon=spawn(['internal','session-daemon']);const daemonOutput=Promise.all([new Response(daemon.stdout).text(),new Response(daemon.stderr).text()]);await until(()=>existsSync(join(env.XDG_STATE_HOME,'deck/daemon/daemon.json')));
 const cross=spawn(['cross','developer'],'pipe');let text='';void(async()=>{for await(const c of cross.stdout)text+=new TextDecoder().decode(c)})();void new Response(cross.stderr).text();await until(()=>text.includes('Attached to'));cross.stdin!.write('/detach\n');cross.stdin!.end();await cross.exited;
 const pair=JSON.parse(await run(['session','web','pair','--json']));const pairData=pair.data??pair;
 const url=new URL('/',pairData.url).href,checks:string[]=[];
 const check=(name:string,ok:boolean)=>{if(!ok)throw new Error(name);checks.push(name)};
 const self=JSON.parse(await run(['session','self-test','--json']));check('embedded asset digest',self.ok&&self.checks.some((c:any)=>c.id==='web-assets-digest'&&c.ok));
 const index=await fetch(url);check('embedded HTML and strict CSP',index.ok&&(index.headers.get('content-security-policy')??'').includes("script-src 'self'")&&(await index.text()).includes('/app.js'));
 for(const path of ['app.js','app.css'])check(`embedded ${path}`,(await fetch(new URL(path,url))).ok);
 check('unpaired API401',(await fetch(new URL('api/sessions',url))).status===401);
 check('foreign Host403',(await fetch(url,{headers:{Host:'foreign.invalid'}})).status===403);
 const paired=await fetch(new URL('api/local-access',url),{method:'POST',headers:{Origin:new URL(url).origin,'Content-Type':'application/json'},body:'{}'});check('automatic local access',paired.ok);
 const cookie=paired.headers.get('set-cookie')!.split(';')[0]!,headers={Origin:new URL(url).origin,'Content-Type':'application/json',Cookie:cookie};
 const list=await(await fetch(new URL('api/sessions',url),{headers})).json(),id=list.data.sessions[0].sessionId;
 const artifactBase=new URL(`api/sessions/${id}/openspec`,url);
 check('unpaired artifacts401',(await fetch(artifactBase)).status===401);
 const catalogResponse=await fetch(artifactBase,{headers}),catalog=await catalogResponse.json();
 check('session-scoped active artifact catalog',catalogResponse.ok&&catalog.ok&&catalog.data.changes.length===1&&catalog.data.changes[0].changeId==='web-check'&&catalog.data.changes[0].artifacts[0].path==='proposal.md');
 const artifactURL=new URL(`${artifactBase.pathname}/artifact`,url);artifactURL.searchParams.set('changeId','web-check');artifactURL.searchParams.set('path','proposal.md');
 const artifactResponse=await fetch(artifactURL,{headers}),artifact=await artifactResponse.json();
 check('compiled artifact Markdown read',artifactResponse.ok&&artifact.data.markdown.includes('# Compiled artifact')&&typeof artifact.data.updatedAt==='string');
 writeFileSync(join(artifactDir,'proposal.md'),'# Updated compiled artifact\n');
 check('artifact reflects disk update',(await(await fetch(artifactURL,{headers})).json()).data.markdown==='# Updated compiled artifact\n');
 artifactURL.searchParams.set('path','../../../private.txt');
 check('artifact traversal rejected',!(await fetch(artifactURL,{headers})).ok);
 const command=async(body:Record<string,unknown>)=>{const r=await fetch(new URL('api/commands',url),{method:'POST',headers,body:JSON.stringify({sessionId:id,command:{v:1,commandId:crypto.randomUUID(),...body}})});const value=await r.json();check(String(body.type),r.ok&&value.ok)};
 await command({type:'prompt.send',text:'Compiled HTTP approval check'});
 let events:any[]=[],after=0;const replay=async()=>{let more=true;while(more){const d=await(await fetch(new URL(`api/sessions/${id}/events?after=${after}`,url),{headers})).json();events.push(...d.events);after=d.seq;more=d.hasMore;}};
 const deadline=Date.now()+30000;while(!events.some(e=>e.kind==='approval.requested')){if(Date.now()>deadline)throw new Error('approval timeout');await replay();await Bun.sleep(25)}
 const approval=events.find(e=>e.kind==='approval.requested');await command({type:'approval.respond',approvalId:approval.data.approvalId,decision:'allow-once'});
 while(!events.some(e=>e.kind==='turn.completed')){if(Date.now()>deadline)throw new Error('completion timeout');await replay();await Bun.sleep(25)}
 check('real bridge approval and completed native turn',events.some(e=>e.kind==='approval.resolved')&&events.some(e=>e.kind==='message.completed'&&e.data.text==='echo: Compiled HTTP approval check'));
 check('cursor replay empty after catchup',(await(await fetch(new URL(`api/sessions/${id}/events?after=${after}`,url),{headers})).json()).events.length===0);
 console.log(JSON.stringify({ok:true,checks}));
 daemon.kill('SIGTERM');await daemon.exited;await daemonOutput;
}finally{for(const p of owned)if(p.exitCode===null)p.kill('SIGTERM');await Promise.all([...owned].map(p=>p.exited));rmSync(base,{recursive:true,force:true})}
