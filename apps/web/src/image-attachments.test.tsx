import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { imageMimeType, imageDisplayName, validateImageBatch, insertPastedText, ImageReferences } from './image-attachments';
test('image capture accepts portable browser files and enforces agreed count/byte/type bounds',()=>{
 const file=(name:string,size:number,type:string)=>({name,size,type}) as File;
 expect(imageMimeType(file('capture.PNG',2,''))).toBe('image/png');
 expect(validateImageBatch([], [file('one.png',10,'image/png'),file('two.webp',12,'image/webp')]).accepted).toHaveLength(2);
 expect(validateImageBatch([], [file('script.svg',20,'image/svg+xml')]).accepted).toHaveLength(0);
 expect(validateImageBatch([], [file('large.jpg',5*1024*1024+1,'image/jpeg')]).error).toContain('5 MiB');
 expect(validateImageBatch(Array.from({length:8},()=>file('x.png',1,'image/png')),[file('extra.png',1,'image/png')]).accepted).toHaveLength(0);
 expect(validateImageBatch(Array.from({length:4},()=>file('x.png',5*1024*1024,'image/png')),[file('extra.png',1,'image/png')]).error).toContain('20 MiB');
});
test('display names never reveal client paths and mixed paste inserts text once at the selection',()=>{
 expect(imageDisplayName('C:\\Users\\Private\\capture.png')).toBe('capture.png');expect(imageDisplayName('/home/private/capture.png')).toBe('capture.png');
 expect(insertPastedText('Before after',7,7,'paste')).toEqual({text:'Before pasteafter',caret:12});
});
test('sent references are compact safe buttons, with no filesystem path or arbitrary image URL',()=>{
 const html=renderToStaticMarkup(<ImageReferences attachments={[{attachmentId:'id',mimeType:'image/png',name:'C:\\Users\\Private\\<img>.png',sizeBytes:1}]} onPreview={()=>{}}/>);
 expect(html).toContain('View image 1');expect(html).toContain('&lt;img&gt;.png');expect(html).not.toContain('Private');expect(html).not.toContain('<img');expect(html).not.toContain('file://');
});
