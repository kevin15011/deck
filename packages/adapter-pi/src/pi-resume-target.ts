import {openSync,closeSync,readSync,fstatSync,realpathSync,readdirSync,constants,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
export type PiResumeTarget={sessionId:string,file:string,snapshot:string};
export const PI_EXACT_RESUME_BLOCKED_REASON='Exact resume is unavailable: select a compatible Pi strict-session-v1 runtime.';
/** Trusted composition selects the runtime; unpatched commands fail closed. */
export function supportsExactPiResume(command='pi',env:Readonly<Record<string,string|undefined>>=process.env):boolean {return probeStrictPiCapability(command,env);}
/** Even --help initializes Pi. Probe only in disposable, offline, empty roots. */
export function probeStrictPiCapability(command:string,launchEnv:Readonly<Record<string,string|undefined>>=process.env):boolean {
 const root=mkdtempSync(join(tmpdir(),'deck-pi-capability-'));
 try {
  const home=join(root,'home'),agent=join(root,'agent'),cwd=join(root,'project');
  for(const dir of [home,agent,cwd])mkdirSync(dir);
  const env={PATH:launchEnv.PATH,HOME:home,XDG_CONFIG_HOME:join(root,'config'),XDG_STATE_HOME:join(root,'state'),XDG_CACHE_HOME:join(root,'cache'),PI_CODING_AGENT_DIR:agent,PI_OFFLINE:'1',PI_SKIP_VERSION_CHECK:'1',PI_TELEMETRY:'0'};
  const r=spawnSync(command,['--help','--no-extensions','--no-skills','--no-context-files','--no-prompt-templates'],{cwd,env,encoding:'utf8',timeout:5000,killSignal:'SIGKILL',maxBuffer:256*1024,shell:false});
  return !r.error&&r.status===0&&/\bstrict-session-v1\b/.test(r.stdout);
 }catch{return false;}finally{rmSync(root,{recursive:true,force:true});}
}
export function matchesPiResumeReceipt(target:PiResumeTarget,state:any):boolean {
 const receipt=state?.consumedSessionTarget;
 return state?.sessionId===target.sessionId&&state?.sessionFile===target.file&&receipt&&Object.keys(receipt).length===3&&receipt.sessionId===target.sessionId&&receipt.file===target.file&&receipt.snapshot===target.snapshot;
}
/** Read-only, bounded exact-file validation; never invokes Pi's creating/migrating loader. */
export function validatePiResumeTarget(project:string,target:PiResumeTarget):PiResumeTarget {
 const root=join(project,'.deck/pi/sessions/developer-team');
 if(!target||!/^[a-zA-Z0-9-]{1,128}$/.test(target.sessionId)||typeof target.file!=='string'||realpathSync(project)!==project||realpathSync(root)!==root||resolve(target.file)!==target.file||dirname(target.file)!==root||realpathSync(target.file)!==target.file)throw Error('Invalid confined resume target');
 const matches=readdirSync(root).filter(n=>n.endsWith('_'+target.sessionId+'.jsonl'));
 if(matches.length!==1||join(root,matches[0])!==target.file)throw Error('Missing or ambiguous resume target');
 const fd=openSync(target.file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try {const before=fstatSync(fd);if(!before.isFile()||before.size>8*1024*1024)throw Error('Unsupported resume file');const buffer=Buffer.alloc(before.size+1);let offset=0;while(offset<buffer.length){const n=readSync(fd,buffer,offset,buffer.length-offset,offset);if(!n)break;offset+=n;}const bytes=buffer.subarray(0,offset);const after=fstatSync(fd);if(bytes.length!==before.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error('Resume target changed');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!text.endsWith('\n'))throw Error('Incomplete resume transcript');const lines=text.trimEnd().split('\n');if(lines.length>20000||lines.some(l=>Buffer.byteLength(l)>1024*1024))throw Error('Unsupported resume transcript');const [header,...entries]=lines.map(l=>JSON.parse(l));const ids=new Set<string>();for(const e of entries){if(!e||typeof e.id!=='string'||!e.id||ids.has(e.id)||!(e.parentId===null||typeof e.parentId==='string'&&ids.has(e.parentId)))throw Error('Corrupt resume transcript');ids.add(e.id);}
 if(header.type!=='session'||header.version!==3||header.id!==target.sessionId||header.cwd!==project)throw Error('Resume identity mismatch');
 const snapshot=createHash('sha256').update(bytes).digest('hex');if(target.snapshot&&target.snapshot!==snapshot)throw Error('Resume target changed');return {...target,snapshot};
 }finally{closeSync(fd);}
}
