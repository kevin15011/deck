#!/usr/bin/env python3
"""Observe rendered synthetic image content, not CSS/markup or screenshot equality.
Oracle: the fixture contains a red circle, green triangle and blue rectangle.
A loaded but unpainted image must fail this browser boundary check.
Only Chromium's 8-bit RGB/RGBA PNG screenshots are accepted.
"""
import json,struct,sys,zlib
raw=open(sys.argv[1],'rb').read();assert raw[:8]==b'\x89PNG\r\n\x1a\n'
pos=8;data=bytearray();width=height=channels=0
while pos<len(raw):
 size=struct.unpack('>I',raw[pos:pos+4])[0];kind=raw[pos+4:pos+8];chunk=raw[pos+8:pos+8+size];pos+=size+12
 if kind==b'IHDR':
  width,height,depth,color,_,_,interlace=struct.unpack('>IIBBBBB',chunk);assert depth==8 and color in (2,6) and interlace==0;channels=3 if color==2 else 4
 if kind==b'IDAT':data.extend(chunk)
rows=[];decoded=zlib.decompress(data);stride=width*channels;cursor=0
for y in range(height):
 method=decoded[cursor];cursor+=1;row=bytearray(decoded[cursor:cursor+stride]);cursor+=stride;previous=rows[-1] if rows else bytearray(stride)
 for i in range(stride):
  a=row[i-channels] if i>=channels else 0;b=previous[i];c=previous[i-channels] if i>=channels else 0
  if method==1:predict=a
  elif method==2:predict=b
  elif method==3:predict=(a+b)//2
  elif method==4:
   p=a+b-c;distances=[abs(p-a),abs(p-b),abs(p-c)];predict=[a,b,c][distances.index(min(distances))]
  else:assert method==0;predict=0
  row[i]=(row[i]+predict)&255
 rows.append(row)
box=json.loads(sys.argv[2]);scale=box['width']/600
for name,x,y,predicate in [('red',130,100,lambda r,g,b:r>180 and g<90 and b<90),('green',120,290,lambda r,g,b:r<90 and g>100 and b<110),('blue',450,270,lambda r,g,b:r<90 and g<110 and b>180)]:
 px=round(box['x']+x*scale);py=round(box['y']+y*scale);assert 0<=px<width and 0<=py<height
 values=rows[py][px*channels:px*channels+3];assert predicate(*values),f'Preview did not paint {name} shape at {px},{py}: {list(values)}'
print('Visible synthetic red/green/blue image regions verified')
