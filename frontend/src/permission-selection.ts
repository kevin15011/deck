import type {DecisionResponse,Resolve} from './api';
import type {PermissionPolicy} from './presentation';
export const scopeBinding=(id:string,revision:number,policy:PermissionPolicy|null|undefined)=>JSON.stringify([id,revision,policy]);
export function selectedScope(policy:PermissionPolicy|null|undefined,binding:string,selection:{binding:string;id:string}|null){
 if(selection?.binding===binding)return policy?.options.find(o=>o.id===selection.id);
 // Host orders offers narrow to broad, so the default is the broadest non-exact.
 return policy?.options.filter(o=>o.kind!=='exact').at(-1)??policy?.options[0];
}
export function sameConsent(a:Resolve,b:Resolve){
 return a.expected_revision===b.expected_revision&&a.scope_option_id===b.scope_option_id&&JSON.stringify(a.response)===JSON.stringify(b.response);
}
// Only the opaque offered ID crosses the boundary; no browser-authored bounds.
export function consentRequest(api:number,command_id:string,expected_revision:number,response:DecisionResponse,scope_option_id?:string):Resolve {
 return {api,command_id,expected_revision,response,...(response.type==='allow_session'&&scope_option_id?{scope_option_id}:{})};
}
export function retainConsent(stored:Resolve,proposed:Resolve):Resolve {
 if(!sameConsent(stored,proposed))throw Error('A response identity is retained. Reconnect to inspect its result before changing that response.');
 return stored;
}
