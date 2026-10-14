import React, { memo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Links never navigate local files or application endpoints from untrusted prose. */
export function safeMarkdownUrl(value: string): string {
    const url = value.trim();
    return /^(https?:\/\/|mailto:)/i.test(url) && !/[\u0000-\u0020\u007f]/.test(url) ? url : '';
}
function codeText(children: ReactNode): string {
    return React.Children.toArray(children).map(child => typeof child === 'string' || typeof child === 'number' ? String(child) : React.isValidElement<{ children?: ReactNode }>(child) ? codeText(child.props.children) : '').join('');
}
function CodeBlock({ children }: { children?: ReactNode }) {
    const [status, setStatus] = useState('Copy code');
    return <div className="code-block"><div className="code-toolbar"><span>Code</span><button type="button" className="quiet" onClick={async () => {
        try { await navigator.clipboard.writeText(codeText(children).replace(/\n$/, '')); setStatus('Copied'); }
        catch { setStatus('Copy failed'); }
    }}>{status}</button></div><pre>{children}</pre></div>;
}
export function resolveArtifactLink(href: string, basePath: string, paths: string[]): string | undefined {
    if (/^[a-z][a-z\d+.-]*:|^\/|[?#]/i.test(href)) return;
    let decoded: string; try { decoded = decodeURIComponent(href); } catch { return; }
    if (/^[a-z][a-z\d+.-]*:|^\/|[\\\u0000-\u001f]/i.test(decoded)) return;
    const parts = basePath.split('/').slice(0, -1);
    for (const part of decoded.split('/')) {
        if (part === '..') { if (!parts.length) return; parts.pop(); }
        else if (part && part !== '.') parts.push(part);
    }
    const path = parts.join('/'); return paths.includes(path) ? path : undefined;
}
export const Markdown = memo(function Markdown({ text, onArtifactLink, artifactPaths = [], basePath = '' }: { text: string; onArtifactLink?: (path: string) => void; artifactPaths?: string[]; basePath?: string }) {
    return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={url => safeMarkdownUrl(url) || (onArtifactLink && resolveArtifactLink(url, basePath, artifactPaths) ? url : '')} components={{
        pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        table: ({ children }) => <div className="table-scroll" tabIndex={0} role="region" aria-label="Markdown table"><table>{children}</table></div>,
        img: ({ alt }) => <span className="image-placeholder">[Image: {alt || 'image'}]</span>,
        a: ({ href, children }) => safeMarkdownUrl(href ?? '') ? <a href={href} target="_blank" rel="noreferrer noopener">{children}</a> : onArtifactLink && href ? <button className="text-link" type="button" onClick={() => { const path = resolveArtifactLink(href, basePath, artifactPaths); if (path) onArtifactLink(path); }}>{children}</button> : <span>{children}</span>,
    }}>{text}</ReactMarkdown></div>;
}, (previous, next) => previous.text === next.text && previous.basePath === next.basePath && previous.onArtifactLink === next.onArtifactLink && (previous.artifactPaths ?? []).join('\n') === (next.artifactPaths ?? []).join('\n'));
