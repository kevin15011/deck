import {API,sessionContract,type MemberAssignment,type Session} from './api';
export interface TransitionCommand {api:number;expected_source_digest:string;session:{api:number;id:string;title:string;project_id:string;members:Record<string,MemberAssignment>;approvals:'relay'}}
export function transitionPreview(v:unknown,source:string):string {
 const p=v as Record<string,unknown>;
 if(!p||p.api!==API||p.source_session!==source||typeof p.source_digest!=='string'||!/^[a-f0-9]{64}$/.test(p.source_digest)||p.approvals!=='relay'||p.native_context_copied!==false)throw Error('Invalid historical transition preview. Reload before continuing.');
 return p.source_digest;
}
export function transitionCommand(v:unknown,source:Session):TransitionCommand {
 const p=v as TransitionCommand;
 if(!p||p.api!==API||!p.session||p.session.api!==API||!p.session.id||p.session.id===source.id||p.session.project_id!==source.project?.id||p.session.approvals!=='relay'||typeof p.session.title!=='string'||!p.session.title.trim()||typeof p.expected_source_digest!=='string'||!/^[a-f0-9]{64}$/.test(p.expected_source_digest)||!p.session.members?.lead)throw Error('Retained transition is invalid. Keep this history open and inspect the target before retrying.');
 for(const a of Object.values(p.session.members))if(!a||typeof a.runnerId!=='string'||!a.runnerId||typeof a.modelId!=='string'||!a.modelId||a.thinking!==undefined&&typeof a.thinking!=='string')throw Error('Invalid retained transition assignment');
 return p;
}
export function transitionedSession(v:unknown,command:TransitionCommand):Session {
 const s=v as Session,c=sessionContract(s?.contract);
 if(!s||s.id!==command.session.id||s.project?.id!==command.session.project_id||!c||c.approvals!=='relay'||Object.entries(command.session.members).some(([role,a])=>{const actual=c.members[role];return !actual||actual.runnerId!==a.runnerId||actual.modelId!==a.modelId||actual.thinking!==a.thinking;}))throw Error('Transition acknowledgment differs from the requested session. Retry the retained transition to inspect its result.');
 return s;
}
