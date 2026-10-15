import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { NavigationIcon } from './project-navigation';
export type ImageAttachment = { attachmentId: string; mimeType: string; name: string; sizeBytes: number; width?: number; height?: number };
export type ImageDraft = { draftId: string; file: File; src: string; status: 'uploading'|'ready'|'error'; attachment?: ImageAttachment; error?: string; version: number };
export type PreviewImage = { name: string; file?: File; src?: string; sessionId: string };
export const attachmentURL = (sessionId:string,attachmentId:string) => `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}`;
export function publicImages(value:unknown): ImageAttachment[] { return Array.isArray(value)?value.filter((item):item is ImageAttachment=>!!item&&typeof item.attachmentId==='string'&&typeof item.name==='string'&&['image/png','image/jpeg','image/webp'].includes(item.mimeType)&&Number.isFinite(item.sizeBytes)).slice(0,8):[]; }
export const imageDisplayName = (name: string) => name.split(/[\\/]/).at(-1)?.replace(/[\x00-\x1f]/g,'').slice(0,160) || 'Pasted image';
export function imageMimeType(file: Pick<File,'type'|'name'>): string | undefined {
    if (['image/png','image/jpeg','image/webp'].includes(file.type)) return file.type;
    if (!file.type) return /\.png$/i.test(file.name)?'image/png':/\.jpe?g$/i.test(file.name)?'image/jpeg':/\.webp$/i.test(file.name)?'image/webp':undefined;
}
export function validateImageBatch(existing: Pick<File,'size'>[], files: File[]) {
    const accepted: File[]=[];let bytes=existing.reduce((sum,file)=>sum+file.size,0),error='';
    for(const file of files){
        if(!imageMimeType(file)){error='Use PNG, JPEG or WebP images.';continue;}
        if(!file.size||file.size>5*1024*1024){error='Each image must be smaller than or equal to 5 MiB.';continue;}
        if(existing.length+accepted.length>=8){error='A message can include up to 8 images.';continue;}
        if(bytes+file.size>20*1024*1024){error='Images in one message must total 20 MiB or less.';continue;}
        accepted.push(file);bytes+=file.size;
    }
    return {accepted,error};
}
export const insertPastedText = (text:string,start:number,end:number,pasted:string) => ({text:text.slice(0,start)+pasted+text.slice(end),caret:start+pasted.length});
export function clipboardImages(data: DataTransfer): File[] {
    const items=Array.from(data.items).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter((file):file is File=>!!file);
    return items.length?items:Array.from(data.files).filter(file=>file.type.startsWith('image/')||!!imageMimeType(file));
}
export function useImageDrafts(upload: (sessionId:string,file:File,signal:AbortSignal)=>Promise<ImageAttachment>) {
    const [drafts,setDrafts]=useState<Record<string,ImageDraft[]>>({}),[errors,setErrors]=useState<Record<string,string>>({});
    const current=useRef(drafts),alive=useRef(true),controllers=useRef(new Map<string,AbortController>()),urls=useRef(new Set<string>()),transport=useRef(upload);transport.current=upload;
    function update(fn:(old:Record<string,ImageDraft[]>)=>Record<string,ImageDraft[]>){if(!alive.current)return;current.current=fn(current.current);setDrafts(current.current);}
    function dispose(item:ImageDraft){controllers.current.get(item.draftId)?.abort();controllers.current.delete(item.draftId);if(urls.current.delete(item.src))URL.revokeObjectURL(item.src);}
    async function start(sessionId:string,item:ImageDraft){
        controllers.current.get(item.draftId)?.abort();const controller=new AbortController();controllers.current.set(item.draftId,controller);
        try{const attachment=await transport.current(sessionId,item.file,controller.signal);if(!alive.current||controller.signal.aborted)return;
            update(old=>({...old,[sessionId]:(old[sessionId]??[]).map(entry=>entry.draftId===item.draftId&&entry.version===item.version?{...entry,status:'ready',attachment,error:undefined}:entry)}));
        }catch(cause){if(!alive.current||controller.signal.aborted)return;update(old=>({...old,[sessionId]:(old[sessionId]??[]).map(entry=>entry.draftId===item.draftId&&entry.version===item.version?{...entry,status:'error',error:(cause as Error).message||'Could not upload this image.'}:entry)}));}
        finally{if(controllers.current.get(item.draftId)===controller)controllers.current.delete(item.draftId);}
    }
    function add(sessionId:string,files:File[]){
        if(!sessionId||!alive.current)return;const result=validateImageBatch((current.current[sessionId]??[]).map(item=>item.file),files);setErrors(old=>({...old,[sessionId]:result.error}));
        const items=result.accepted.map(file=>{const src=URL.createObjectURL(file);urls.current.add(src);return {draftId:crypto.randomUUID(),file,src,status:'uploading' as const,version:1};});
        update(old=>({...old,[sessionId]:[...(old[sessionId]??[]),...items]}));items.forEach(item=>void start(sessionId,item));
    }
    function remove(sessionId:string,ids:string[],clearError=true){const removed=(current.current[sessionId]??[]).filter(item=>ids.includes(item.draftId));removed.forEach(dispose);update(old=>({...old,[sessionId]:(old[sessionId]??[]).filter(item=>!ids.includes(item.draftId))}));if(clearError)setErrors(old=>({...old,[sessionId]:''}));}
    function retry(sessionId:string,id:string){const old=current.current[sessionId]?.find(item=>item.draftId===id);if(!old)return;const item={...old,status:'uploading' as const,error:undefined,version:old.version+1};update(drafts=>({...drafts,[sessionId]:drafts[sessionId]!.map(entry=>entry.draftId===id?item:entry)}));void start(sessionId,item);}
    useEffect(()=>{alive.current=true;return()=>{alive.current=false;controllers.current.forEach(controller=>controller.abort());controllers.current.clear();urls.current.forEach(url=>URL.revokeObjectURL(url));urls.current.clear();};},[]);
    return {drafts,errors,add,remove,retry,consume:(sessionId:string,ids:string[])=>remove(sessionId,ids,false)};
}
export function ImageGlyph(){return <svg className="navigation-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><rect x="2" y="2" width="12" height="12" rx="1.5"/><circle cx="5.5" cy="5.5" r="1"/><path d="m2 11 4-4 3 3 2-2 3 3"/></svg>;}
export function ImagePicker({disabled,onFiles,sessionId}:{disabled:boolean;sessionId:string;onFiles:(files:File[],owner:string)=>void}){
    const input=useRef<HTMLInputElement>(null),owner=useRef('');
    return <><input ref={input} className="sr-only" type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="Choose images" tabIndex={-1} disabled={disabled} onChange={event=>{onFiles(Array.from(event.currentTarget.files??[]),owner.current||sessionId);owner.current='';event.currentTarget.value='';}}/><button type="button" className="quiet" disabled={disabled} aria-label="Attach images" title="Attach images or paste from your clipboard" onClick={()=>{owner.current=sessionId;input.current?.click();}}><ImageGlyph/></button></>;
}
export function ImageDraftStrip({items,error,submitted,onRemove,onRetry,onPreview}:{items:ImageDraft[];error?:string;submitted:Set<string>;onRemove:(id:string)=>void;onRetry:(id:string)=>void;onPreview:(item:ImageDraft)=>void}){
    if(!items.length&&!error)return null;
    return <section className="image-drafts" aria-label="Attached images"><ul>{items.map((item,index)=><li key={item.draftId} data-image-draft={item.draftId}><button type="button" className="image-thumbnail quiet" aria-label={`Preview attached image ${index+1}: ${imageDisplayName(item.file.name)}`} onClick={()=>onPreview(item)}><img src={item.src} alt="" width="56" height="56" decoding="async"/><span>{imageDisplayName(item.file.name)}</span></button><button type="button" className="quiet image-remove" disabled={submitted.has(item.draftId)} aria-label={`Remove attached image ${index+1}`} onClick={()=>onRemove(item.draftId)}><NavigationIcon kind="close"/></button><small role="status">{submitted.has(item.draftId)?'Sending…':item.status==='uploading'?'Uploading…':item.status==='ready'?'Ready':'Upload failed'}</small>{item.status==='error'&&<><p className="image-error" role="alert">{item.error}</p><button type="button" className="quiet image-retry" onClick={()=>onRetry(item.draftId)}>Retry upload</button></>}</li>)}</ul>{error&&<p className="image-error" role="alert">{error}</p>}</section>;
}
export function ImageReferences({attachments,onPreview,compact=false}:{attachments:ImageAttachment[];onPreview:(attachment:ImageAttachment)=>void;compact?:boolean}){
    if(!attachments.length)return null;
    return <span className="image-references">{attachments.map((attachment,index)=><button key={attachment.attachmentId} type="button" className="quiet image-reference" aria-label={`View image ${index+1}: ${imageDisplayName(attachment.name)}`} title={imageDisplayName(attachment.name)} onClick={()=>onPreview(attachment)}><ImageGlyph/><span>{compact?index+1:imageDisplayName(attachment.name)}</span></button>)}</span>;
}
export function ImagePreview({image,onClose}:{image?:PreviewImage;onClose:()=>void}){
    const dialog=useRef<HTMLDialogElement>(null),viewport=useRef<HTMLDivElement>(null),returnFocus=useRef<HTMLElement|null>(null),id=useId();
    const [src,setSrc]=useState(''),[zoom,setZoom]=useState(1),[natural,setNatural]=useState({width:0,height:0}),[bounds,setBounds]=useState({width:0,height:0}),[error,setError]=useState(false),[revision,setRevision]=useState(0);
    useEffect(()=>{if(!image){const opened=dialog.current?.open;dialog.current?.close();if(!opened&&!returnFocus.current)return;const target=returnFocus.current?.isConnected&&returnFocus.current.getClientRects().length?returnFocus.current:document.querySelector<HTMLElement>('#prompt, .composer-gate button, .sidebar-toggle');target?.focus({preventScroll:true});returnFocus.current=null;return;}
        returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setZoom(1);setNatural({width:0,height:0});setError(false);setRevision(0);
        const url=image.file?URL.createObjectURL(image.file):image.src??'';setSrc(url);dialog.current?.showModal();
        return()=>{if(image.file)URL.revokeObjectURL(url);};
    },[image]);
    useLayoutEffect(()=>{const element=viewport.current;if(!element||!image)return;const measure=()=>setBounds({width:element.clientWidth,height:element.clientHeight});measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();},[image]);
    const fit=natural.width&&natural.height?Math.min(1,Math.max(1,bounds.width-8)/natural.width,Math.max(1,bounds.height-8)/natural.height):1;
    return <dialog ref={dialog} className="image-preview" aria-labelledby={`${id}-title`} onCancel={event=>{event.preventDefault();onClose();}} onClose={()=>{if(image)onClose();}}><header><h2 id={`${id}-title`}>Image preview<span>{imageDisplayName(image?.name??'Image')}</span></h2><button type="button" className="quiet" aria-label="Close image preview" onClick={onClose}><NavigationIcon kind="close"/></button></header><div className="image-zoom-controls" aria-label="Image zoom"><button type="button" className="quiet" disabled={zoom<=.5||!natural.width} aria-label="Zoom out" onClick={()=>setZoom(value=>Math.max(.5,value-.5))}>−</button><output aria-live="polite" aria-label="Zoom relative to fitted size">{Math.round(zoom*100)}%</output><button type="button" className="quiet" disabled={zoom>=8||!natural.width} aria-label="Zoom in" onClick={()=>setZoom(value=>Math.min(8,value+.5))}>+</button><button type="button" className="quiet" disabled={!natural.width} onClick={()=>{setZoom(1);viewport.current?.scrollTo(0,0);}}>Fit image</button></div><div ref={viewport} className="image-preview-viewport">{error?<div className="image-preview-error"><p role="alert">This image could not be loaded.</p><button type="button" className="quiet" onClick={()=>{setError(false);setRevision(value=>value+1);}}>Retry image</button></div>:src&&<div className="image-canvas" style={natural.width?{width:Math.max(1,Math.round(natural.width*fit*zoom)),height:Math.max(1,Math.round(natural.height*fit*zoom))}:undefined}><img key={revision} src={src} alt={imageDisplayName(image?.name??'Image')} onLoad={event=>setNatural({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})} onError={()=>setError(true)} draggable={false}/></div>}</div></dialog>;
}
