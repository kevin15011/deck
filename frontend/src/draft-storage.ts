// Draft text and recovery identities commit in one localStorage operation.
const tag='deck2-draft-v1:';
function draft(raw:string|null):{text:string;recovered:string[]}{
 if(!raw?.startsWith(tag))return {text:raw||'',recovered:[]};
 const value:unknown=JSON.parse(raw.slice(tag.length));
 if(!value||typeof value!=='object'||!('text' in value)||typeof value.text!=='string'||!('recovered' in value)||!Array.isArray(value.recovered)||value.recovered.some(v=>typeof v!=='string'))throw Error('Saved draft is unreadable. Browser storage preserved.');
 return value as {text:string;recovered:string[]};
}
export function readDraft(storage:Storage,key:string){return draft(storage.getItem(key)).text;}
export function writeDraft(storage:Storage,key:string,text:string){
 const value=draft(storage.getItem(key));
 storage.setItem(key,value.recovered.length?tag+JSON.stringify({...value,text}):text);
}
export function recoverDraft(storage:Storage,key:string,identity:string,prompt:string){
 const value=draft(storage.getItem(key));
 if(value.recovered.includes(identity))return value.text;
 // Preparing input may still be present in the composer when recall commits.
 const text=value.text===prompt?value.text:prompt+(value.text?(prompt?'\n\n':'')+value.text:'');
 storage.setItem(key,tag+JSON.stringify({text,recovered:[...value.recovered,identity]}));
 return text;
}
