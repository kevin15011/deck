import React from 'react';
import {expect,test} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProjectTrustFields} from './project-trust-settings';
const trust={projectId:'p',projectRoot:'/canonical/project',trusted:false,revision:0};
test('trust is an explicit settings action with canonical scope and consequences',()=>{const html=renderToStaticMarkup(<ProjectTrustFields trust={trust} pending={false} onChange={()=>{}}/>);expect(html).toContain('Trust project');expect(html).toContain('/canonical/project');expect(html).toContain('every member');expect(html).toContain('User and global');expect(html).toContain('not trusted');expect(html).toContain('type="button"');expect(html).not.toContain('type="submit"');});
test('read-only state has no grant action; unavailable or pending settings cannot submit',()=>{expect(renderToStaticMarkup(<ProjectTrustFields trust={trust} pending={false}/>)).not.toContain('<button');for(const props of [{pending:true},{pending:false,disabled:true}])expect(renderToStaticMarkup(<ProjectTrustFields trust={trust} {...props} onChange={()=>{}}/>)).toContain('disabled=""');});
test('revocation is visible and future work semantics are explicit',()=>{const html=renderToStaticMarkup(<ProjectTrustFields trust={{...trust,trusted:true,revision:1}} pending={false} onChange={()=>{}}/>);expect(html).toContain('Revoke project trust');expect(html).toContain('future preparation and launches');expect(html).toContain('running work keeps its current configuration');});
