/** Host-wide dictation contract. Browser input never contains paths or download URLs. */
export const DICTATION_MODEL_IDS = ['large-v3-turbo-q5_0'] as const;
export type DictationModelId = typeof DICTATION_MODEL_IDS[number];
export type DictationLanguage = 'es'|'en'|'auto';
export const isDictationModelId = (v: unknown): v is DictationModelId => typeof v==='string' && (DICTATION_MODEL_IDS as readonly string[]).includes(v);
export type DictationModel = {id:DictationModelId;label:string;bytes:number;state:'absent'|'downloading'|'verifying'|'installed'|'corrupt'|'failed';received?:number;error?:string};
export type DictationSummary = {available:boolean;runtime:{state:'ready'|'missing';path?:string};models:DictationModel[];selected:DictationModelId|null;language:DictationLanguage;active:boolean;lastRun?:{modelId:DictationModelId;audioMs:number;elapsedMs:number}};
export type DictationResult = {ok:true;text:string;modelId:DictationModelId;audioMs:number;elapsedMs:number};
export const DICTATION_LIMITS = {maxAudioMs:300_000,maxBytes:10*1024*1024,minAudioMs:300} as const;
