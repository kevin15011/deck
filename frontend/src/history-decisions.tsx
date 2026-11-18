// Deck1's recorded question/permission presentation; deliberately no live actions.
import React from 'react';
import type {HistoryEvent} from './history-projection';
export function QuestionAnswerMessage({e}:{e:HistoryEvent}){
 const outcome=String(e.data.outcome),answered=outcome==='answered',title=answered?'You answered':outcome==='dismissed'?'You dismissed the questions':'Questions cancelled';
 const answers=e.data.answers&&typeof e.data.answers==='object'?e.data.answers as Record<string,unknown>:{};
 const questions=Array.isArray(e.request?.data.questions)?e.request.data.questions as Record<string,unknown>[]:[];
 const rows=questions.filter(q=>q&&typeof q.id==='string').map(q=>({id:String(q.id),header:typeof q.header==='string'?q.header:'',prompt:typeof q.prompt==='string'?q.prompt:'',secret:q.secret===true,values:q.secret===true?[]:Array.isArray(answers[String(q.id)])?(answers[String(q.id)] as unknown[]).filter((v):v is string=>typeof v==='string'):[]}));
 return <article className={`message user question-answer${answered?'':' muted'}`} aria-label={`${title} · Lead`}><div className="message-meta"><strong>{title}</strong><span>Lead</span><time dateTime={e.ts}>{new Date(e.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></div>{answered&&(rows.length?rows.map(row=><section className="question-answer-row" key={row.id}><p className="question-answer-label"><strong>{row.header||row.prompt||row.id}</strong></p>{row.header&&row.prompt&&<p className="question-answer-prompt">{row.prompt}</p>}{row.secret?<p className="question-answer-hidden">Hidden answer</p>:row.values.length>1?<ul>{row.values.map((value,i)=><li className="question-answer-value" key={i}>{value}</li>)}</ul>:<p className="question-answer-value">{row.values[0]??'Answer unavailable.'}</p>}</section>):<p className="muted">Answer details unavailable.</p>)}</article>;
}
export function AutoApprovalMessage({e}:{e:HistoryEvent}){
 const d=e.request?.data??e.data;
 return <article className="message auto-approval muted" aria-label="Auto-approved by a session permission"><p>Auto-approved by a session permission</p><p>{String(d.tool??d.toolKey??'Tool request')}{typeof d.exactKey==='string'&&<> · <code>{d.exactKey}</code></>}</p></article>;
}
