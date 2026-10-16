import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { QuestionAnswerMessage } from './question-answer';
import { joinQuestionResolution } from './state';
import type { SessionEvent } from '../../../packages/core/src/session/events';
const event=(kind:SessionEvent['kind'],data:Record<string,unknown>):SessionEvent=>({v:1,sessionId:'s',seq:1,ts:'2026-01-01T12:00:00Z',kind,data,source:{taskId:'lead'}});
function html(outcome:string,questions?:unknown[],answers?:Record<string,string[]>){return render(<QuestionAnswerMessage label="Investigate" ts="2026-01-01T12:00:00Z" resolution={joinQuestionResolution(event('question.resolved',{outcome,answers}),questions?event('question.requested',{questions}):undefined)}/>);}
test('answered choice shows question header, prompt, role and user styling',()=>{
 const markup=html('answered',[{id:'q',header:'Approach',prompt:'Pick one',secret:false}],{q:['Allowed']});
 for(const text of ['message user question-answer','You answered','Investigate','Approach','Pick one','Allowed','aria-label='])expect(markup).toContain(text);
 expect(markup).not.toContain('data-reply-seq');
});
test('multiple answers render a readable list',()=>{const markup=html('answered',[{id:'q',prompt:'Pick several',secret:false}],{q:['Red','Blue']});expect(markup).toContain('<ul>');expect(markup).toMatch(/<li[^>]*>Red<\/li>/);expect(markup).toMatch(/<li[^>]*>Blue<\/li>/);});
test('free text preserves typed line breaks and escapes markup',()=>{const markup=html('answered',[{id:'q',prompt:'Describe',secret:false}],{q:['First line\n  <script>typed</script>']});expect(markup).toContain('First line\n  &lt;script&gt;typed&lt;/script&gt;');expect(markup).not.toContain('<script>');});
test('secret answers render only a hidden marker, even if extra values arrive',()=>{const markup=html('answered',[{id:'q',prompt:'Private token',secret:true}],{q:['secret-sentinel']});expect(markup).toContain('Hidden answer');expect(markup).toContain('<svg');expect(markup).not.toContain('secret-sentinel');});
test('dismissed resolutions have muted user copy',()=>{const markup=html('dismissed');expect(markup).toContain('You dismissed the questions');expect(markup).toContain('muted');});
test('cancelled resolutions explain the task lifecycle',()=>{expect(html('cancelled')).toContain('Questions cancelled');});
test('missing requests render ids with answers',()=>{const markup=html('answered',undefined,{unknown:['Answer without a prompt']});expect(markup).toContain('unknown');expect(markup).toContain('Answer without a prompt');});
test('legacy answered events without details degrade gracefully',()=>{expect(html('answered')).toContain('Answer details unavailable.');});
