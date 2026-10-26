import {test,expect} from 'bun:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FileContent} from './project-files';
import {GitDiff,folderGitStatuses} from './git-diff';
test('Review defaults to Files and retains an explicit Changes mode',()=>{
 const html=renderToStaticMarkup(<GitDiff api={async()=>({}) as any} sessionId="s" visible={true} narrow={false}/>);expect(html).toContain('aria-pressed="true">Files');expect(html).toContain('aria-pressed="false">Changes');expect(html).toContain('Show ignored');
});
test('text and Markdown stay inert; raster media uses only supplied bytes',()=>{
 const document={kind:'text' as const,path:'a.md',size:50,content:'<script>alert(1)</script>\n![remote](https://evil.example/image)'};
 for(const markdown of [false,true]){const html=renderToStaticMarkup(<FileContent document={document} markdown={markdown}/>);expect(html).not.toContain('<script>');expect(html).not.toContain('<img');}
 const html=renderToStaticMarkup(<FileContent document={{kind:'image',path:'photo',size:3,mime:'image/png',base64:'AAAA',width:1,height:1}} markdown={false}/>);expect(html).toContain('src="data:image/png;base64,AAAA"');expect(html).toContain('alt="photo"');
});

test('folder colors include unloaded descendants, deleted paths and mixed states without prefix collisions',()=>{
 const statuses=folderGitStatuses([
  {path:'src/deep/new.ts',section:'untracked',status:'?'},
  {path:'src/old.ts',section:'unstaged',status:'M'},
  {path:'src-other/new.ts',section:'staged',status:'A'},
  {path:'removed/old.ts',section:'unstaged',status:'D'},
  {path:'conflict/nested/a.ts',section:'unstaged',status:'U'},
  {path:'conflict/b.ts',section:'staged',status:'A'},
 ]);
 expect(statuses.get('src')?.kind).toBe('modified');
 expect(statuses.get('src/deep')?.kind).toBe('new');
 expect(statuses.get('src-other')?.kind).toBe('new');
 expect(statuses.get('removed')?.kind).toBe('deleted');
 expect(statuses.get('conflict')?.kind).toBe('conflict');
 expect(statuses.get('conflict/nested')?.kind).toBe('conflict');
 expect(statuses.has('clean')).toBe(false);
 expect(folderGitStatuses([]).size).toBe(0);
});
