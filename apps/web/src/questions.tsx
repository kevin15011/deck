import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { collapse, gsap } from './motion';
import type { Question } from '../../../packages/core/src/session/question';
export type { Question } from '../../../packages/core/src/session/question';
export type QuestionDraft = { values:string[]; otherSelected?:boolean; other?:string };
export type QuestionDrafts = Record<string,QuestionDraft>;
export function buildAnswers(questions:Question[], drafts:QuestionDrafts):Record<string,string[]> {
    return Object.fromEntries(questions.map(q=>{const d=drafts[q.id];return [q.id,[...(d?.values??[]),...(d?.otherSelected?[d.other??'']:[])]];}));
}
export function answerReady(questions:Question[], drafts:QuestionDrafts):boolean {
    const answers=buildAnswers(questions,drafts);
    return questions.length>0&&questions.every(q=>{const values=answers[q.id]!;return values.length>0&&(q.multiple||values.length===1)&&values.every(v=>v.trim().length>0&&v.length<=4000&&(!q.options.length||q.allowOther||q.options.some(o=>o.label===v)));});
}
export function QuestionDock({ questionId, questions, label='The Lead', drafts, onDrafts, onCommand, busy=false, open, onToggle }: { open:boolean; onToggle:()=>void; questionId:string; questions:Question[]; label?:string; drafts:QuestionDrafts; onDrafts:(drafts:QuestionDrafts)=>void; onCommand:(body:Record<string,unknown>)=>Promise<unknown>; busy?:boolean }) {
    const id=useId(), node=useRef<HTMLDivElement>(null), first=useRef(true), [visible,setVisible]=useState(false), [active,setActive]=useState(0), [error,setError]=useState(''), [sending,setSending]=useState(false);
    useLayoutEffect(()=>{const element=node.current;if(first.current){first.current=false;return;}if(!element)return;if(open){setVisible(true);const frame=requestAnimationFrame(()=>collapse(element,true));return ()=>{cancelAnimationFrame(frame);gsap.killTweensOf(element);};}collapse(element,false,()=>setVisible(false));return ()=>{gsap.killTweensOf(element);};},[open]);
    const secrets=useRef<Record<string,HTMLInputElement>>({});
    const secretRefs=useRef<Record<string,(element:HTMLInputElement|null)=>void>>({});
    function secretRef(id:string){return secretRefs.current[id]??=(element=>{if(element)secrets.current[id]=element;else{if(secrets.current[id])secrets.current[id]!.value='';delete secrets.current[id];}});}
    const [filled,setFilled]=useState<Record<string,boolean>>({});
    useLayoutEffect(()=>()=>{for(const input of Object.values(secrets.current))input.value='';secrets.current={};},[]);
    const ready=(q:Question,next=drafts)=>q.secret?!!filled[q.id]:answerReady([q],next);
    const count=questions.filter(q=>ready(q)).length;
    function wipe(){for(const input of Object.values(secrets.current))input.value='';setFilled({});}

    function update(q:Question, draft:QuestionDraft, advance=false){const next={...drafts,[q.id]:draft};onDrafts(next);if(advance&&answerReady([q],next)){const index=Array.from({length:questions.length},(_,i)=>(active+i+1)%questions.length).find(i=>!ready(questions[i]!,next));if(index!==undefined){setActive(index);node.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[index]?.focus();}}}
    async function send(type:string){
        setSending(true);setError('');
        const answers=type==='question.answer'?buildAnswers(questions.filter(q=>!q.secret),drafts):undefined;
        if(answers)for(const q of questions)if(q.secret)answers[q.id]=[secrets.current[q.id]?.value??''];
        wipe();
        try{await onCommand({type,questionId,...(answers?{answers}:{})});}
        catch{setError('Could not send the response. Try again.');}
        finally{if(answers)for(const q of questions)if(q.secret)delete answers[q.id];setSending(false);}
    }
    return <section className="question-dock" aria-label={`${label} questions`}><button type="button" className="question-toggle quiet" aria-label={`${label} has ${questions.length===1?'a question':`${questions.length} questions`}`} aria-expanded={open} aria-controls={id} onClick={onToggle}><span role="status" aria-live="polite" aria-atomic="true">{label} has {questions.length===1?'a question':`${questions.length} questions`}</span><span aria-hidden="true">{open?'−':'+'}</span></button><div ref={node} id={id} className="question-panel" hidden={!open&&!visible} {...(!open?{inert:true,'aria-hidden':true}: {})}>
    {questions.length>1&&<div role="tablist" aria-label="Questions" onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?questions.length-1:(active+(event.key==='ArrowRight'?1:-1)+questions.length)%questions.length;setActive(next);event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();}}>{questions.map((q,i)=><button type="button" role="tab" id={`${id}-tab-${i}`} aria-controls={`${id}-question-${i}`} aria-selected={active===i} tabIndex={active===i?0:-1} key={q.id} onClick={()=>setActive(i)}>{q.header||`Question ${i+1}`}{ready(q)?' ✓':''}</button>)}</div>}
    {questions.map((q,i)=>{const d=drafts[q.id]??{values:[]}, field=`${id}-field-${i}`;return <div key={q.id} id={`${id}-question-${i}`} hidden={active!==i} role={questions.length>1?'tabpanel':undefined} aria-labelledby={questions.length>1?`${id}-tab-${i}`:undefined}><fieldset><legend>{q.prompt}</legend>{q.secret?<label htmlFor={field}>Secret answer<input id={field} type="password" autoComplete="off" maxLength={4000} ref={secretRef(q.id)} onInput={()=>setFilled(old=>({...old,[q.id]:!!secrets.current[q.id]?.value.trim()}))}/></label>:q.options.length?<>{q.options.map((option,j)=><label className="question-choice" key={j}><input type={q.multiple?'checkbox':'radio'} name={field} checked={d.values.includes(option.label)} onChange={event=>update(q,{...d,values:q.multiple?(event.target.checked?[...d.values,option.label]:d.values.filter(v=>v!==option.label)):[option.label],otherSelected:q.multiple?d.otherSelected:false},!q.multiple)}/><span>{option.label}{option.description&&<small>{option.description}</small>}</span></label>)}{q.allowOther&&<div className="question-other"><label><input type={q.multiple?'checkbox':'radio'} name={field} checked={!!d.otherSelected} onChange={event=>update(q,{...d,values:q.multiple?d.values:[],otherSelected:event.target.checked})}/>Other</label><input aria-label="Other answer" type="text" value={d.other??''} maxLength={4000} onChange={event=>update(q,{...d,values:q.multiple?d.values:[],otherSelected:true,other:event.target.value})}/></div>}</>:<label htmlFor={field}>Your answer<textarea id={field} value={d.values[0]??''} maxLength={4000} onChange={event=>update(q,{values:[event.target.value]})}/></label>}</fieldset></div>;})}
    {error&&<p role="alert" className="error">{error}</p>}<footer><span className="sr-only" role="status" aria-live="polite">{count} of {questions.length} answered</span><button type="button" disabled={busy||sending||count!==questions.length} onClick={()=>void send('question.answer')}>Send answers ({count}/{questions.length})</button><button type="button" className="quiet" disabled={busy||sending} onClick={()=>void send('question.dismiss')}>Dismiss</button><span className="muted">Answer every question to send.</span></footer></div></section>;
}
