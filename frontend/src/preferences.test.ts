import {test,expect} from 'bun:test';
import {readPreference,savePreference,resolveFont,resolveTheme,resolveSplit,resolveContentMode,resolveChatWidth} from './preferences';
// Protects optional browser preferences: untrusted storage cannot prevent editing.
// Oracle: original defaults/25–75 bounds and legacy panel fallback; fails on unsafe reads/writes or invalid output.
test('appearance values validate and optional storage failure stays usable',()=>{
 for(const bad of [null,undefined,{},'invalid','']){expect(resolveFont(bad)).toBe('system');expect(resolveTheme(bad)).toBe('dark');}
 for(const bad of [null,{},'', 'NaN','Infinity'])expect(resolveSplit(bad)).toBe(50);
 expect(resolveSplit('12')).toBe(25);expect(resolveSplit('88')).toBe(75);expect(resolveSplit('62.5')).toBe(62.5);
 for(const bad of [null,{},'', 'invalid','conversation'])expect(resolveContentMode(bad)).toBe('both');
 for(const mode of ['chat','workspace','both'] as const)expect(resolveContentMode(mode)).toBe(mode);
 for(const bad of [null,{},'', 'invalid'])expect(resolveContentMode(bad,'true')).toBe('chat');
 for(const mode of ['chat','workspace','both'] as const)expect(resolveContentMode(mode,'true')).toBe(mode);
 for(const legacy of [null,{},'false',true])expect(resolveContentMode('invalid',legacy)).toBe('both');
 const broken=()=>{throw new Error('Storage disabled');};
 expect(readPreference('font',broken)).toBe('');expect(()=>savePreference('font','inter',broken)).not.toThrow();
 const values=new Map([['unrelated','retained']]);const storage=()=>({getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}});
 savePreference('font','geist',storage);expect(readPreference('font',storage)).toBe('geist');expect(values.get('unrelated')).toBe('retained');
});

test('chat width defaults safely and persists independently',()=>{
 for(const value of [undefined,null,{},true,760,'','invalid'])expect(resolveChatWidth(value)).toBe('compact');
 expect(resolveChatWidth('full')).toBe('full');
 expect(resolveChatWidth('compact')).toBe('compact');
 const values=new Map<string,string>();const storage=()=>({getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);}});
 savePreference('chat-width','compact',storage);expect(resolveChatWidth(readPreference('chat-width',storage))).toBe('compact');
 expect(readPreference('theme',storage)).toBe('');
 const broken=()=>{throw Error('Storage unavailable');};expect(resolveChatWidth(readPreference('chat-width',broken))).toBe('compact');
 expect(()=>savePreference('chat-width','compact',broken)).not.toThrow();
});
