import {redactText} from './redaction';
export interface Step {seq:number;command:string;task:string;attempt:string;item:string;kind:string;server:string;tool:string;args:string;owner:string;runner:string;startedMs:number;durationMs:number|null;status:'running'|'done'|'failed'|'cancelled'|'uncertain'}
export interface ActivityPage {session:string;steps:Step[];live:Step[];older:boolean;newer:boolean}
/** Shell tokenization only. Retain original spelling for display redaction. */
function words(command:string){
 const result:{value:string;raw:string}[]=[];
 let value='',quote='',escape=false,start=-1;
 for(let i=0;i<command.length;i++){
  const c=command[i]!;
  if(!escape&&!quote&&/\s/.test(c)){
   if(start>=0){result.push({value,raw:command.slice(start,i)});value='';start=-1;}
   continue;
  }
  if(start<0)start=i;
  if(escape){value+=c;escape=false;continue;}
  if(c==='\\'&&quote!=="'"){escape=true;continue;}
  if(quote){if(c===quote)quote='';else value+=c;continue;}
  if(c==='"'||c==="'")quote=c;else value+=c;
 }
 if(start>=0)result.push({value,raw:command.slice(start)});
 return result;
}

function redactShellWord({value,raw}:ReturnType<typeof words>[number]){
 // A whole quoted word (or an escaped space) can hide an assignment boundary.
 // Quote the decoded value during redaction so the entire argument is removed.
 const assignment=value.match(/^([\w.-]+=)([\s\S]*)$/);
 if(assignment&&value!==raw){
  const quoted=assignment[1]+JSON.stringify(assignment[2]);
  const safe=redactText(quoted,65536);
  if(safe!==quoted)return safe;
 }
 return raw;
}
export function stepLabel(step:Pick<Step,'kind'|'server'|'tool'|'args'>):{label:string;summary:string;mark:string}{
 const summary=redactText(step.args,180).replace(/\s+/g,' ');
 if(step.kind==='mcpToolCall'){
  const name=step.server.toLowerCase();const provider=/(?:^|[-_])codebase[-_]memory(?:$|[-_])/.test(name)?'codebase-memory':/(?:^|[-_])context7(?:$|[-_])/.test(name)?'context7':redactText(step.server,64)||'MCP';
  return {label:provider+' · '+redactText(step.tool,128),summary,mark:provider==='codebase-memory'?'⌘':provider==='context7'?'▤':'◇'};
 }
 if(step.kind==='commandExecution'){
  let tokens=words(step.args);if(/^(?:.*\/)?(?:bash|sh|zsh)$/.test(tokens[0]?.value??'')){const flag=tokens.findIndex(s=>/^-[a-z]*c[a-z]*$/.test(s.value));if(flag>=0)tokens=words(tokens[flag+1]?.value??'');}
  while(tokens[0]?.value==='env'||/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0]?.value??''))tokens.shift();
  if(/^(?:.*\/)?rtk$/.test(tokens[0]?.value??''))return {label:'rtk',summary:redactText(tokens.slice(1).map(redactShellWord).join(' '),180),mark:'›'};
  return {label:'shell',summary,mark:'›'};
 }
 if(step.kind==='fileChange')return {label:redactText(step.tool,128)||'edit',summary,mark:'✎'};
 if(step.kind==='reasoning')return {label:'Thinking…',summary:'',mark:'·'};
 return {label:step.kind==='webSearch'?'web search':redactText(step.tool,128)||'tool',summary,mark:'◇'};
}
export function activityPage(value:unknown,session:string):ActivityPage{
 const v=value as ActivityPage;
 const valid=(s:Step)=>s&&Number.isSafeInteger(s.seq)&&s.seq>0&&['command','task','attempt','item','kind','server','tool','args','owner','runner'].every(k=>typeof s[k as keyof Step]==='string')&&['running','done','failed','cancelled','uncertain'].includes(s.status)&&Number.isSafeInteger(s.startedMs)&&(s.durationMs===null||Number.isSafeInteger(s.durationMs)&&s.durationMs>=0);
 if(!v||v.session!==session||typeof v.older!=='boolean'||typeof v.newer!=='boolean'||!Array.isArray(v.steps)||v.steps.length>200||!Array.isArray(v.live)||v.live.length>32||!v.steps.every(valid)||!v.live.every(valid)||v.steps.some((s,i)=>i>0&&v.steps[i-1]!.seq>=s.seq))throw Error('Activity identity or page is invalid.');return v;
}
export function frameBatch<T>(write:(value:T)=>void,frame:(cb:FrameRequestCallback)=>number,cancel:(id:number)=>void){let pending:number|undefined,latest:T,disposed=false;return {push(value:T){if(disposed)return;latest=value;if(pending===undefined)pending=frame(()=>{pending=undefined;if(!disposed)write(latest);});},dispose(){disposed=true;if(pending!==undefined)cancel(pending);pending=undefined;}};}
