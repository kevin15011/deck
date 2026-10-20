import React from 'react';
import {test,expect} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {UnreadReplies,replyFromURL,DisplayedReply} from './lead-replies';
const props={onOpen:()=>{},onMore:()=>{},onFirst:()=>{},onRefresh:()=>{},cursor:0,error:''};
test('healthy empty replies have no panel; error remains discoverable',()=>{
 expect(renderToStaticMarkup(<UnreadReplies {...props} page={{replies:[],total:0}}/>)).toBe('');
 const error=renderToStaticMarkup(<UnreadReplies {...props} error="Storage unavailable" page={{replies:[],total:0}}/>);expect(error).toContain('Replies unavailable');expect(error).toContain('aria-expanded="false"');
});
test('unread count stays collapsed and navigation alone has no receipt action',()=>{
 const html=renderToStaticMarkup(<UnreadReplies {...props} page={{total:2,replies:[{replyId:'reply-9-8',sessionId:'s',taskId:'lead',attempt:1,messageSeq:8,completedSeq:9,ts:1000,summary:'Specific answer.'}]}}/>);
 expect(html).toContain('2 unread replies');expect(html).not.toContain('Specific answer.');expect(html).not.toContain('Mark all');
 expect(replyFromURL('https://deck.test/?session=s&reply=reply-9-8')).toBe('reply-9-8');expect(replyFromURL('https://deck.test/?reply=../secret')).toBe('');
});
test('display observer is attached to exact content, independent of whole long message visibility',()=>{
 const html=renderToStaticMarkup(<DisplayedReply visible root={{current:null}} onDisplayed={async()=>{}} reply={{replyId:'reply-9-8',sessionId:'s',taskId:'lead',attempt:1,messageSeq:8,completedSeq:9,ts:1000,summary:'Specific answer.'}}>Exact reply body</DisplayedReply>);
 expect(html).toContain('data-reply-id="reply-9-8"');expect(html).toContain('Exact reply body');
});
