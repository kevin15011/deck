/** Immutable session-owned images. Public descriptors never contain filesystem paths. */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readdirSync, readSync, lstatSync, fsyncSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { IMAGE_ATTACHMENT_LIMITS as LIMITS, type ImageAttachment } from "@deck/core/session/commands";
import type { DriverImageInput } from "@deck/core/session/driver";
import { ensurePrivateDir, writePrivateFile } from "./paths";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL = 24 * 60 * 60 * 1000;
type Stored = { attachment: ImageAttachment; digest: string; createdAt: number };
const CRC_TABLE = Array.from({length:256}, (_,value) => { let crc=value; for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); return crc>>>0; });
function crc32(bytes: Uint8Array): number { let crc=0xffffffff; for(const byte of bytes) crc=CRC_TABLE[(crc^byte)&255]!^(crc>>>8); return (crc^0xffffffff)>>>0; }
const invalid = (): never => { throw new Error("attachment-invalid"); };
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Parse bounded native format headers; no decoding, external commands or MIME guessing. */
export function inspectImage(bytes: Uint8Array, mimeType: string): {width:number;height:number} {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength); let width=0, height=0;
  if (mimeType === "image/png") {
    if (b.length < 45 || b.subarray(0,8).toString("hex") !== "89504e470d0a1a0a" || b.readUInt32BE(8)!==13 || b.toString("ascii",12,16)!=="IHDR") invalid();
    width=b.readUInt32BE(16); height=b.readUInt32BE(20);
    const depths:Record<number,number[]>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
    if(!depths[b[25]!]?.includes(b[24]!) || b[26]!==0 || b[27]!==0 || b[28]!>1) invalid();
    let offset=8, ended=false, data=false, headers=0;
    while(offset+12<=b.length) { const size=b.readUInt32BE(offset), kind=b.toString("ascii",offset+4,offset+8); if(size>b.length-offset-12 || crc32(b.subarray(offset+4,offset+8+size))!==b.readUInt32BE(offset+8+size)) invalid(); if(kind==="IHDR" && ++headers!==1) invalid(); if(kind==="IDAT") data=true; offset+=size+12; if(kind==="IEND") { if(size!==0 || offset!==b.length) invalid(); ended=true; break; } }
    if(!ended || !data) invalid();
  } else if (mimeType === "image/jpeg") {
    if(b.length<12 || b[0]!==255 || b[1]!==216 || b[b.length-2]!==255 || b[b.length-1]!==217) invalid();
    let offset=2, scanned=false;
    while(offset+4<=b.length) { if(b[offset++]!==255) invalid(); while(b[offset]===255) offset++; const marker=b[offset++]!; if(marker===218) { if(!width || offset+2>b.length) invalid(); const scanSize=b.readUInt16BE(offset); if(scanSize<6 || offset+scanSize>=b.length-2) invalid(); scanned=true; break; } if(marker===217) break; if(marker===1 || marker>=208 && marker<=215) continue; const size=b.readUInt16BE(offset); if(size<2 || size>b.length-offset) invalid(); if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) { if(size<8) invalid(); const nextHeight=b.readUInt16BE(offset+3), nextWidth=b.readUInt16BE(offset+5); if(width && (width!==nextWidth || height!==nextHeight)) invalid(); width=nextWidth; height=nextHeight; if(width>LIMITS.maxDimension || height>LIMITS.maxDimension || width*height>LIMITS.maxPixels) invalid(); } offset+=size; }
    if(!scanned) invalid();
  } else if (mimeType === "image/webp") {
    if(b.length<30 || b.toString("ascii",0,4)!=="RIFF" || b.toString("ascii",8,12)!=="WEBP" || b.readUInt32LE(4)+8!==b.length) invalid();
    let offset=12, data=false, canvas=false;
    const encodedDimensions=(w:number,h:number) => { if(data || width && (width!==w || height!==h) || !w || !h || w>LIMITS.maxDimension || h>LIMITS.maxDimension || w*h>LIMITS.maxPixels) invalid(); width=w; height=h; data=true; };
    while(offset+8<=b.length) { const kind=b.toString("ascii",offset,offset+4), size=b.readUInt32LE(offset+4), start=offset+8; if(size>b.length-start) invalid();
      if(kind==="VP8X") { if(size!==10 || canvas || data || b[start]!&2) invalid(); canvas=true; width=1+b.readUIntLE(start+4,3); height=1+b.readUIntLE(start+7,3); }
      if(kind==="VP8 ") { if(size<10 || b.toString("hex",start+3,start+6)!=="9d012a") invalid(); encodedDimensions(b.readUInt16LE(start+6)&16383,b.readUInt16LE(start+8)&16383); }
      if(kind==="VP8L") { if(size<5 || b[start]!==47) invalid(); const bits=b.readUInt32LE(start+1); if(bits>>>29) invalid(); encodedDimensions(1+(bits&16383),1+((bits>>>14)&16383)); }
      if(kind==="ANIM" || kind==="ANMF") invalid();
      offset=start+size+(size&1);
    }
    if(!data || offset!==b.length) invalid();
  } else invalid();
  if(!width || !height || width>LIMITS.maxDimension || height>LIMITS.maxDimension || width*height>LIMITS.maxPixels) invalid();
  return {width,height};
}

export class AttachmentStore {
  constructor(private readonly dir: string) {}
  private paths(id: string) { if(!ID.test(id)) invalid(); return {image:join(this.dir,`${id}.image`),meta:join(this.dir,`${id}.json`)}; }
  private readPrivate(file: string, max: number): Buffer {
    let fd: number | undefined;
    try { fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0)); const st=fstatSync(fd); if(!st.isFile() || st.uid!==(process.getuid?.()??0) || st.mode&0o077 || st.size>max) throw Error(); const b=Buffer.alloc(st.size); let offset=0; while(offset<b.length) { const n=readSync(fd,b,offset,b.length-offset,offset); if(!n) throw Error(); offset+=n; } return b; }
    catch(error) { throw new Error((error as NodeJS.ErrnoException).code==="ENOENT" ? "attachment-unknown" : "attachment-unavailable"); }
    finally { if(fd!==undefined) closeSync(fd); }
  }
  upload(bytes: Uint8Array, mimeType: string, name: string, referenced: ReadonlySet<string>, now: number): ImageAttachment {
    if(bytes.length>LIMITS.maxFileBytes) throw new Error("attachment-too-large");
    const dimensions=inspectImage(bytes,mimeType);
    const cleanName=name.trim(); if(cleanName.length>160 || /[\x00-\x1f\x7f/\\]/.test(cleanName)) invalid();
    ensurePrivateDir(this.dir); let count=0,total=0;
    // Synchronous with enqueue acceptance: accepted ledger references always win expiry.
    for(const entry of readdirSync(this.dir)) { if(!entry.endsWith(".image") || !ID.test(entry.slice(0,-6))) continue; const id=entry.slice(0,-6); if(referenced.has(id)) continue; const paths=this.paths(id); const st=lstatSync(paths.image); if(!st.isFile() || st.isSymbolicLink()) throw new Error("attachment-unavailable"); let createdAt=st.mtimeMs; try { createdAt=(JSON.parse(this.readPrivate(paths.meta,4096).toString()) as Stored).createdAt; } catch { /* orphaned upload: expire using file age */ }
      if(now-createdAt>TTL) { unlinkSync(paths.image); try { unlinkSync(paths.meta); } catch { /* orphan */ } } else { count++; total+=st.size; }
    }
    if(count>=32 || total+bytes.length>100*1024*1024) throw new Error("attachment-staging-full");
    const attachment:ImageAttachment={attachmentId:randomUUID(),mimeType:mimeType as ImageAttachment["mimeType"],name:cleanName||`image.${mimeType==="image/jpeg"?"jpg":mimeType.slice(6)}`,sizeBytes:bytes.length,...dimensions};
    const paths=this.paths(attachment.attachmentId);
    writePrivateFile(paths.image,bytes);
    try { writePrivateFile(paths.meta,JSON.stringify({attachment,digest:digest(bytes),createdAt:now} satisfies Stored)); } catch(error) { try { unlinkSync(paths.image); } catch { /* original error */ } throw error; }
    const dirFd=openSync(this.dir,constants.O_RDONLY|(constants.O_DIRECTORY??0));
    try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    return attachment;
  }
  read(id: string): {attachment:ImageAttachment;bytes:Buffer;path:string} {
    const paths=this.paths(id); ensurePrivateDir(this.dir);
    let stored:Stored; try { stored=JSON.parse(this.readPrivate(paths.meta,4096).toString()) as Stored; } catch(error) { if((error as Error).message==="attachment-unknown") throw error; throw new Error("attachment-unavailable"); }
    const bytes=this.readPrivate(paths.image,LIMITS.maxFileBytes);
    if(stored.attachment?.attachmentId!==id || stored.attachment.sizeBytes!==bytes.length || stored.digest!==digest(bytes)) throw new Error("attachment-unavailable");
    const dimensions=inspectImage(bytes,stored.attachment.mimeType); if(dimensions.width!==stored.attachment.width || dimensions.height!==stored.attachment.height) throw new Error("attachment-unavailable");
    const {mimeType,name,sizeBytes,width,height}=stored.attachment;
    if(typeof name!=="string" || !name.trim() || name.length>160 || /[\x00-\x1f\x7f/\\]/.test(name)) throw new Error("attachment-unavailable");
    return {attachment:{attachmentId:id,mimeType,name,sizeBytes,width,height},bytes,path:paths.image};
  }
  resolve(attachments: readonly ImageAttachment[]): DriverImageInput[] { return attachments.map(attachment=>{ const image=this.read(attachment.attachmentId); if(JSON.stringify(image.attachment)!==JSON.stringify(attachment)) throw new Error("attachment-unavailable"); return {path:image.path,mimeType:attachment.mimeType,name:attachment.name}; }); }
}
