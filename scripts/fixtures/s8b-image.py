#!/usr/bin/env python3
"""Synthetic nonpersonal visual fixture; no text labels or identifying content."""
import struct,zlib,sys,pathlib
w,h=600,360
rows=[]
for y in range(h):
 row=bytearray()
 for x in range(w):
  color=(248,248,248)
  if (x-130)**2+(y-100)**2<65**2:color=(230,25,35)
  if 360<x<540 and 230<y<320:color=(20,55,220)
  if 255<y<315 and abs(x-120)<(y-255)*.8:color=(20,160,70)
  row.extend(color)
 rows.append(b'\0'+row)
def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
raw=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b'')
p=pathlib.Path(sys.argv[1]);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
