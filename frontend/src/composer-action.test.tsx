import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {test, expect} from 'bun:test';
import {ComposerAction} from './composer-action';

test('the primary action can submit only when it is in send mode', () => {
    for (const stop of [false, true]) {
        const html = renderToStaticMarkup(<ComposerAction
            stop={stop} stopping={false} disabled={false} label="Action" title="Action" onStop={() => {}}
        />);
        expect(html.match(/<button\b/g)).toHaveLength(1);
        expect(html.includes('type="submit"')).toBe(!stop);
    }
});
