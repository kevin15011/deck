import React from 'react';
import {test,expect} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {DisplayedReply} from './lead-replies';
test('display observer is attached to exact content, independent of whole long message visibility',()=>{
 const html=renderToStaticMarkup(<DisplayedReply visible root={{current:null}} onDisplayed={async()=>{}} reply={{replyId:'reply-9-8',sessionId:'s',taskId:'lead',attempt:1,messageSeq:8,completedSeq:9,ts:1000,summary:'Specific answer.'}}>Exact reply body</DisplayedReply>);
 expect(html).toContain('data-reply-id="reply-9-8"');expect(html).toContain('Exact reply body');
});
