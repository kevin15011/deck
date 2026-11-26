import type {Extension} from '@codemirror/state';

export async function loadLanguage(path:string):Promise<Extension> {
 switch (path.split('.').at(-1)?.toLowerCase()) {
  case 'rs': return (await import('@codemirror/lang-rust')).rust();
  case 'js': case 'mjs': case 'cjs': case 'jsx': case 'ts': case 'mts': case 'cts': case 'tsx': {
   const {javascript} = await import('@codemirror/lang-javascript');
   return javascript({typescript:/\.[cm]?tsx?$/i.test(path), jsx:/\.[jt]sx$/i.test(path)});
  }
  case 'json': return (await import('@codemirror/lang-json')).json();
  case 'css': return (await import('@codemirror/lang-css')).css();
  default: return [];
 }
}
