import React from 'react';
import { test, expect } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PersonalMcpAvailabilityView, PersonalMcpAvailabilityContent } from './personal-mcp-availability';
test('MCP preparation distinguishes configured from verified active, unavailable and conflicting servers',()=>{
 const html=renderToStaticMarkup(<PersonalMcpAvailabilityContent entries={[{id:'docs',source:'user',status:'configured'},{id:'active',source:'native',status:'active'},{id:'deck',source:'project',status:'conflicting',reason:'reserved'},{id:'offline',source:'user',status:'unavailable',reason:'not-connected'}]}/>);
 for(const text of ['Configured','Active','Conflicting','Unavailable','Reserved for Deck','Role permissions still apply'])expect(html).toContain(text);
 expect(html).toContain('secondary-info-servers');expect(html).not.toContain('SECRET');
});
test('delegated runner failures remain visible separately from the Lead snapshot',()=>{
 const html=renderToStaticMarkup(<PersonalMcpAvailabilityContent entries={[{id:'lead-docs',source:'user',status:'active'}]} runnerId="claude" members={{investigate:{runnerId:'opencode',servers:[{id:'member-docs',source:'native',status:'unavailable',reason:'not-connected'}]}}}/>);
 expect(html).toContain('Lead · claude');expect(html).toContain('investigate · opencode');expect(html).toContain('member-docs');expect(html).toContain('Connection unavailable');
});

test('closed MCP control stays concise and carries no inline server list',()=>{
 const html=renderToStaticMarkup(<PersonalMcpAvailabilityView entries={[{id:'server-details',source:'user',status:'configured'}]}/>);
 expect(html).toContain('MCP servers');expect(html).toContain('aria-expanded="false"');expect(html).not.toContain('server-details');expect(html).not.toContain('<details');
});
