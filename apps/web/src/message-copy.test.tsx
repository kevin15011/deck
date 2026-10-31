import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageCopy } from './message-copy';

test('message copy has a named keyboard button, decorative SVG and polite feedback', () => {
    const html = renderToStaticMarkup(<MessageCopy text={'## raw\n\n**markdown**'}/>);
    expect(html).toContain('aria-label="Copy message"');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('## raw');
});
