import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseGitPatch, DiffContent, GitFileNavigator, GitDocumentHeader, gitStatus } from './git-diff';
const patch = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -3,3 +3,4 @@\n context\n-old\n+<script>bad()</script>\n+extra\n tail\n\\ No newline at end of file\n';
test('both render modes share numbered context, removals and additions and escape file content', () => {
 const rows = parseGitPatch(patch);
 expect(rows.filter(row=>row.kind==='remove')).toMatchObject([{old:4,text:'old'}]);
 expect(rows.filter(row=>row.kind==='add')).toMatchObject([{next:4,text:'<script>bad()</script>'},{next:5,text:'extra'}]);
 expect(rows.filter(row=>row.kind==='context')).toMatchObject([{old:3,next:3,text:'context'},{old:5,next:6,text:'tail'}]);
 for(const mode of ['inline','split'] as const) {
  const html=renderToStaticMarkup(<DiffContent patch={patch} mode={mode}/>);
  expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;'); expect(html).toContain('old'); expect(html).toContain('extra'); expect(html).toContain('No newline');
 }
});

test('blank context preserves changed and trailing line numbers in both modes', () => {
 const patch='@@ -1,4 +1,4 @@\n start\n \n-old\n+new\n tail\n';
 expect(parseGitPatch(patch)).toMatchObject([
  {kind:'hunk'}, {kind:'context',old:1,next:1}, {kind:'context',old:2,next:2,text:''},
  {kind:'remove',old:3}, {kind:'add',next:3}, {kind:'context',old:4,next:4,text:'tail'},
 ]);
 for(const mode of ['inline','split'] as const) {
  const html=renderToStaticMarkup(<DiffContent patch={patch} mode={mode}/>);
  expect(html).toContain('diff-number">3</td>');expect(html).toContain('diff-number">4</td>');
 }
});

test('file navigator preserves section identity, hierarchy and accessible statuses', () => {
 const files = [
  {section:'staged',path:'src/deep/file.ts',status:'R',previousPath:'old.ts'},
  {section:'unstaged',path:'src/deep/file.ts',status:'M'},
  {section:'unstaged',path:'deleted.ts',status:'D'},
  {section:'untracked',path:'nested/',status:'?',unavailableReason:'Nested repository'},
 ] as import('../../../packages/core/src/session/git-diff').GitFile[];
 const html=renderToStaticMarkup(<GitFileNavigator files={files} selected="staged:src/deep/file.ts" onSelect={()=>{}}/>);
 expect(html).not.toContain('<select');
 expect(html).toContain('Staged');expect(html).toContain('Unstaged');expect(html).toContain('Untracked');
 expect(html).toContain('Renamed');expect(html).toContain('Modified');expect(html).toContain('Deleted');expect(html).toContain('New');
 expect(html).toContain('old.ts');expect(html).toContain('Nested repository');
 expect(html).toContain('data-file-key="staged:src/deep/file.ts"');
 expect(html).toContain('data-file-key="unstaged:src/deep/file.ts"');
 expect(html).toContain('aria-current="true"');expect(html).toContain('<summary');
});


test('Git colors retain non-color labels including conflict and unknown detection', () => {
 for(const [status,kind,label] of [['M','modified','Modified'],['A','new','New'],['D','deleted','Deleted'],['R','renamed','Renamed'],['U','conflict','Conflict'],['?','unknown','Unknown status']]) {
  expect(gitStatus({path:'file',section:'unstaged',status:status!})).toEqual({kind,label});
 }
 expect(gitStatus({path:'file',section:'untracked',status:'?'}).kind).toBe('new');
});

test('Markdown files expose separate labeled SVG preview controls', () => {
 const html=renderToStaticMarkup(<GitFileNavigator files={[{path:'doc.md',section:'staged',status:'M'},{path:'code.ts',section:'untracked',status:'A'}]} selected="" onSelect={()=>{}} onPreview={()=>{}}/>);
 expect(html).toContain('aria-label="Preview Markdown: staged: doc.md"');
 expect(html).not.toContain('Preview Markdown: untracked: code.ts');
});

test('selection reads retry busy admission and stop after cancellation or other errors', async () => {
 const {requestGit}=await import('./git-diff');let calls=0;
 const controller=new AbortController();
 expect(await requestGit(async()=>{if(++calls===1)throw Object.assign(Error('busy'),{code:'git-busy'});return {ok:true};},'/git',controller.signal)).toEqual({ok:true});
 expect(calls).toBe(2);
 calls=0;
 const pending=requestGit(async()=>{calls++;controller.abort();throw Object.assign(Error('busy'),{code:'git-busy'});},'/git',controller.signal);
 await expect(pending).rejects.toThrow();expect(calls).toBe(1);
 await expect(requestGit(async()=>{throw Error('invalid');},'/git',new AbortController().signal)).rejects.toThrow('invalid');
});

for (const [terminalStatus, childStatus] of [['D', 'A'], ['A', 'D']] as const) {
 test(`file/folder replacement ${terminalStatus}/${childStatus} renders both terminal and descendants`, () => {
  const files = [
   {path:'docs',section:'staged' as const,status:terminalStatus},
   {path:'docs/guide.md',section:'staged' as const,status:childStatus},
  ];
  for (const ordered of [files, [...files].reverse()]) {
   const html=renderToStaticMarkup(<GitFileNavigator files={ordered} selected="staged:docs/guide.md" onSelect={()=>{}} onPreview={()=>{}}/>);
   expect(html).toContain('data-file-key="staged:docs"');
   expect(html).toContain('data-file-key="staged:docs/guide.md"');
   expect(html).toContain('aria-label="Preview Markdown: staged: docs/guide.md"');
   expect(html).toContain('title="docs">docs/</span>');
   expect(html).toContain('aria-current="true"');
   expect((html.match(/data-file-key=/g)??[]).length).toBe(2);
  }
 });
}

 test('selected file header offers Markdown preview only for Markdown diffs', () => {
  for (const path of ['guide.md', 'GUIDE.MD', 'code.ts']) {
   for (const preview of [false, true]) {
    const html=renderToStaticMarkup(<GitDocumentHeader file={{path,section:'staged',status:'M'}} preview={preview} onPreview={()=>{}}/>);
    expect(html.includes('aria-label="Preview Markdown: staged:')).toBe(/\.md$/i.test(path)&&!preview);
    if (/\.md$/i.test(path)&&!preview) {expect(html).toContain('<svg');expect(html).toContain('aria-hidden="true"');}
   }
  }
 });
