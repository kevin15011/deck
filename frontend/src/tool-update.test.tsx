import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'bun:test';
import {ToolUpdateButton} from './tool-update';
// Protects enabled actions only for confirmed newer releases. Oracle: decision 18.
test('update action requires confirmed newer version and preserves failure retry',()=>{
 for(const [update,enabled,label] of [
  [{state:'up_to_date',latest:'1.0.0'},false,'Up to date'],
  [{state:'available',latest:'1.2.0'},true,'Update to 1.2.0'],
  [{state:'check_failed'},false,"Couldn&#x27;t check for updates"],
 ] as const){
  const html=renderToStaticMarkup(<ToolUpdateButton update={update} blocked={false} onClick={()=>{}}/>);
  expect(html.includes('disabled=""')).toBe(!enabled);expect(html).toContain(label);
 }
 expect(renderToStaticMarkup(<ToolUpdateButton update={{state:'available',latest:'2.0.0'}} blocked onClick={()=>{}}/>)).toContain('disabled=""');
});
