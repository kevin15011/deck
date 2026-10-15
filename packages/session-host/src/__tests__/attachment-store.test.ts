import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttachmentStore } from "../attachment-store";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
const store = () => { const root = mkdtempSync(join(tmpdir(), "deck-images-")); roots.push(root); return new AttachmentStore(join(root, "attachments")); };

test("managed images persist opaque descriptors and validate MIME, dimensions and bytes", () => {
  const s = store(); const image = s.upload(PNG, "image/png", "clipboard.png", new Set(), 0);
  expect(image).toMatchObject({mimeType:"image/png", name:"clipboard.png", sizeBytes:PNG.length,width:1,height:1});
  expect(JSON.stringify(image)).not.toContain("/attachments");
  expect(s.read(image.attachmentId).bytes).toEqual(PNG);
  expect(() => s.upload(PNG, "image/jpeg", "x", new Set(),0)).toThrow("attachment-invalid");
  expect(() => s.upload(Buffer.from("<svg/>"), "image/png", "x", new Set(),0)).toThrow("attachment-invalid");
  expect(() => s.read("../x")).toThrow("attachment-invalid");
  expect(() => s.upload(Buffer.alloc(5*1024*1024+1),"image/png","x",new Set(),0)).toThrow("attachment-too-large");
});

test("lazy staging expiry retains accepted references and bounds abandoned uploads", () => {
  const s = store(); const accepted = s.upload(PNG,"image/png","accepted",new Set(),0);
  const abandoned = s.upload(PNG,"image/png","abandoned",new Set([accepted.attachmentId]),0);
  s.upload(PNG,"image/png","next",new Set([accepted.attachmentId]),86400001);
  expect(s.read(accepted.attachmentId).bytes).toEqual(PNG);
  expect(() => s.read(abandoned.attachmentId)).toThrow("attachment-unknown");
  for(let i=0;i<31;i++) s.upload(PNG,"image/png","x",new Set([accepted.attachmentId]),86400001);
  expect(() => s.upload(PNG,"image/png","x",new Set([accepted.attachmentId]),86400001)).toThrow("attachment-staging-full");
});

test("managed file reads reject symlink substitution", () => {
  const s = store(); const image=s.upload(PNG,"image/png","x",new Set(),0); const path=s.resolve([image])[0]!.path;
  unlinkSync(path); symlinkSync("/etc/passwd",path);
  expect(() => s.read(image.attachmentId)).toThrow("attachment-unavailable");
});

test("actual WebP bitstream dimensions cannot hide behind a smaller extended canvas", () => {
  const s=store(); const bytes=Buffer.alloc(44);
  bytes.write("RIFF");bytes.writeUInt32LE(36,4);bytes.write("WEBP",8);
  bytes.write("VP8X",12);bytes.writeUInt32LE(10,16);
  bytes.write("VP8L",30);bytes.writeUInt32LE(5,34);bytes[38]=47;bytes.writeUInt32LE(0x0fffffff,39);
  expect(()=>s.upload(bytes,"image/webp","x",new Set(),0)).toThrow("attachment-invalid");
  bytes.writeUInt32LE(0,39); expect(s.upload(bytes,"image/webp","x",new Set(),0)).toMatchObject({width:1,height:1});
});

test("JPEG must include an image scan and cannot replace oversized frame dimensions", () => {
  const s=store(); const bytes=Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,217]);
  expect(()=>s.upload(bytes,"image/jpeg","x",new Set(),0)).toThrow("attachment-invalid");
  const scanned=Buffer.concat([bytes.subarray(0,-2),Buffer.from([255,218,0,8,1,1,0,0,63,0,1,255,217])]);
  expect(s.upload(scanned,"image/jpeg","x",new Set(),0)).toMatchObject({width:1,height:1});
  const oversized=Buffer.from(bytes.subarray(2,-2));oversized.writeUInt16BE(16384,7);oversized.writeUInt16BE(16384,5);
  expect(()=>s.upload(Buffer.concat([scanned.subarray(0,2),oversized,scanned.subarray(2)]),"image/jpeg","x",new Set(),0)).toThrow("attachment-invalid");
});


test("PNG rejects repeated headers, corrupt chunk checksums and oversized decoded dimensions", () => {
 const s=store(); const duplicate=Buffer.concat([PNG.subarray(0,33),PNG.subarray(8,33),PNG.subarray(33)]);
 expect(()=>s.upload(duplicate,"image/png","x",new Set(),0)).toThrow("attachment-invalid");
 const corrupt=Buffer.from(PNG);corrupt[45]^=1;expect(()=>s.upload(corrupt,"image/png","x",new Set(),0)).toThrow("attachment-invalid");
 const large=Buffer.from(PNG);large.writeUInt32BE(10000,16);large.writeUInt32BE(10000,20);
 let crc=0xffffffff;for(const byte of large.subarray(12,29)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}large.writeUInt32BE((crc^0xffffffff)>>>0,29);
 expect(()=>s.upload(large,"image/png","x",new Set(),0)).toThrow("attachment-invalid");
});
