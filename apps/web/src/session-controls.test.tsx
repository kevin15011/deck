import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionControls } from './session-controls';

test('closed historical session offers preparation of the same history without a successor action', () => {
    const html = renderToStaticMarkup(<SessionControls connected ended working={false} busy={false} sharedActive={0} preparation={{ status: 'unprepared', generation: 0 }} onReconnect={() => {}} onPrepare={() => {}} onCancel={() => {}} onClose={() => {}} onAssignments={() => {}} onPredecessor={() => {}} />);
    expect(html).toContain('Prepare session');
    expect(html).not.toContain('Continue session');
    expect(html).not.toContain('Read-only history');
});
test('releasing reports pending resource drain and disables preparation until it settles', () => {
    const html = renderToStaticMarkup(<SessionControls connected ended={false} working busy={false} sharedActive={0} preparation={{ status: 'releasing', generation: 0 }} onReconnect={() => {}} onPrepare={() => {}} onCancel={() => {}} onClose={() => {}} onAssignments={() => {}} onPredecessor={() => {}} />);
    expect(html).toContain('Closing session…'); expect(html).toContain('Waiting for session resources to stop');
    expect(html).not.toContain('>Prepare session<'); expect(html).toMatch(/disabled="">Closing session/);
});
test('failed removal retains history and exposes retry instead of premature preparation', () => {
    const html = renderToStaticMarkup(<SessionControls connected ended={false} working={false} busy={false} closing releaseFailed removing sharedActive={0} preparation={{ status: 'failed', reasonCode:'session-release-failed', generation:0 }} onReconnect={()=>{}} onPrepare={()=>{}} onCancel={()=>{}} onClose={()=>{}} onAssignments={()=>{}} onPredecessor={()=>{}}/>);
    expect(html).toContain('Could not remove session'); expect(html).toContain('>Retry removal<'); expect(html).not.toContain('>Prepare session<');
});


test('transient disconnect keeps controls mounted without unsolicited reconnect actions', () => {
    const html = renderToStaticMarkup(<SessionControls connected={false} ended={false} working={false} busy={false} sharedActive={0} preparation={{status:'ready',generation:0}} onReconnect={()=>{}} onPrepare={()=>{}} onCancel={()=>{}} onClose={()=>{}} onAssignments={()=>{}} onPredecessor={()=>{}}/>);
    expect(html).not.toContain('>Reconnect<');
    expect(html).toContain('session-secondary-actions');
});

test('compact mobile controls collapse to one header toggle that names the session state', () => {
    const props = { connected: true, ended: false, working: false, busy: false, sharedActive: 0, onReconnect: () => {}, onPrepare: () => {}, onCancel: () => {}, onClose: () => {}, onAssignments: () => {}, onPredecessor: () => {} };
    const unprepared = renderToStaticMarkup(<SessionControls {...props} compact preparation={{ status: 'unprepared', generation: 0 }}/>);
    expect(unprepared).toContain('class="quiet session-compact-toggle action"');
    expect(unprepared).toContain('aria-expanded="false"');
    expect(unprepared).toContain('aria-label="Session: Prepare this session before sending."');
    expect(unprepared).toContain('<span>Prepare</span>');
    expect(unprepared).not.toContain('Close session'); // Actions stay inside the closed panel.
    const ready = renderToStaticMarkup(<SessionControls {...props} compact preparation={{ status: 'ready', generation: 0 }}/>);
    expect(ready).toContain('session-compact-toggle ready');
    expect(ready).toContain('<span>Ready</span>');
    expect(ready).toContain('class="session-compact-chevron"');
    expect(ready).toMatch(/<svg class="session-compact-chevron"[^>]*aria-hidden="true"/);
});

test('desktop controls keep notes on one line with the full text as a tooltip-ready container', () => {
    const html = renderToStaticMarkup(<SessionControls connected ended={false} working={false} busy={false} sharedActive={2} error="Readiness failed" preparation={{ status: 'ready', generation: 0 }} onReconnect={() => {}} onPrepare={() => {}} onCancel={() => {}} onClose={() => {}} onAssignments={() => {}} onPredecessor={() => {}}/>);
    expect(html).toContain('class="session-controls"');
    expect(html).toMatch(/<div class="session-control-status"><p role="status">Ready to send<\/p><div class="session-control-notes">.*Shared directory · 2 other active sessions.*<\/div><p class="error" role="alert" title="Readiness failed">/);
});
