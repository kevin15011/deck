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
