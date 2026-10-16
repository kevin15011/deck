import React from 'react';
import { test, expect } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { secretAnswerReady, wipeSecretInputs, answerReady, buildAnswers, QuestionDock, type Question } from './questions';
const q: Question = { id:'q', prompt:'Choose', options:[{label:'One',description:'First'}], multiple:false, allowOther:true, secret:false };
test('all questions require nonempty valid answers',()=>{
 expect(answerReady([q],{})).toBe(false);
 expect(answerReady([q],{q:{values:['One']}})).toBe(true);
 expect(answerReady([q],{q:{values:['One','Two']}})).toBe(false);
 expect(answerReady([q],{q:{values:[],otherSelected:true,other:'  '}})).toBe(false);
 expect(buildAnswers([q],{q:{values:[],otherSelected:true,other:'Custom'}})).toEqual({q:['Custom']});
 expect(answerReady([q,{...q,id:'second'}],{q:{values:['One']}})).toBe(false);
});
test('SSR renders choices, multiple, free text, secret masking and disabled send',()=>{
 const questions=[q,{...q,id:'multi',multiple:true},{...q,id:'free',options:[]},{...q,id:'secret',options:[],secret:true}];
 const html=renderToStaticMarkup(<QuestionDock open={false} onToggle={()=>{}} questions={questions} questionId="request" drafts={{secret:{values:['sensitive']}}} onDrafts={()=>{}} onCommand={async()=>{}}/>);
 expect(html).toContain('type="radio"'); expect(html).toContain('type="checkbox"'); expect(html).toContain('<textarea'); expect(html).toContain('type="password"'); expect(html).toContain('autoComplete="off"'); expect(html).not.toContain('sensitive'); expect(html).toContain('Send answers (0/4)'); expect(html).toContain('disabled'); expect(html).toContain('role="tablist"');
});
test('answer validation covers option-only, custom, multiple and free text constraints',()=>{
 expect(answerReady([{...q,allowOther:false}],{q:{values:['Custom']}})).toBe(false);
 expect(answerReady([{...q,multiple:true}],{q:{values:['One'],otherSelected:true,other:'Custom'}})).toBe(true);
 expect(buildAnswers([{...q,multiple:true}],{q:{values:['One'],otherSelected:true,other:'Custom'}})).toEqual({q:['One','Custom']});
 expect(answerReady([{...q,options:[]}],{q:{values:['Free answer']}})).toBe(true);
 expect(answerReady([{...q,options:[]}],{q:{values:['x'.repeat(4001)]}})).toBe(false);
 expect(answerReady([{...q,secret:true,options:[]}],{q:{values:['secret']}})).toBe(true);
});
test('prototype question ids start empty and serialize as own answers',()=>{
 for(const id of ['constructor','__proto__','toString']){
  const question={...q,id};
  expect(answerReady([question],{})).toBe(false);
  const html=renderToStaticMarkup(<QuestionDock open onToggle={()=>{}} questions={[question]} questionId="request" drafts={{}} onDrafts={()=>{}} onCommand={async()=>{}}/>);
  expect(html).toContain('Send answers (0/1)');
  const transient=buildAnswers([],{});transient[id]=['One'];
  expect(JSON.parse(JSON.stringify(transient))[id]).toEqual(['One']);
  const answers=buildAnswers([question],Object.fromEntries([[id,{values:['One']}]]));
  expect(Object.hasOwn(answers,id)).toBe(true);
  expect(JSON.parse(JSON.stringify(answers))[id]).toEqual(['One']);
 }
});

test('secret validity uses option, length and single-answer rules',()=>{
 const secret={...q,secret:true,allowOther:false};
 expect(secretAnswerReady(secret,'Disallowed')).toBe(false);
 expect(secretAnswerReady(secret,'One')).toBe(true);
 expect(secretAnswerReady({...secret,allowOther:true},'Disallowed')).toBe(true);
 expect(secretAnswerReady({...secret,options:[]},'Free')).toBe(true);
 for(const value of ['', '  ', 'x'.repeat(4001)])expect(secretAnswerReady({...secret,options:[]},value)).toBe(false);
});
test('connection cleanup wipes secret DOM values and drops every ref',()=>{
 const input={value:'private'} as HTMLInputElement;
 const refs=Object.fromEntries([['__proto__',input],['constructor',input]]);
 wipeSecretInputs(refs);
 expect(input.value).toBe('');expect(Object.keys(refs)).toEqual([]);
});
