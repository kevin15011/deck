import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {test,expect} from 'bun:test';
import {ComposerAction} from './composer-action';
// Protects Stop vs Send separation. Oracle: busy-input user request; a working
// Lead must not replace the submit action with a cancelling action.
test('busy composer exposes both deliberate Stop and submit including retained retry',()=>{
 const html=renderToStaticMarkup(<ComposerAction stop stopping={false} disabled={false} stopDisabled={false} queued pending={false} title="Queue" onStop={()=>{}}/>);
 expect(html).toMatch(/type="submit"[^>]*aria-label="Queue message"/);
 expect(html).toMatch(/type="button"[^>]*aria-label="Stop Lead"/);
 expect(html.match(/type="submit"[^>]*disabled/)).toBeNull();
 const retry=renderToStaticMarkup(<ComposerAction stop stopping={false} disabled={false} stopDisabled={false} queued pending title="Retry" onStop={()=>{}}/>);
 expect(retry).toContain('aria-label="Retry retained message"');
});
