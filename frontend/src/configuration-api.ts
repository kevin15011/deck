import {API,sessionContract,type SessionContract,type Provenance} from './api';
export interface HelperSelection {version:string;executable:string;catalog:string}
export interface Assignment {runner:string;model:string;executable:string;content:string}
export interface RunnerBinding {path:string;executable:string;ownership:string;model:string|null;qualification:string;catalog:string|null}
export interface Snapshot {native?:{runner:string;protocol:string;version:string;executable:RunnerBinding;storage:string;configuration:string;role:string};project?:{id:string;root:string;identity:string|null};session_contract?:SessionContract;selection?:{session:string;revision:number}|null;runner?:RunnerBinding|null;helper?:HelperSelection|null;revision:number;codex_executable:string|null;definitions:string[];investigator:Assignment|null;exclusions:string[];delivery_observed:boolean}
export interface Definition {digest:string;name:string;body?:string;kind:string;source:string;owner:string;roles:string[];modes:string[];required_resources:string[]}
export interface Configuration {runner?:RunnerBinding|null;helper?:HelperSelection|null;revision:number;host_id:string;project:string;team_enabled:boolean;investigator:Assignment|null;codex_executable:string|null;definitions:string[]}
export interface Plan {helper?:HelperSelection|null;artifact_store?:string|null;id:string;before:Configuration;team_enabled:boolean;qualification:string|null;trusted:boolean}
export interface Operation {id:string;plan:string;allow:boolean;phase:'accepted'|'downloading'|'validating'|'published_not_selected'|'recovery_required'|'applied'|'denied'|'cancelled'|'stale'|'failed';revision:number;published?:boolean;cancel_requested?:boolean;detail?:string}
export interface Inspection {api:number;selected:Configuration;definitions:Definition[];observed:{assignment:Assignment;preparation_ms:number;tool_connection_ms:number;provenance:Provenance}|null;unavailable:string|null;limitations:string[]}
const object=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(i=>typeof i==='string');
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=1;
const nullable=(v:unknown)=>v===null||typeof v==='string';
const runner=(v:unknown)=>v===undefined||v===null||(object(v)&&['path','executable','ownership','qualification'].every(k=>typeof v[k]==='string')&&nullable(v.model)&&nullable(v.catalog));
const helper=(v:unknown)=>v===undefined||v===null||(object(v)&&['0.50.0','1.2.0'].includes(v.version as string)&&['executable','catalog'].every(k=>typeof v[k]==='string'&&/^[a-f0-9]{64}$/.test(v[k] as string)));
const assignment=(v:unknown)=>v===null||(object(v)&&['runner','model','executable','content'].every(k=>typeof v[k]==='string'));
export function snapshot(v:unknown):Snapshot|null {
 if(object(v)&&v.project!==undefined&&(!object(v.project)||typeof v.project.id!=='string'||typeof v.project.root!=='string'||!(v.project.identity===null||typeof v.project.identity==='string')))throw Error('Invalid admission project');
 if(v===undefined||v===null)return null;
 if(!object(v)||(v.selection!==undefined&&v.selection!==null&&(!object(v.selection)||typeof v.selection.session!=='string'||!integer(v.selection.revision)))||!runner(v.runner)||!helper(v.helper)||!integer(v.revision)||!strings(v.definitions)||!v.definitions.every(d=>/^[a-f0-9]{64}$/.test(d))||!strings(v.exclusions)||!assignment(v.investigator)||!nullable(v.codex_executable)||typeof v.delivery_observed!=='boolean')throw new Error('Invalid admission snapshot');
 if(v.native!==undefined&&(!object(v.native)||!['codex','opencode'].includes(v.native.runner as string)||!['protocol','version','storage','configuration','role'].every(k=>typeof (v.native as Record<string,unknown>)[k]==='string')||!runner(v.native.executable)))throw Error('Invalid native admission');
 sessionContract(v.session_contract);
 return v as unknown as Snapshot;
}
export function configuration(v:unknown):Configuration {
 if(!object(v)||!runner(v.runner)||!helper(v.helper)||!integer(v.revision)||typeof v.host_id!=='string'||typeof v.project!=='string'||typeof v.team_enabled!=='boolean'||!assignment(v.investigator)||!nullable(v.codex_executable)||!strings(v.definitions))throw new Error('Invalid configuration; refresh before reviewing');
 return v as unknown as Configuration;
}
export function definition(v:unknown,body=false):Definition {
 if(!object(v)||!['digest','name','kind','source','owner'].every(k=>typeof v[k]==='string')||!/^[a-f0-9]{64}$/.test(v.digest as string)||!['roles','modes','required_resources'].every(k=>strings(v[k]))||(body&&typeof v.body!=='string'))throw new Error('Invalid recorded content');
 return v as unknown as Definition;
}
export function inspection(v:unknown):Inspection {
 if(!object(v)||v.api!==API||!Array.isArray(v.definitions)||!strings(v.limitations)||!nullable(v.unavailable))throw new Error('Incompatible configuration inspector');
 const selected=configuration(v.selected),definitions=v.definitions.map(d=>definition(d));
 if(definitions.length!==selected.definitions.length||new Set(definitions.map(d=>d.digest)).size!==definitions.length||definitions.some(d=>!selected.definitions.includes(d.digest)))throw new Error('Configuration content identity mismatch');
 if(v.observed!==null&&(!object(v.observed)||!assignment(v.observed.assignment)||v.observed.assignment===null||typeof v.observed.preparation_ms!=='number'||typeof v.observed.tool_connection_ms!=='number'||!object(v.observed.provenance)||!['runner','integration','executable','storage','content'].every(k=>typeof (v.observed as {provenance:Record<string,unknown>}).provenance[k]==='string')))throw new Error('Invalid preparation evidence');
 return {...v,selected,definitions} as unknown as Inspection;
}
export function plan(v:unknown):Plan {
 if(!object(v)||!runner(v.runner)||!helper(v.helper)||(v.helper!=null&&typeof v.artifact_store!=='string')||typeof v.id!=='string'||typeof v.team_enabled!=='boolean'||typeof v.trusted!=='boolean'||!nullable(v.qualification))throw new Error('Invalid reviewed plan');
 return {...v,before:configuration(v.before)} as unknown as Plan;
}
export function operation(v:unknown):Operation {
 if(!object(v)||typeof v.id!=='string'||typeof v.plan!=='string'||typeof v.allow!=='boolean'||!['accepted','downloading','validating','published_not_selected','recovery_required','applied','denied','cancelled','stale','failed'].includes(v.phase as string)||!integer(v.revision))throw new Error('Invalid management receipt');return v as unknown as Operation;
}
export async function exactDefinition(v:unknown,id:string):Promise<Definition>{
 const d=definition(v,true);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(d.body)))).map(b=>b.toString(16).padStart(2,'0')).join('');
 if(d.digest!==id||hash!==id)throw new Error('Recorded content digest mismatch; content hidden');return d;
}

export const terminalOperation=(o:Operation)=>['applied','denied','cancelled','stale','failed'].includes(o.phase);
export interface HelperRelease {selection:HelperSelection;url:string;archive_bytes:number;archive_sha256:string;executable_bytes:number;notices:{member:string;origin:string;url:string;sha256:string;body:string}[]}
export interface HelperCatalog {api:number;store:string;catalog:string;releases:{installed:boolean;issue?:string|null;release:HelperRelease}[]}
export function helperCatalog(v:unknown):HelperCatalog {
 if(!object(v)||v.api!==API||typeof v.store!=='string'||typeof v.catalog!=='string'||!Array.isArray(v.releases)||v.releases.length!==2)throw Error('Invalid helper catalog');
 for(const row of v.releases){if(!object(row)||typeof row.installed!=='boolean'||!object(row.release)||!object(row.release.selection)||!['version','executable','catalog'].every(k=>typeof (row.release as {selection:Record<string,unknown>}).selection[k]==='string')||!Array.isArray(row.release.notices)||!row.release.notices.every(n=>object(n)&&['member','origin','url','sha256','body'].every(k=>typeof n[k]==='string')))throw Error('Invalid reviewed helper artifact');}
 return v as unknown as HelperCatalog;
}
