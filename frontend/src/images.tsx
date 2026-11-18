import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {gsap} from 'gsap';
import {imageAttachment,load,save,request,type ImageAttachment} from './api';
export const imageURL=(session:string,id:string)=>`/api/sessions/${encodeURIComponent(session)}/images/${encodeURIComponent(id)}`;
export interface ImageDraft {id:string;name:string;size:number;status:'uploading'|'ready'|'error';attachment?:ImageAttachment;file?:File;src?:string;error?:string;removing?:string}
const key=(scope:string)=>scope+'.images';
export function recalledImages(scope:string):ImageDraft[]{
 try{const value:unknown=JSON.parse(load(key(scope))||'[]');if(!Array.isArray(value)||value.length>136)throw Error();
 return value.map(v=>{if(!v||typeof v.id!=='string'||typeof v.name!=='string'||typeof v.size!=='number')throw Error();return {...v,attachment:v.attachment?imageAttachment(v.attachment):undefined,status:v.attachment?'ready':'error',error:v.attachment?undefined:'Upload was interrupted. Remove this draft and select the image again.'};});
 }catch{return [{id:'invalid-saved-image',name:'Saved image draft',size:0,status:'error',error:'Saved image draft is invalid. Preserve browser storage and reconnect with a compatible client.'}];}
}
export function useImages(onError:(message:string)=>void){
 const [drafts,setDrafts]=useState<Record<string,ImageDraft[]>>({}),current=useRef(drafts),alive=useRef(true),removals=useRef(new Set<string>()),sessions=useRef(new Map<string,string>()),controllers=useRef(new Map<string,AbortController>()),urls=useRef(new Map<string,string>());
 const persist=(scope:string,items:ImageDraft[])=>save(key(scope),JSON.stringify(items.map(({file,src,...v})=>v)));
 function update(scope:string,fn:(v:ImageDraft[])=>ImageDraft[]){if(!alive.current)return;const items=fn(current.current[scope]??recalledImages(scope));persist(scope,items);current.current={...current.current,[scope]:items};setDrafts(current.current);}
 async function cleanup(scope:string,session:string,id:string){
  const identity=scope+'|'+id;if(removals.current.has(identity))return;removals.current.add(identity);
  try{await request('DELETE',`/api/sessions/${encodeURIComponent(session)}/uploads/${encodeURIComponent(id)}`);
   if(alive.current)update(scope,v=>v.filter(v=>v.id!==id||v.removing!==session));
   else {const items=recalledImages(scope);persist(scope,items.filter(v=>v.id!==id||v.removing!==session));}
  }catch(e){if(alive.current)onError('Image removal is pending. Reconnect to retry cleanup: '+String(e));}
  finally{removals.current.delete(identity);}
 }
 function restore(scope:string,session?:string){if(!scope)return;if(session)sessions.current.set(scope,session);
  try{if(!(scope in current.current)){const items=recalledImages(scope);current.current={...current.current,[scope]:items};setDrafts(current.current);
   if(session)for(const item of items){if(!item.removing&&!item.attachment&&item.id!=='invalid-saved-image')void request('GET',`/api/sessions/${encodeURIComponent(session)}/uploads/${item.id}`).then(v=>{const attachment=imageAttachment(v);update(scope,items=>items.map(v=>v.id===item.id&&!v.removing?{...v,attachment,status:'ready',error:undefined}:v));}).catch(()=>{});}}
   for(const item of current.current[scope]||[])if(item.removing)void cleanup(scope,item.removing,item.id);
  }catch(e){onError(String(e));}
 }
 function dispose(id:string){controllers.current.get(id)?.abort();controllers.current.delete(id);const url=urls.current.get(id);if(url){URL.revokeObjectURL(url);urls.current.delete(id);}}
 async function upload(scope:string,session:string,item:ImageDraft){if(!item.file)return;const controller=new AbortController();controllers.current.set(item.id,controller);
  try{const response=await fetch(`/api/sessions/${encodeURIComponent(session)}/uploads/${item.id}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:item.file,signal:controller.signal});
   const body=await response.json();if(!response.ok)throw Error(body.message||`Upload failed (HTTP ${response.status})`);const attachment=imageAttachment(body);
   if(controller.signal.aborted){if(recalledImages(scope).some(v=>v.id===item.id&&v.removing))void cleanup(scope,session,item.id);return;}
   if(!alive.current)return;
   if(current.current[scope]?.some(v=>v.id===item.id&&v.removing)){void cleanup(scope,session,item.id);return;}
   update(scope,items=>items.map(v=>v.id===item.id?{...v,status:'ready',attachment,error:undefined}:v));
  }catch(e){if(!controller.signal.aborted&&alive.current){try{update(scope,items=>items.map(v=>v.id===item.id?{...v,status:'error',error:String(e)}:v));}catch(error){onError(String(error));}}}
  finally{if(controllers.current.get(item.id)===controller)controllers.current.delete(item.id);}
 }
 function add(scope:string,session:string,files:File[]){restore(scope,session);try{if((current.current[scope]||[]).length>=128)throw Error('Pending image removals must finish before adding more images. Reconnect to retry cleanup.');const old=(current.current[scope]||[]).filter(v=>!v.removing);let size=old.reduce((n,v)=>n+v.size,0);const items:ImageDraft[]=[];
  for(const file of files){if(!(['image/png','image/jpeg','image/webp'].includes(file.type)||(!file.type&&/\.(png|jpe?g|webp)$/i.test(file.name)))||!file.size||file.size>5*1024*1024||old.length+items.length>=8||size+file.size>20*1024*1024){onError('Use up to 8 PNG, JPEG or WebP images, 5 MiB each and 20 MiB total. Your text is retained.');continue;}
   size+=file.size;const id=crypto.randomUUID(),src=URL.createObjectURL(file);urls.current.set(id,src);items.push({id,name:file.name.slice(0,160)||'Image',size:file.size,file,src,status:'uploading'});
  }
  update(scope,v=>[...v,...items]);items.forEach(item=>void upload(scope,session,item));
 }catch(e){onError(String(e));}}
 function recall(scope:string,attachments:ImageAttachment[]){update(scope,items=>{const ids=new Set(items.map(v=>v.attachment?.id));return [...items,...attachments.filter(a=>!ids.has(a.id)).map(a=>({id:crypto.randomUUID(),name:'Recalled image',size:a.size,status:'ready' as const,attachment:a}))];});}
 function consume(scope:string,ids:string[]){try{update(scope,v=>v.filter(item=>item.removing||!ids.includes(item.attachment?.id||'')));for(const [id,url] of urls.current){if(!Object.values(current.current).flat().some(v=>v.id===id)){URL.revokeObjectURL(url);urls.current.delete(id);}}}catch(e){onError(String(e));throw e;}}
 function remove(scope:string,session:string,id:string){try{update(scope,v=>v.map(v=>v.id===id?{...v,removing:session}:v));dispose(id);void cleanup(scope,session,id);}catch(e){onError(String(e));}}
 function retry(scope:string,session:string,id:string){const item=current.current[scope]?.find(v=>v.id===id);if(!item?.file){onError('Select the image again to retry an interrupted upload.');return;}try{update(scope,v=>v.map(v=>v.id===id?{...v,status:'uploading',error:undefined}:v));void upload(scope,session,item);}catch(e){onError(String(e));}}
 useEffect(()=>{alive.current=true;const reconcile=()=>{for(const [scope,session] of sessions.current)restore(scope,session);};window.addEventListener('online',reconcile);const timer=window.setInterval(reconcile,10000);return()=>{window.removeEventListener('online',reconcile);window.clearInterval(timer);alive.current=false;controllers.current.forEach(c=>c.abort());urls.current.forEach(url=>URL.revokeObjectURL(url));};},[]);
 return {drafts:Object.fromEntries(Object.entries(drafts).map(([scope,items])=>[scope,items.filter(v=>!v.removing)])),restore,recall,add,remove,retry,consume};
}
export function ImagePicker({owner,disabled,onFiles}:{owner:string;disabled:boolean;onFiles:(files:File[],owner:string)=>void}){
 const input=useRef<HTMLInputElement>(null),source=useRef('');
 return <><input ref={input} type="file" className="sr-only" aria-label="Choose images" accept="image/png,image/jpeg,image/webp" multiple tabIndex={-1} onChange={e=>{onFiles(Array.from(e.currentTarget.files||[]),source.current||owner);source.current='';e.currentTarget.value='';}}/><button type="button" className="quiet" aria-label="Attach images" title="Attach PNG, JPEG or WebP images · 8 maximum, 5 MiB each" disabled={disabled} onClick={()=>{source.current=owner;input.current?.click();}}><svg className="navigation-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="1.5"/><circle cx="5.5" cy="5.5" r="1"/><path d="m2 11 4-4 3 3 2-2 3 3"/></svg></button></>;
}
export interface Preview {src:string;name:string}
export function ImagePreview({image,onClose}:{image?:Preview;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),focus=useRef<HTMLElement|null>(null),[shown,setShown]=useState(false),[zoom,setZoom]=useState(1),[failed,setFailed]=useState(false),[revision,setRevision]=useState(0);
 useLayoutEffect(()=>{const node=dialog.current;if(!node)return;const media=matchMedia('(prefers-reduced-motion: reduce)');gsap.killTweensOf(node);
  if(image){focus.current=document.activeElement as HTMLElement;setZoom(1);setFailed(false);if(!node.open)node.showModal();setShown(true);if(!media.matches)gsap.fromTo(node,{opacity:.5,y:4},{opacity:1,y:0,duration:.18,clearProps:'opacity,transform'});}
  else if(node.open){setShown(false);node.close();const target=focus.current?.isConnected?focus.current:document.getElementById('prompt');target?.focus({preventScroll:true});}
  const settle=()=>{if(media.matches){gsap.killTweensOf(node);gsap.set(node,{clearProps:'opacity,transform'});}};media.addEventListener('change',settle);return()=>{media.removeEventListener('change',settle);gsap.killTweensOf(node);};
 },[image]);
 return <dialog ref={dialog} className="image-preview" aria-label="Image preview" onCancel={e=>{e.preventDefault();onClose();}}><header><h2>Image preview<span>{image?.name}</span></h2><button type="button" className="quiet" aria-label="Close image preview" onClick={onClose}>×</button></header><div className="image-zoom-controls"><button className="quiet" type="button" aria-label="Zoom out" disabled={zoom<=.5} onClick={()=>setZoom(v=>v-.5)}>−</button><output>{Math.round(zoom*100)}%</output><button className="quiet" type="button" aria-label="Zoom in" disabled={zoom>=4} onClick={()=>setZoom(v=>v+.5)}>+</button><button className="quiet" type="button" onClick={()=>setZoom(1)}>Fit image</button></div><div className="image-preview-viewport">{failed?<p role="alert">This image could not be loaded. <button type="button" onClick={()=>{setFailed(false);setRevision(v=>v+1);}}>Retry image</button></p>:image&&shown&&<img key={revision} className="image-full" alt={image.name} src={image.src} style={{width:zoom===1?undefined:zoom*100+'%',maxWidth:zoom===1?'100%':'none'}} onError={()=>setFailed(true)}/>}</div></dialog>;
}

/** Remove the semantic draft immediately; a noninteractive owned visual exits. */
export function useImageRemoval(){
 const ghosts=useRef(new Set<HTMLElement>());
 useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)'),settle=()=>{for(const node of ghosts.current){gsap.killTweensOf(node);node.remove();}ghosts.current.clear();};const change=()=>{if(media.matches)settle();};media.addEventListener('change',change);return()=>{media.removeEventListener('change',change);settle();};},[]);
 return (node:HTMLElement|null)=>{
  if(!node||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const bounds=node.getBoundingClientRect(),ghost=node.cloneNode(true) as HTMLElement;
  ghost.inert=true;ghost.setAttribute('aria-hidden','true');Object.assign(ghost.style,{position:'fixed',left:bounds.x+'px',top:bounds.y+'px',width:bounds.width+'px',height:bounds.height+'px',pointerEvents:'none',zIndex:'20',listStyle:'none'});document.body.append(ghost);ghosts.current.add(ghost);
  gsap.to(ghost,{opacity:0,y:-3,duration:.12,ease:'power2.out',onComplete:()=>{ghost.remove();ghosts.current.delete(ghost);}});
 };
}
