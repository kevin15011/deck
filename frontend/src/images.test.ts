import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
// Execute the actual hook with only React scheduling and browser transport/storage faked.
// Oracle Q01: removal remains durable until acknowledgment, never becomes submit input.
function fixture(saved=new Map<string,string>(),fetchUpload:typeof fetch=fetch){
 const effects:(()=>void|(()=>void))[]=[],errors:string[]=[],calls:{method:string;url:string}[]=[];
 let fail=true;
 const source=readFileSync(new URL('./images.tsx',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace(/^export /gm,'');
 const js=new Bun.Transpiler({loader:'tsx'}).transformSync(source);
 const hook=new Function('useRef','useState','useEffect','useLayoutEffect','load','save','request','imageAttachment','gsap','fetch',js+';return useImages;')(
  (current:unknown)=>({current}),(v:unknown)=>[v,()=>{}],(f:()=>void)=>effects.push(f),()=>{},
  (k:string)=>saved.get(k)||'',(k:string,v:string)=>saved.set(k,v),async(method:string,url:string)=>{calls.push({method,url});if(fail)throw Error('offline');return {};},(v:unknown)=>v,{},fetchUpload
 );
 const originalWindow=globalThis.window;globalThis.window={addEventListener(){},removeEventListener(){},setInterval(){return 0;},clearInterval(){}} as unknown as Window & typeof globalThis;
 const images=hook((s:string)=>errors.push(s));effects.forEach(f=>f());globalThis.window=originalWindow;
 return {images,saved,errors,calls,reconnect:()=>{fail=false;images.restore('scope','source-session');}};
}
test('lost removal acknowledgment survives reload and retries the source session',async()=>{
 const saved=new Map([['scope.images',JSON.stringify([{id:'upload-one',name:'one',size:1,status:'error'},{id:'upload-sibling',name:'sibling',size:1,status:'error'}])]]);
 const a=fixture(saved);a.images.restore('scope','source-session');a.images.remove('scope','source-session','upload-one');await Bun.sleep(0);
 expect(JSON.parse(saved.get('scope.images')!).some((v:any)=>v.id==='upload-one')).toBe(true);
 expect(a.errors.some(v=>/remov|cleanup/i.test(v))).toBe(true);
 const b=fixture(saved);b.images.restore('scope','source-session');await Bun.sleep(0);b.reconnect();await Bun.sleep(0);
 expect(b.calls.some(v=>v.method==='DELETE'&&v.url.includes('/source-session/uploads/upload-one'))).toBe(true);
 expect(JSON.parse(saved.get('scope.images')!).map((v:any)=>v.id)).toEqual(['upload-sibling']);
});

test('late upload completion retries removal and never revives the removed input',async()=>{
 let finish!:(v:Response)=>void;
 const transport=(()=>new Promise<Response>(resolve=>finish=resolve)) as unknown as typeof fetch;
 const a=fixture(new Map(),transport);
 a.images.add('scope','source-session',[new File(['image'],'one.png',{type:'image/png'})]);
 const id=JSON.parse(a.saved.get('scope.images')!)[0].id;
 a.images.remove('scope','source-session',id);await Bun.sleep(0);
 finish(new Response(JSON.stringify({id:'server-image'})));await Bun.sleep(0);
 expect(JSON.parse(a.saved.get('scope.images')!)[0].removing).toBe('source-session');
 expect(a.calls.filter(v=>v.method==='DELETE').length).toBeGreaterThanOrEqual(2);
 a.reconnect();await Bun.sleep(0);
 expect(JSON.parse(a.saved.get('scope.images')!)).toEqual([]);
});
