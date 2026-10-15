// Bounded opt-in dialog transport; no dependency on any client application.
export type Dialog = {id:string;method:string;title:string;message?:string;options?:string[];placeholder?:string;prefill?:string;expiresAt:number};
export function parseDialog(v:any, now=Date.now()):Dialog {
 if(!v||typeof v.id!=='string'||!v.id||v.id.length>128||!['select','confirm','input','editor'].includes(v.method)||typeof v.title!=='string'||JSON.stringify(v).length>16000)throw Error('Invalid or oversized runtime question');
 for(const k of ['message','placeholder','prefill'])if(v[k]!==undefined&&typeof v[k]!=='string')throw Error('Invalid question text');
 if(v.method==='select'&&(!Array.isArray(v.options)||!v.options.length||v.options.length>64||v.options.some((x:any)=>typeof x!=='string')))throw Error('Invalid options');
 if(v.timeout!==undefined&&(!Number.isFinite(v.timeout)||v.timeout<=0))throw Error('Expired or invalid timeout');
 return {id:v.id,method:v.method,title:v.title,...(v.message!==undefined?{message:v.message}:{}),...(v.options?{options:v.options}:{}),...(v.placeholder!==undefined?{placeholder:v.placeholder}:{}),...(v.prefill!==undefined?{prefill:v.prefill}:{}),expiresAt:now+Math.min(v.timeout??120000,120000)};
}
export function dialogResponse(p:Dialog|undefined,v:any,now=Date.now()) {
 if(!p||now>=p.expiresAt||v.id!==p.id||v.method!==p.method)throw Error('Stale or mismatched runtime response');
 const field=v.cancelled===true?'cancelled':p.method==='confirm'?'confirmed':'value';
 if(Object.keys(v).some(k=>!['type','id','method',field].includes(k))||v.type!=='extension_ui_response')throw Error('Invalid response fields');
 if(field==='confirmed'&&typeof v.confirmed!=='boolean')throw Error('Confirmation required');
 if(field==='value'&&(typeof v.value!=='string'||v.value.length>12000||v.value.includes('\0')||(p.method==='select'&&!p.options!.includes(v.value))))throw Error('Invalid response value');
 return {type:'extension_ui_response',id:p.id,[field]:v[field]};
}
