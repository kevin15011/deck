import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown, resolveArtifactLink, safeMarkdownUrl } from './markdown';
test('Markdown renders semantic prose, GFM tables and code without executing HTML or fetching images', () => {
    const html = renderToStaticMarkup(<Markdown text={'## Result\n\n**Ready**\n\n- [x] Complete\n\n| Step | State |\n| --- | --- |\n| Test | Pass |\n\n```ts\nconst ready = true;\n```\n\n<script>alert(1)</script>\n\n![Private](https://tracker.example/image.png)\n\n[Bad](javascript:alert%281%29)\n\n[File](file:///etc/passwd)\n\n[API](/api/commands)\n\n[Docs](https://example.com/docs)'} />);
    expect(html).toContain('<h2>Result</h2>'); expect(html).toContain('<strong>Ready</strong>');
    expect(html).toContain('<table>'); expect(html).toContain('Copy code'); expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('<script'); expect(html).not.toContain('<img'); expect(html).not.toContain('href="javascript'); expect(html).not.toContain('href="file:'); expect(html).not.toContain('href="/api');
    expect(html).toContain('rel="noreferrer noopener"');
});
test('URL policy rejects disguised schemes and navigation paths', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,test', '//example.com', '/api/sessions', '../secret', 'https:\n//example.com', 'file:///tmp/a']) expect(safeMarkdownUrl(value)).toBe('');
    expect(safeMarkdownUrl('https://example.com/docs')).toBe('https://example.com/docs');
});

test('relative artifact links resolve only to catalogued Markdown paths', () => {
    const paths = ['proposal.md', 'specs/requirements.md'];
    expect(resolveArtifactLink('../proposal.md', 'specs/requirements.md', paths)).toBe('proposal.md');
    for (const href of ['../../secret.md', '/api/commands', 'javascript:alert(1)', '//host/a.md', '%2fapi/commands', '../private.md', '../proposal.md?query']) expect(resolveArtifactLink(href, 'specs/requirements.md', paths)).toBeUndefined();
    const html = renderToStaticMarkup(<Markdown text={'[Proposal](../proposal.md) [Secret](../private.md)'} artifactPaths={paths} basePath="specs/requirements.md" onArtifactLink={() => {}}/>);
    expect(html).toContain('type="button"'); expect(html).not.toContain('href='); expect(html).toContain('<span>Secret</span>');
});
