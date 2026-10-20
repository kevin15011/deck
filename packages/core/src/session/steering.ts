/** Text-only exact-turn delivery. Acceptance never means model consumption. */
import { revision } from './decisions';
export const CODEX_STEERING_CAPABILITY = 'turn-steer-text-0.162.1';
export const CLAUDE_STEERING_CAPABILITY = 'fold-text-no-query-2.1.296';
export type SteeringTarget = { nativeThreadId: string; nativeTurnId: string };
export type SteeringInput = SteeringTarget & { clientUserMessageId: string; text: string };
export type SteeringOutcome =
 | ({ state: 'accepted'; via: 'receipt' | 'history' } & SteeringInput)
 | { state: 'not-accepted'; reason: 'no-active-turn' | 'turn-mismatch' }
 | { state: 'unknown'; reason: string };
export const matchesSteering = (a: SteeringInput, b: SteeringInput) => a.nativeThreadId === b.nativeThreadId && a.nativeTurnId === b.nativeTurnId && a.clientUserMessageId === b.clientUserMessageId && a.text === b.text;
export type SteeringFence = SteeringInput & { promptId: string; taskId: string; attempt: number; runnerId?: 'codex' | 'claude'; targetQuestionRevision?: number };
const str = {type:'string',minLength:1,maxLength:128};
const positive = {type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER};
export const STEERING_FENCE_SCHEMA = {type:'object',required:['promptId','taskId','attempt','nativeThreadId','nativeTurnId','clientUserMessageId','text'],properties:{promptId:str,taskId:str,attempt:positive,runnerId:{enum:['codex','claude']},nativeThreadId:str,nativeTurnId:str,clientUserMessageId:str,text:{type:'string',minLength:1,maxLength:263168},targetQuestionRevision:positive}};
// Only the host's still-held barrier may grant queue fallback. Absence is no permission.
export const STEERING_RESULT_SCHEMA = {type:'object',required:['promptId','steeringSeq','state','eligible','stale'],properties:{promptId:str,steeringSeq:positive,state:{enum:['accepted','not-accepted','unknown']},eligible:{type:'boolean'},stale:{type:'boolean'},via:{enum:['receipt','history']},reason:{type:'string',maxLength:128},queueFallback:{type:'boolean'}},allOf:[{if:{properties:{state:{const:'accepted'}},required:['state']},then:{required:['via']}},{if:{properties:{state:{enum:['unknown','not-accepted']}},required:['state']},then:{properties:{eligible:{const:false}}}},{if:{properties:{stale:{const:true}},required:['stale']},then:{properties:{eligible:{const:false}}}},{if:{properties:{queueFallback:{const:true}},required:['queueFallback']},then:{properties:{state:{const:'not-accepted'}}}}]};
// Native IDs are opaque; unlike user-facing notes, their schema only bounds length.
const id = (v:unknown) => typeof v==='string' && v.length>0 && v.length<=128;
export function validSteeringFence(d:Record<string,unknown>):boolean{return ['promptId','taskId','nativeThreadId','nativeTurnId','clientUserMessageId'].every(k=>id(d[k]))&&revision(d.attempt)&&typeof d.text==='string'&&d.text.length>0&&d.text.length<=263168&&(d.runnerId===undefined||d.runnerId==='codex'||d.runnerId==='claude')&&(d.targetQuestionRevision===undefined||revision(d.targetQuestionRevision));}
export function validSteeringResult(d:Record<string,unknown>):boolean{return id(d.promptId)&&revision(d.steeringSeq)&&['accepted','not-accepted','unknown'].includes(String(d.state))&&typeof d.eligible==='boolean'&&typeof d.stale==='boolean'&&(d.state==='accepted'||d.eligible===false)&&(!d.stale||d.eligible===false)&&(d.state!=='accepted'||['receipt','history'].includes(String(d.via)))&&(d.via===undefined||['receipt','history'].includes(String(d.via)))&&(d.reason===undefined||typeof d.reason==='string'&&d.reason.length<=128)&&(d.queueFallback===undefined||typeof d.queueFallback==='boolean')&&(d.queueFallback!==true||d.state==='not-accepted');}
