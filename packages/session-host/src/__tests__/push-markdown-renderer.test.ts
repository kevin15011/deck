import {test,expect} from 'bun:test';
import {createRequire} from 'node:module';
import {summarize} from '../push-attention';
import {redactText} from '@deck/core/session/redaction';
const requireWeb=createRequire(new URL('../../../../apps/web/package.json',import.meta.url));
const {default:Markdown}=await import(requireWeb.resolve('react-markdown'));
const {default:gfm}=await import(requireWeb.resolve('remark-gfm'));
const {createElement}=await import(requireWeb.resolve('react'));
const {renderToStaticMarkup}=await import(requireWeb.resolve('react-dom/server'));
test('bounded fence matrix agrees with installed web renderer code ownership',()=>{
 let code=0,prose=0;
 for(const marker of ['-','+','*','1.','12)','123456789.'])
 for(const padding of [' ','  ','   ','    ','\t'])
 for(const prefix of ['','> ','- > ','> - > '])
 for(const fence of ['```','````','~~~'])
 for(const indent of [0,2,4]){
  const text=prefix+marker+padding+fence+'text\n'+' '.repeat(indent)+'```\nPRIVATE_CODE_42\n'+fence+'\n\nDelivery fixed.';
  const html=renderToStaticMarkup(createElement(Markdown,{remarkPlugins:[gfm],children:text}));
  const inCode=[...html.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/g)].some(match=>match[1]!.includes('PRIVATE_CODE_42'));
  const summary=summarize(redactText(text));
  if(inCode){code++;expect(summary??'').not.toContain('PRIVATE_CODE_42');}else prose++;
 }
 expect(code).toBeGreaterThan(100);expect(prose).toBeGreaterThan(100);
});
test('HTML and GFM table subtrees are excluded, saturation fails closed',()=>{
 for(const text of ['<div>PRIVATE_CODE_42</div>','password | PRIVATE_CODE_42\n--- | ---\nname | value'])
  expect(summarize(redactText(text+'\n\nDelivery fixed.'))).toBe('Delivery fixed.');
 for(const size of [8191,8192,8193]){
  const text='-   ```text\n  ```\nPRIVATE_CODE_42\n```\n\nDelivery fixed.';
  const summary=summarize(redactText(text.padEnd(size,' ')));
  if(size>=8192)expect(summary).toBeUndefined();else expect(summary??'').not.toContain('PRIVATE_CODE_42');
 }
});
